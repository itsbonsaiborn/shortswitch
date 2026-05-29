import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser } from '@/shared/types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { SessionRepository } from '../repositories/session-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export class AuthService {
  private users = new UserRepository();
  private sessions = new SessionRepository();
  private sessionCookieOptions = {
    httpOnly: true as const,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlHours * 3_600
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
  ): Promise<CurrentUser | null> {
    const user = this.users.findByEmail(email);
    const valid = user ? await argon2.verify(user.passwordHash, password) : false;

    if (!user || !valid) {
      logger.warn({ email, ip: config.storeRawIp ? request.ip : undefined }, 'failed login');
      return null;
    }

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

    logger.info({ email: user.email, userId: user.id }, 'successful login');

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      theme: user.theme
    };
  }

  logout(reply: FastifyReply, sessionId: string | undefined) {
    if (sessionId) this.sessions.delete(sessionId);
    reply.clearCookie(config.sessionCookieName, this.sessionCookieOptions);
  }

  async changePassword(userId: string, sessionId: string, nextPassword: string) {
    if (!nextPassword.trim()) {
      throw new Error('New password is required.');
    }
    const passwordHash = await argon2.hash(nextPassword);
    this.users.updatePassword(userId, passwordHash);
    const user = this.users.findById(userId)!;
    this.sessions.updateSessionVersion(sessionId, user.sessionVersion);
    this.sessions.deleteOthers(userId, sessionId);
    logger.info({ userId }, 'password changed and sessions invalidated');
  }
}
