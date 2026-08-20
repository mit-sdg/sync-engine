import { expect } from "vite-plus/test";
import { AlreadyScheduled, DeadlineInPast, NoDeadline } from "./expiring.shared.ts";

type MaybePromise<Value> = Value | Promise<Value>;

export interface ExpiringImplementation {
  schedule(input: {
    subject: string;
    expiresAt: string;
    now: string;
  }): MaybePromise<{ subject: string }>;
  reschedule(input: {
    subject: string;
    expiresAt: string;
    now: string;
  }): MaybePromise<{ subject: string }>;
  cancel(input: { subject: string }): MaybePromise<{ subject: string }>;
  _deadline(input: { subject: string }): MaybePromise<{ expiresAt: string }[]>;
  _lapsed(input: { subject: string; now: string }): MaybePromise<{ lapsed: boolean }>;
}

const eleven = "2026-01-01T11:00:00.000Z";
const noon = "2026-01-01T12:00:00.000Z";
const one = "2026-01-01T13:00:00.000Z";
const two = "2026-01-01T14:00:00.000Z";

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

export async function expectExpiringConformance(expiring: ExpiringImplementation): Promise<void> {
  expect(await expiring._deadline({ subject: "i1" })).toEqual([]);
  // A subject that never had a deadline has not lapsed; absence is not expiry.
  expect(await expiring._lapsed({ subject: "i1", now: one })).toEqual({ lapsed: false });

  expect(await expiring.schedule({ subject: "i1", expiresAt: noon, now: eleven })).toEqual({
    subject: "i1",
  });
  expect(await expiring._deadline({ subject: "i1" })).toEqual([{ expiresAt: noon }]);
  // Lapsing takes no action from anyone: the same state answers differently as time moves.
  expect(await expiring._lapsed({ subject: "i1", now: eleven })).toEqual({ lapsed: false });
  expect(await expiring._lapsed({ subject: "i1", now: one })).toEqual({ lapsed: true });

  await expectRefusal(
    () => expiring.schedule({ subject: "i1", expiresAt: two, now: eleven }),
    AlreadyScheduled,
    "That subject already has a deadline.",
  );
  await expectRefusal(
    () => expiring.schedule({ subject: "i2", expiresAt: eleven, now: noon }),
    DeadlineInPast,
    "A deadline must fall after the current instant.",
  );

  expect(await expiring.reschedule({ subject: "i1", expiresAt: two, now: one })).toEqual({
    subject: "i1",
  });
  expect(await expiring._lapsed({ subject: "i1", now: one })).toEqual({ lapsed: false });
  await expectRefusal(
    () => expiring.reschedule({ subject: "i2", expiresAt: two, now: one }),
    NoDeadline,
    "That subject has no deadline.",
  );

  expect(await expiring.cancel({ subject: "i1" })).toEqual({ subject: "i1" });
  expect(await expiring._deadline({ subject: "i1" })).toEqual([]);
  await expectRefusal(
    () => expiring.cancel({ subject: "i1" }),
    NoDeadline,
    "That subject has no deadline.",
  );
}
