export type AnalysisErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "SNAPSHOT_MISMATCH"
  | "NOT_FOUND"
  | "CAPABILITY_UNAVAILABLE"
  | "LIMIT_EXCEEDED"
  | "ABORTED";

export type AnalysisErrorData = Readonly<Record<string, unknown>>;

function serializableData(data: AnalysisErrorData | undefined): AnalysisErrorData | undefined {
  if (data === undefined) return undefined;
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) return { detail: String(data) };
    return Object.freeze(JSON.parse(serialized) as Record<string, unknown>);
  } catch {
    return Object.freeze({ detail: String(data) });
  }
}

/** Stable, serializable failure returned by the granular analysis façade. */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly data?: AnalysisErrorData;

  constructor(code: AnalysisErrorCode, message: string, data?: AnalysisErrorData) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    this.data = serializableData(data);
  }

  toJSON(): {
    readonly name: "AnalysisError";
    readonly code: AnalysisErrorCode;
    readonly message: string;
    readonly data?: AnalysisErrorData;
  } {
    return {
      name: "AnalysisError",
      code: this.code,
      message: this.message,
      ...(this.data === undefined ? {} : { data: this.data }),
    };
  }
}
