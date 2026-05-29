import pino from 'pino';
import { config } from './config.js';

export const redactedLogPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.x-csrf-token',
  'req.headers.set-cookie',
  'request.headers.cookie',
  'request.headers.authorization',
  'request.headers.x-csrf-token',
  'headers.cookie',
  'headers.authorization',
  'headers.x-csrf-token',
  'cookie',
  'authorization',
  'csrfToken',
  'csrfSecret',
  'password',
  'passwordHash',
  'sessionId'
];

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: redactedLogPaths,
    censor: '[Redacted]'
  },
  transport:
    config.nodeEnv === 'development' || config.logPretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: true,
            messageFormat: '{msg}'
          }
        }
      : undefined,
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});
