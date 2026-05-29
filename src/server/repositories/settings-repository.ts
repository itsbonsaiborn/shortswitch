import { config } from '../config.js';
import type { SecuritySettings } from '@/shared/types.js';

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
  getSecuritySettings(): SecuritySettings {
    return { ...defaults };
  }
}
