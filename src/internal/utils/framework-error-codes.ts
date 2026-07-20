export const FrameworkErrorCode = {
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INVALID_INPUT: "INVALID_INPUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  TIMED_OUT: "TIMED_OUT",
  ABORTED: "ABORTED",
  TRANSPORT_ERROR: "TRANSPORT_ERROR",
  BAD_STATUS: "BAD_STATUS",
  NETWORK_ERROR: "NETWORK_ERROR",
  BAD_JSON: "BAD_JSON",
  HEADER_RESOLUTION_FAILED: "HEADER_RESOLUTION_FAILED",
} as const;

export type FrameworkErrorCode = (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode];

/** Framework codes the shipped boundaries can emit. */
export type EmittedFrameworkErrorCode = FrameworkErrorCode;
