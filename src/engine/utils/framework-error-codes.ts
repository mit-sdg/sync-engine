export const FrameworkErrorCode = {
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INVALID_INPUT: "INVALID_INPUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
  TIMED_OUT: "TIMED_OUT",
  ABORTED: "ABORTED",
  TRANSPORT_ERROR: "TRANSPORT_ERROR",
} as const;

export type FrameworkErrorCode = (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode];
