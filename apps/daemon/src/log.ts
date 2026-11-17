import pino from 'pino'

export interface Logger {
  info(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

export function createLogger(level = process.env.BATON_LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'token',
        '*.token',
        '*.authorization',
        '*.apiKey',
        '*.secret',
        'req.headers.authorization',
      ],
      censor: '[redacted]',
    },
  })
}
