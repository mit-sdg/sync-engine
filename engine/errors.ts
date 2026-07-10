export const EngineErrorCode = {
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type EngineErrorCode = (typeof EngineErrorCode)[keyof typeof EngineErrorCode];
