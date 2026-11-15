import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser } from '@/shared/types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { SessionRepository } from '../repositories/session-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { TwoFactorService } from './two-factor-service.js';

export class AuthService {
  private users = new UserRepository();
  private sessions = new SessionRepository();
  readonly twoFactor = new TwoFactorService();
  private sessionCookieOptions = {
    httpOnly: true as const,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlHours * 3_600
  };
  private pendingCookieOptions = {
    httpOnly: true as const,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: '/',
    maxAge: 5 * 60
  };

  async bootstrapAdmin() {
    const existingBootstrapAdmin = this.users.findBootstrapAdmin();

    if (existingBootstrapAdmin && !config.resetAdminOnStart) {
      logger.info({ email: config.admin.email }, 'bootstrap admin already exists');
      return;
    }

    const hash = await argon2.hash(config.admin.password);
    const userId = config.resetAdminOnStart
      ? this.users.resetBootstrapAdmin(config.admin.email, config.admin.name, hash)
      : this.users.createOrPromoteBootstrapAdmin(config.admin.email, config.admin.name, hash);

    this.sessions.deleteForUser(userId);
    logger.info(
      { email: config.admin.email, resetApplied: config.resetAdminOnStart },
      existingBootstrapAdmin ? 'bootstrap admin reset' : 'bootstrap admin created'
    );
  }

  async login(
    request: FastifyRequest,
    reply: FastifyReply,
    email: string,
    password: string
  ): Promise<CurrentUser | { requiresTwoFactor: true } | null> {
    const user = this.users.findByEmail(email);
    const valid = user ? await argon2.verify(user.passwordHash, password) : false;

    if (!user || !valid) {
      logger.warn({ email, ip: config.storeRawIp ? request.ip : undefined }, 'failed login');
      return null;
    }

    if (this.twoFactor.isEnabled(user.id)) {
      const challengeId = this.twoFactor.createPendingChallenge(user.id);
      reply.setCookie(config.pendingAuthCookieName, challengeId, this.pendingCookieOptions);
      reply.clearCookie(config.sessionCookieName, this.sessionCookieOptions);
      logger.info({ userId: user.id }, 'password accepted; two-factor verification required');
      return { requiresTwoFactor: true };
    }

    const currentUser = this.createSession(request, reply, user);
    logger.info({ email: user.email, userId: user.id }, 'successful login');
    return currentUser;
  }

  async completeTwoFactor(request: FastifyRequest, reply: FastifyReply, code: string) {
    const challengeId = request.cookies[config.pendingAuthCookieName];
    if (!challengeId) return null;
    const challenge = this.twoFactor.getPendingChallenge(challengeId);
    if (!challenge) {
      reply.clearCookie(config.pendingAuthCookieName, this.pendingCookieOptions);
      return null;
    }
    const user = this.users.findById(challenge.userId);
    if (!user || !await this.twoFactor.verifyFactor(user, code)) {
      this.twoFactor.recordPendingFailure(challengeId);
      return null;
    }
    this.twoFactor.consumePendingChallenge(challengeId);
    reply.clearCookie(config.pendingAuthCookieName, this.pendingCookieOptions);
    const currentUser = this.createSession(request, reply, user);
    logger.info({ userId: user.id }, 'successful two-factor login');
    return currentUser;
  }

  private createSession(request: FastifyRequest, reply: FastifyReply, user: ReturnType<UserRepository['findById']> & {}) {
    const sessionId = this.sessions.create({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      csrfSecret: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + config.sessionTtlHours * 3_600_000).toISOString(),
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null
    });

    reply.setCookie(config.sessionCookieName, sessionId, {
      ...this.sessionCookieOptions
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      theme: user.theme,
      sidebarCollapsed: user.sidebarCollapsed,
      locale: user.locale,
      preferencesInitialized: user.preferencesInitialized
    } satisfies CurrentUser;
  }

  logout(reply: FastifyReply, sessionId: string | undefined, pendingChallengeId?: string) {
    if (sessionId) this.sessions.delete(sessionId);
    if (pendingChallengeId) this.twoFactor.consumePendingChallenge(pendingChallengeId);
    reply.clearCookie(config.sessionCookieName, this.sessionCookieOptions);
    reply.clearCookie(config.pendingAuthCookieName, this.pendingCookieOptions);
  }

  async changePassword(userId: string, sessionId: string, nextPassword: string) {
    if (typeof nextPassword !== 'string' || !nextPassword.trim()) {
      throw new Error('New password is required.');
    }
    if (nextPassword.length < 12) {
      throw new Error('New password must contain at least 12 characters.');
    }
    if (nextPassword.length > 256) {
      throw new Error('New password must not exceed 256 characters.');
    }
    const passwordHash = await argon2.hash(nextPassword);
    this.users.updatePassword(userId, passwordHash);
    const user = this.users.findById(userId)!;
    this.sessions.updateSessionVersion(sessionId, user.sessionVersion);
    this.sessions.deleteOthers(userId, sessionId);
    logger.info({ userId }, 'password changed and sessions invalidated');
  }

  invalidateOtherSessionsAfterSensitiveChange(userId: string, currentSessionId: string) {
    const user = this.users.incrementSessionVersion(userId);
    if (!user) return;
    this.sessions.updateSessionVersion(currentSessionId, user.sessionVersion);
    this.sessions.deleteOthers(userId, currentSessionId);
  }
}
