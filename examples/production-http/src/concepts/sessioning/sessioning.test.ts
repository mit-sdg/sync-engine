import { describe, expect, test } from "vite-plus/test";
import { SessioningConcept, UnknownSession } from "./sessioning.ts";

describe("Sessioning", () => {
  test("its principle: expiry is bounded, unauthorized, and removes the session", () => {
    let now = new Date("2026-07-20T12:00:00.000Z");
    const credentials = ["credential-one", "credential-two"];
    const sessioning = new SessioningConcept(
      () => now,
      () => credentials.shift() ?? "unexpected",
    );
    const first = sessioning.start({});

    expect(first).toEqual({
      session: "credential-one",
      expiresAt: new Date("2026-07-20T12:30:00.000Z"),
    });

    now = new Date("2026-07-20T12:29:59.999Z");
    expect(sessioning.current({ session: first.session })).toEqual({ active: true });

    now = new Date("2026-07-20T12:30:00.000Z");
    expect(() => sessioning.current({ session: first.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T12:29:00.000Z");
    expect(() => sessioning.current({ session: first.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T13:00:00.000Z");
    const second = sessioning.start({});
    now = new Date("2026-07-20T13:30:00.000Z");
    expect(() => sessioning.end({ session: second.session })).toThrow(UnknownSession);

    now = new Date("2026-07-20T13:29:00.000Z");
    expect(() => sessioning.current({ session: second.session })).toThrow(UnknownSession);
  });
});
