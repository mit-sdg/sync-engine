import { describe, expect, test } from "vite-plus/test";
import {
  secureSessionToken,
  SESSION_TOKEN_BYTES,
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
} from "./sessioning.shared.ts";
import { SessioningMemoryConcept } from "./sessioning.memory.ts";

const START = new Date("2099-07-20T12:00:00.000Z");

function token(character: string): string {
  return character.repeat(43);
}

describe("Sessioning memory", () => {
  test("its principle: a fixed-lifetime session starts, resolves, ends, and expires", () => {
    let now = new Date(START);
    const values = [token("A"), token("B")];
    const sessioning = new SessioningMemoryConcept({
      clock: () => now,
      freshSession: () => values.shift() ?? "unexpected",
    });

    const started = sessioning.start({ subject: "ari" });
    expect(started).toEqual({
      session: token("A"),
      expiresAt: new Date("2099-07-20T12:30:00.000Z"),
    });
    expect(sessioning._active({ session: started.session })).toEqual([
      { subject: "ari", expiresAt: started.expiresAt },
    ]);
    expect(sessioning.current({ session: started.session })).toEqual({ subject: "ari" });
    expect(sessioning.end({ session: started.session })).toEqual({ ended: true });
    expect(sessioning._active({ session: started.session })).toEqual([]);

    for (const session of [started.session, token("Z")]) {
      const current = () => sessioning.current({ session });
      expect(current).toThrow(UnknownSession);
      expect(current).toThrow(UNKNOWN_SESSION_DETAIL);
    }

    const expiring = sessioning.start({ subject: "ari" });
    now = new Date("2099-07-20T12:29:59.999Z");
    expect(sessioning.current({ session: expiring.session })).toEqual({ subject: "ari" });
    expect(sessioning._active({ session: expiring.session })).toEqual([
      { subject: "ari", expiresAt: new Date("2099-07-20T12:30:00.000Z") },
    ]);
    now = new Date("2099-07-20T12:30:00.000Z");
    expect(sessioning._active({ session: expiring.session })).toEqual([]);
    expect(() => sessioning.current({ session: expiring.session })).toThrow(UnknownSession);
    expect(() => sessioning.end({ session: expiring.session })).toThrow(UnknownSession);
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
      clock: () => START,
      freshSession: () => values.shift() ?? "unexpected",
    });

    expect(sessioning.start({ subject: "ari" }).session).toBe(first);
    expect(sessioning.start({ subject: "bo" }).session).toBe(second);
    expect(sessioning.current({ session: first })).toEqual({ subject: "ari" });
    expect(sessioning.current({ session: second })).toEqual({ subject: "bo" });
  });

  test("each operation reads the trusted clock once", () => {
    let reads = 0;
    const sessioning = new SessioningMemoryConcept({
      clock: () => {
        reads += 1;
        return START;
      },
      freshSession: () => token("A"),
    });
    const { session } = sessioning.start({ subject: "ari" });
    expect(reads).toBe(1);
    sessioning.current({ session });
    expect(reads).toBe(2);
    sessioning._active({ session });
    expect(reads).toBe(3);
    sessioning.end({ session });
    expect(reads).toBe(4);
  });
});
