import { redactValue } from "@/server/redact";

/**
 * Minimal structured JSON logger. Every field passes through `redactValue`,
 * so secrets are scrubbed even if a caller logs something it shouldn't.
 * Prompts, responses and headers must still never be passed in deliberately.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(options: { level?: LogLevel; bindings?: Record<string, unknown>; sink?: (line: string) => void } = {}): Logger {
  const threshold = LEVELS[options.level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info"] ?? LEVELS.info;
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < threshold) return;
    const record = redactValue({ time: new Date().toISOString(), level, msg: message, ...bindings, ...fields });
    try {
      sink(JSON.stringify(record));
    } catch {
      // Logging must never take down a request.
    }
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

export const logger = createLogger();

/** Logger that discards everything (tests). */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
