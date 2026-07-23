import { redact, serializeError } from "./redaction.ts";

export { serializeError };

export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  none: Infinity,
};

const MIN_LEVEL =
  LOG_LEVELS[String(process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel] ?? LOG_LEVELS.info;

function safeJSON(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Emit one line as JSON when the level clears the configured threshold. */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < MIN_LEVEL) return;

  const redacted = redact(meta ?? {}) as Record<string, unknown>;
  const output = safeJSON({
    ...redacted,
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "debug":
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

export const logger: Logger = {
  debug(msg, meta) {
    log("debug", msg, meta);
  },
  info(msg, meta) {
    log("info", msg, meta);
  },
  warn(msg, meta) {
    log("warn", msg, meta);
  },
  error(msg, meta) {
    log("error", msg, meta);
  },
};
