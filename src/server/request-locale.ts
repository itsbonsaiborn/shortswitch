import type { FastifyRequest } from 'fastify';
import { resolvePreferredPublicLocale } from '../shared/public-locale.js';
import { SettingsRepository } from './repositories/settings-repository.js';

const settings = new SettingsRepository();

export const resolveRequestLocale = (request: FastifyRequest) => resolvePreferredPublicLocale(
  settings.getPublicDisplayPreferences().language,
  request.headers['accept-language']
);

export const resolveRequestAppearance = (_request: FastifyRequest) =>
  settings.getPublicDisplayPreferences().appearance;
