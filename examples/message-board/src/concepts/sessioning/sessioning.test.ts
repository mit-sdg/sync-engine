import { describe, expect, test } from "vite-plus/test";
import { SessioningConcept, UnknownSession } from "./sessioning.ts";

describe("Sessioning", () => {
  test("its principle: start, resolve, and end an opaque session", () => {
    const sessioning = new SessioningConcept(
      () => new Date("2099-07-20T12:00:00.000Z"),
      () => "session-1",
    );
    expect(sessioning.start({ subject: "ari" })).toEqual({
      session: "session-1",
      expiresAt: new Date("2099-07-20T12:30:00.000Z"),
    });
    expect(sessioning.current({ session: "session-1" })).toEqual({ subject: "ari" });
    expect(sessioning._active({ session: "session-1" })).toEqual([
      { subject: "ari", expiresAt: new Date("2099-07-20T12:30:00.000Z") },
    ]);
    expect(sessioning.end({ session: "session-1" })).toEqual({ ended: true });
    expect(sessioning._active({ session: "session-1" })).toEqual([]);
    expect(() => sessioning.current({ session: "session-1" })).toThrow(UnknownSession);
    expect(() => sessioning.current({ session: "invented" })).toThrow(UnknownSession);
  });

  test("an expired session is omitted by the query and removed by an action", () => {
    let now = new Date("2099-07-20T12:00:00.000Z");
    const sessioning = new SessioningConcept(
      () => now,
      () => "session-1",
    );
    sessioning.start({ subject: "ari" });
    now = new Date("2099-07-20T12:30:00.000Z");
    expect(sessioning._active({ session: "session-1" })).toEqual([]);
    expect(() => sessioning.current({ session: "session-1" })).toThrow(UnknownSession);
    expect(() => sessioning.end({ session: "session-1" })).toThrow(UnknownSession);
  });

  test("starting another session reclaims every expired record", () => {
    let now = new Date("2099-07-20T12:00:00.000Z");
    const values = ["session-1", "session-2"];
    const sessioning = new SessioningConcept(
      () => now,
      () => values.shift() ?? "exhausted",
    );
    sessioning.start({ subject: "ari" });
    now = new Date("2099-07-20T12:31:00.000Z");
    sessioning.start({ subject: "bo" });

    // Storage reclamation is intentionally not a public query, so this
    // implementation test inspects the teaching store directly.
    const stored = Reflect.get(sessioning, "sessions") as Map<string, unknown>;
    expect([...stored.keys()]).toEqual(["session-2"]);
  });
});
