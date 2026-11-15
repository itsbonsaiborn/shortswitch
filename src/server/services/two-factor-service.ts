import argon2 from 'argon2';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { config } from '../config.js';
import { TwoFactorRepository } from '../repositories/two-factor-repository.js';
import { UserRepository, type UserRow } from '../repositories/user-repository.js';

const ENROLLMENT_TTL_MS = 10 * 60_000;
const RECOVERY_CODE_COUNT = 10;
const TOTP_WINDOW = 1;

const normalizeRecoveryCode = (value: string) => value.trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

export class TwoFactorService {
  private repository = new TwoFactorRepository();
  private users = new UserRepository();

  isEnabled(userId: string) {
    return Boolean(this.repository.getSettings(userId));
  }

  validateConfiguration() {
    const existing = this.repository.getAnySettings();
    if (!config.totpEncryptionKey) {
      if (existing) throw new Error('TOTP_ENCRYPTION_KEY is required because two-factor authentication is enabled.');
      return;
    }
    this.encryptionKey();
    if (existing) this.decrypt(existing.secretEncrypted);
  }

  status(userId: string) {
    const settings = this.repository.getSettings(userId);
    return {
      enabled: Boolean(settings),
      enabledAt: settings?.enabledAt ?? null,
      recoveryCodesRemaining: settings ? this.repository.countUnusedRecoveryCodes(userId) : 0,
      enrollmentAvailable: Boolean(config.totpEncryptionKey)
    };
  }

  async verifyPassword(userId: string, password: string) {
    const user = this.users.findById(userId);
    return Boolean(user && password && await argon2.verify(user.passwordHash, password));
  }

  async startEnrollment(userId: string, password: string) {
    if (!config.totpEncryptionKey) {
      throw new Error('TOTP_ENCRYPTION_KEY is not configured.');
    }
    if (!await this.verifyPassword(userId, password)) throw new Error('Current password is invalid.');
    const user = this.users.findById(userId);
    if (!user) throw new Error('User not found.');
    const secret = new OTPAuth.Secret({ size: 20 });
    const secretBase32 = secret.base32;
    this.repository.saveEnrollment(
      userId,
      this.encrypt(secretBase32),
      new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString()
    );
    const totp = this.createTotp(user.email, secretBase32);
    return { otpauthUri: totp.toString(), manualKey: secretBase32 };
  }

  async confirmEnrollment(userId: string, code: string) {
    const enrollment = this.repository.getEnrollment(userId);
    if (!enrollment || enrollment.expiresAt <= new Date().toISOString()) {
      throw new Error('Two-factor enrollment has expired. Start again.');
    }
    const user = this.users.findById(userId);
    if (!user) throw new Error('User not found.');
    const secret = this.decrypt(enrollment.secretEncrypted);
    const totp = this.createTotp(user.email, secret);
    const timestamp = Date.now();
    const delta = totp.validate({ token: this.normalizeTotpCode(code), timestamp, window: TOTP_WINDOW });
    if (delta === null) throw new Error('Invalid verification code.');
    const counter = totp.counter({ timestamp }) + delta;
    const recoveryCodes = this.generateRecoveryCodes();
    const recoveryCodeHashes = await Promise.all(
      recoveryCodes.map((recoveryCode) => argon2.hash(normalizeRecoveryCode(recoveryCode)))
    );
    this.repository.activate(userId, enrollment.secretEncrypted, counter, recoveryCodeHashes);
    return recoveryCodes;
  }

  async verifyFactor(user: UserRow, code: string) {
    const settings = this.repository.getSettings(user.id);
    if (!settings) return false;
    const normalizedCode = code.trim();
    if (/^\d{6}$/.test(normalizedCode)) {
      const secret = this.decrypt(settings.secretEncrypted);
      const totp = this.createTotp(user.email, secret);
      const timestamp = Date.now();
      const delta = totp.validate({
        token: normalizedCode,
        timestamp,
        window: TOTP_WINDOW,
        afterCounter: settings.lastUsedCounter
      });
      if (delta === null) return false;
      return this.repository.acceptCounter(user.id, totp.counter({ timestamp }) + delta);
    }

    const normalizedRecovery = normalizeRecoveryCode(normalizedCode);
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(normalizedRecovery)) return false;
    for (const recovery of this.repository.listUnusedRecoveryCodes(user.id)) {
      if (await argon2.verify(recovery.codeHash, normalizedRecovery)) {
        return this.repository.useRecoveryCode(user.id, recovery.id);
      }
    }
    return false;
  }

  async disable(userId: string, password: string, code: string) {
    if (!await this.verifyPassword(userId, password)) throw new Error('Current password is invalid.');
    const user = this.users.findById(userId);
    if (!user || !await this.verifyFactor(user, code)) throw new Error('Invalid verification or recovery code.');
    this.repository.disable(userId);
  }

  createPendingChallenge(userId: string) {
    this.repository.deleteExpiredChallenges();
    return this.repository.createChallenge(
      userId,
      new Date(Date.now() + 5 * 60_000).toISOString()
    );
  }

  getPendingChallenge(id: string) {
    const challenge = this.repository.getChallenge(id);
    if (!challenge || challenge.expiresAt <= new Date().toISOString() || challenge.failedAttempts >= 5) {
      if (challenge) this.repository.deleteChallenge(id);
      return undefined;
    }
    return challenge;
  }

  recordPendingFailure(id: string) {
    this.repository.recordChallengeFailure(id, 5);
  }

  consumePendingChallenge(id: string) {
    this.repository.deleteChallenge(id);
  }

  cleanup() {
    this.repository.deleteExpiredChallenges();
  }

  private createTotp(email: string, secret: string) {
    return new OTPAuth.TOTP({
      issuer: config.appName,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret)
    });
  }

  private normalizeTotpCode(code: string) {
    return code.trim().replaceAll(' ', '');
  }

  private encryptionKey() {
    const raw = config.totpEncryptionKey;
    if (!raw) throw new Error('TOTP_ENCRYPTION_KEY is not configured.');
    const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must contain exactly 32 bytes encoded as base64 or hex.');
    return key;
  }

  private encrypt(value: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  }

  private decrypt(value: string) {
    const [version, ivValue, ciphertextValue, tagValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !ciphertextValue || !tagValue) throw new Error('Invalid encrypted TOTP secret.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }

  private generateRecoveryCodes() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const bytes = crypto.randomBytes(12);
      const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('').slice(0, 12);
      return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    });
  }
}
