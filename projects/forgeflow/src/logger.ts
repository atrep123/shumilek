export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${level.toUpperCase()} ${message}`;
  if (!meta || Object.keys(meta).length === 0) return base;
  return `${base} ${JSON.stringify(meta)}`;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;
  return {
    debug(message, meta) {
      if (threshold <= LEVELS.debug) console.debug(formatLine('debug', message, meta));
    },
    info(message, meta) {
      if (threshold <= LEVELS.info) console.info(formatLine('info', message, meta));
    },
    warn(message, meta) {
      if (threshold <= LEVELS.warn) console.warn(formatLine('warn', message, meta));
    },
    error(message, meta) {
      if (threshold <= LEVELS.error) console.error(formatLine('error', message, meta));
    }
  };
}
