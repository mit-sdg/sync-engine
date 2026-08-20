import { describe, expect, test } from "vite-plus/test";
import { expectSessioningConformance } from "./sessioning.conformance.ts";
import { SessioningMemoryConcept } from "./sessioning.memory.ts";
import { secureSessionToken, SESSION_TOKEN_BYTES } from "./sessioning.shared.ts";

const START = new Date("2099-07-20T12:00:00.000Z");
const MINUTE = 60_000;

function token(character: string): string {
  return character.repeat(43);
}

describe("Sessioning memory", () => {
  test("conforms to the Sessioning principle and refusals", async () => {
    await expectSessioningConformance(new SessioningMemoryConcept());
  });

  test("secure bearer generation uses 32 random bytes encoded without padding", () => {
    const sessions = Array.from({ length: 64 }, () => secureSessionToken());
    expect(new Set(sessions).size).toBe(sessions.length);
    for (const session of sessions) {
      expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(session, "base64url")).toHaveLength(SESSION_TOKEN_BYTES);
    }
  });

  test("a colliding injected token cannot replace an active session", () => {
    const first = token("A");
    const second = token("B");
    const values = [first, first, second];
    const sessioning = new SessioningMemoryConcept({
      freshSession: () => values.shift() ?? "unexpected",
    });

    expect(sessioning.start({ subject: "ari", lifetime: 30 * MINUTE, now: START }).session).toBe(
      first,
    );
    expect(sessioning.start({ subject: "bo", lifetime: 5 * MINUTE, now: START }).session).toBe(
      second,
    );
    expect(sessioning.current({ session: first, now: START })).toEqual({ subject: "ari" });
    expect(sessioning.current({ session: second, now: START })).toEqual({ subject: "bo" });
  });
});
