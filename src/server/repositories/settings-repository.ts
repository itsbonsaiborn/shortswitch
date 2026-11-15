import { config } from '../config.js';
import type { SecuritySettings } from '@/shared/types.js';
import { getDb } from '../db.js';
import {
  defaultDisplayPreferences,
  parseDisplayPreferences,
  type PublicDisplayPreferences
} from '../../shared/display-preferences.js';

const defaults: SecuritySettings = {
  loginMaxFailedAttempts: config.defaults.loginMaxFailedAttempts,
  loginAttemptWindowMinutes: config.defaults.loginAttemptWindowMinutes,
  loginBlockMinutes: config.defaults.loginBlockMinutes,
  protectedLinkMaxFailedAttempts: config.defaults.protectedLinkMaxFailedAttempts,
  protectedLinkAttemptWindowMinutes: config.defaults.protectedLinkAttemptWindowMinutes,
  protectedLinkBlockMinutes: config.defaults.protectedLinkBlockMinutes,
  minSlugLength: config.defaults.minSlugLength,
  maxSlugLength: config.defaults.maxSlugLength,
  slugAllowedChars: config.defaults.slugAllowedChars
};

export class SettingsRepository {
  private readonly publicDisplayKey = 'public_display_preferences';

  getSecuritySettings(): SecuritySettings {
    return { ...defaults };
  }

  getPublicDisplayPreferences(): PublicDisplayPreferences {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?')
      .get(this.publicDisplayKey) as { value: string } | undefined;
    if (!row) return { ...defaultDisplayPreferences };
    try {
      return parseDisplayPreferences(JSON.parse(row.value));
    } catch {
      return { ...defaultDisplayPreferences };
    }
  }

  updatePublicDisplayPreferences(preferences: PublicDisplayPreferences): PublicDisplayPreferences {
    const normalized = parseDisplayPreferences(preferences);
    getDb().prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(this.publicDisplayKey, JSON.stringify(normalized));
    return normalized;
  }
}
