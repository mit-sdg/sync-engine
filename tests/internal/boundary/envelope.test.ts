import { describe, expect, test } from "vite-plus/test";
import { fromEnvelope } from "@sync-engine/internal/boundary/protocol/envelope.ts";
import { FrameworkErrorCode } from "@sync-engine/internal/boundary/protocol/errors";

describe("fromEnvelope", () => {
  test("ignores authored framework classification fields", () => {
    expect(fromEnvelope({ error: "DOMAIN", errorKind: "framework" })).toEqual({
      ok: false,
      error: { kind: "domain", value: "DOMAIN" },
    });
  });

  test("accepts only declared codes on the framework response channel", () => {
    expect(fromEnvelope({ error: FrameworkErrorCode.TIMED_OUT }, "framework")).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });
    expect(fromEnvelope({ error: "DOMAIN" }, "framework")).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
  });
});
