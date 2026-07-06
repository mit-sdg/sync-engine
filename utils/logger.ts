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
  LOG_LEVELS[(process.env.LOG_LEVEL?.toLowerCase() ?? "info") as LogLevel] ?? LOG_LEVELS.info;

const FORMAT = process.env.LOGGING_FORMAT === "pretty" ? "pretty" : "json";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string | null;
  duration?: number;
  method?: string;
  path?: string;
  statusCode?: number;
  [key: string]: unknown;
}

export function formatLogEntry(entry: LogEntry): string {
  if (FORMAT === "pretty") {
    const parts: string[] = [];
    parts.push(`[${entry.timestamp}]`);
    parts.push(`[${entry.level.toUpperCase().padEnd(5)}]`);
    if (entry.requestId) {
      parts.push(`[${entry.requestId.slice(0, 8)}]`);
    }
    if (entry.method && entry.path) {
      parts.push(`${entry.method} ${entry.path}`);
      if (entry.statusCode !== undefined) {
        parts.push(`${entry.statusCode}`);
      }
      if (entry.duration !== undefined) {
        parts.push(`${entry.duration.toFixed(1)}ms`);
      }
    }
    parts.push(entry.message);
    for (const [key, value] of Object.entries(entry)) {
      if (
        ![
          "level",
          "message",
          "timestamp",
          "requestId",
          "method",
          "path",
          "statusCode",
          "duration",
        ].includes(key) &&
        value !== undefined
      ) {
        parts.push(`${key}=${JSON.stringify(value)}`);
      }
    }
    return parts.join(" ");
  }

  return JSON.stringify(entry);
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  withRequestId(requestId: string): Logger;
  requestId?: string | null;
}

function createLogger(requestId?: string | null): Logger {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVELS[level] < MIN_LEVEL) return;

    const redacted = redact(meta ?? {}) as Record<string, unknown>;
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      requestId,
      ...redacted,
    };

    const output = formatLogEntry(entry);

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

  const logger: Logger = {
    requestId,
    debug(msg: string, meta?: Record<string, unknown>) {
      log("debug", msg, meta);
    },
    info(msg: string, meta?: Record<string, unknown>) {
      log("info", msg, meta);
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      log("warn", msg, meta);
    },
    error(msg: string, meta?: Record<string, unknown>) {
      log("error", msg, meta);
    },
    withRequestId(id: string): Logger {
      return createLogger(id);
    },
  };

  return logger;
}

export const logger: Logger = createLogger();
