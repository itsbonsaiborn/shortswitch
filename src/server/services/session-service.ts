import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser, UserSession } from '@/shared/types.js';
import { config } from '../config.js';
import { SessionRepository } from '../repositories/session-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export interface AuthenticatedRequest extends FastifyRequest {
  currentUser: CurrentUser;
  sessionId: string;
}

export class SessionService {
  private sessions = new SessionRepository();
  private users = new UserRepository();

  cleanup() {
    this.sessions.deleteExpired();
  }

  async getAuthenticatedUser(request: FastifyRequest) {
    const sessionId = request.cookies[config.sessionCookieName];
    if (!sessionId) return null;
    const session = this.sessions.findById(sessionId);
    if (!session) return null;
    if (session.expiresAt < new Date().toISOString()) {
      this.sessions.delete(sessionId);
      return null;
    }

    const user = this.users.findById(session.userId);
    if (!user || user.sessionVersion !== session.sessionVersion) {
      this.sessions.delete(sessionId);
      return null;
    }

    this.sessions.touch(sessionId);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        theme: user.theme,
        sidebarCollapsed: user.sidebarCollapsed,
        locale: user.locale,
        preferencesInitialized: user.preferencesInitialized
      },
      sessionId
    };
  }

  async requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedRequest | null> {
    const authenticated = await this.getAuthenticatedUser(request);
    if (!authenticated) {
      reply.code(401).send({ message: 'Authentication required.' });
      return null;
    }

    Object.assign(request, {
      currentUser: authenticated.user,
      sessionId: authenticated.sessionId
    });

    return request as AuthenticatedRequest;
  }

  listSessions(userId: string, currentSessionId: string): UserSession[] {
    return this.sessions.listForUser(userId).map((session) => ({
      ...session,
      isCurrent: session.id === currentSessionId
    }));
  }

  revokeSession(userId: string, currentSessionId: string, sessionId: string) {
    if (sessionId === currentSessionId) return false;
    const session = this.sessions.findById(sessionId);
    if (!session || session.userId !== userId) return false;
    this.sessions.delete(sessionId);
    return true;
  }
}
