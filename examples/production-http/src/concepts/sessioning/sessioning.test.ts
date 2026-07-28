import { describe, expect, test } from "vite-plus/test";
import { SessioningConcept, UnknownSession } from "./sessioning.ts";

describe("Sessioning", () => {
  test("its principle: expiry is bounded, unauthorized, and removes the session", () => {
    let now = new Date("2026-07-20T12:00:00.000Z");
    const sessioning = new SessioningConcept(() => now);
    const maya = sessioning.start({ user: "Maya" });

    expect(maya).toEqual({
      session: "session-maya",
      expiresAt: new Date("2026-07-20T12:30:00.000Z"),
      user: "Maya",
    });

    now = new Date("2026-07-20T12:29:59.999Z");
    expect(sessioning.current({ session: maya.session })).toEqual({ user: "Maya" });

    now = new Date("2026-07-20T12:30:00.000Z");
    expect(() => sessioning.current({ session: maya.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T12:29:00.000Z");
    expect(() => sessioning.current({ session: maya.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T13:00:00.000Z");
    const jo = sessioning.start({ user: "Jo" });
    now = new Date("2026-07-20T13:30:00.000Z");
    expect(() => sessioning.end({ session: jo.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T13:29:00.000Z");
    expect(() => sessioning.current({ session: jo.session })).toThrow(UnknownSession);
  });
});
