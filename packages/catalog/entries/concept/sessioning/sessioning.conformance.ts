import { expect } from "vite-plus/test";
import {
  InvalidSessionLifetime,
  INVALID_SESSION_LIFETIME_DETAIL,
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
} from "./sessioning.shared.ts";

type MaybePromise<Value> = Value | Promise<Value>;

export interface SessioningImplementation {
  start(input: {
    subject: string;
    lifetime: number;
    now: Date;
  }): MaybePromise<{ session: string; expiresAt: Date }>;
  current(input: { session: string; now: Date }): MaybePromise<{ subject: string }>;
  end(input: { session: string; now: Date }): MaybePromise<{ ended: boolean }>;
  _active(input: {
    session: string;
    now: Date;
  }): MaybePromise<Array<{ subject: string; expiresAt: Date }>>;
}

const noon = new Date("2026-01-01T12:00:00.000Z");
const twelveTen = new Date("2026-01-01T12:10:00.000Z");
const twelveEleven = new Date("2026-01-01T12:11:00.000Z");
const twelveTwelve = new Date("2026-01-01T12:12:00.000Z");
const twelveTwenty = new Date("2026-01-01T12:20:00.000Z");
const minute = 60_000;

async function expectRefusal(
  action: () => MaybePromise<unknown>,
  errorClass: new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  let refusal: unknown;
  try {
    await action();
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(errorClass);
  expect(refusal).toMatchObject({ message });
}

export async function expectSessioningConformance(
  sessioning: SessioningImplementation,
): Promise<void> {
  const first = await sessioning.start({ subject: "ari", lifetime: 20 * minute, now: noon });
  expect(first).toEqual({ session: expect.any(String), expiresAt: twelveTwenty });
  expect(await sessioning._active({ session: first.session, now: twelveTen })).toEqual([
    { subject: "ari", expiresAt: twelveTwenty },
  ]);
  expect(await sessioning.current({ session: first.session, now: twelveTen })).toEqual({
    subject: "ari",
  });
  expect(await sessioning.end({ session: first.session, now: twelveEleven })).toEqual({
    ended: true,
  });
  expect(await sessioning._active({ session: first.session, now: twelveEleven })).toEqual([]);
  await expectRefusal(
    () => sessioning.current({ session: first.session, now: twelveEleven }),
    UnknownSession,
    UNKNOWN_SESSION_DETAIL,
  );

  const second = await sessioning.start({
    subject: "ari",
    lifetime: 8 * minute,
    now: twelveTwelve,
  });
  expect(second.expiresAt).toEqual(twelveTwenty);
  expect(await sessioning._active({ session: second.session, now: twelveTwenty })).toEqual([]);
  await expectRefusal(
    () => sessioning.current({ session: second.session, now: twelveTwenty }),
    UnknownSession,
    UNKNOWN_SESSION_DETAIL,
  );
  await expectRefusal(
    () => sessioning.end({ session: second.session, now: twelveTwenty }),
    UnknownSession,
    UNKNOWN_SESSION_DETAIL,
  );
  await expectRefusal(
    () => sessioning.current({ session: "invented-session", now: twelveTen }),
    UnknownSession,
    UNKNOWN_SESSION_DETAIL,
  );

  for (const lifetime of [0, -1, Number.POSITIVE_INFINITY]) {
    await expectRefusal(
      () => sessioning.start({ subject: "ari", lifetime, now: noon }),
      InvalidSessionLifetime,
      INVALID_SESSION_LIFETIME_DETAIL,
    );
  }
}
