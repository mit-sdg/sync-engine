import { expect } from "vite-plus/test";
import { AlreadyRegistered, NotRegistered } from "./registering.shared.ts";

type MaybePromise<Value> = Value | Promise<Value>;

export interface RegisteringImplementation {
  register(input: { subject: string; occurrence: string }): MaybePromise<{ registration: string }>;
  deregister(input: { occurrence: string }): MaybePromise<Record<string, never>>;
  _registration(input: { occurrence: string }): MaybePromise<{ subject: string }[]>;
  _registrations(input: { subject: string }): MaybePromise<{ occurrence: string }[]>;
}

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

export async function expectRegisteringConformance(
  registering: RegisteringImplementation,
): Promise<void> {
  expect(await registering._registration({ occurrence: "v1" })).toEqual([]);

  await registering.register({ subject: "p1", occurrence: "v1" });
  expect(await registering._registration({ occurrence: "v1" })).toEqual([{ subject: "p1" }]);

  // The mechanism exists for this line: a repeat report is refused, so nothing downstream
  // treats it as new.
  await expectRefusal(
    () => registering.register({ subject: "p1", occurrence: "v1" }),
    AlreadyRegistered,
    "That occurrence has already been registered.",
  );
  // An occurrence identity is claimed globally, so a repeat naming another subject is the
  // same occurrence rather than a new one.
  await expectRefusal(
    () => registering.register({ subject: "p2", occurrence: "v1" }),
    AlreadyRegistered,
    "That occurrence has already been registered.",
  );
  expect(await registering._registrations({ subject: "p2" })).toEqual([]);

  await registering.register({ subject: "p1", occurrence: "v2" });
  expect(await registering._registrations({ subject: "p1" })).toEqual([
    { occurrence: "v1" },
    { occurrence: "v2" },
  ]);

  await registering.deregister({ occurrence: "v1" });
  expect(await registering._registration({ occurrence: "v1" })).toEqual([]);
  await expectRefusal(
    () => registering.deregister({ occurrence: "v1" }),
    NotRegistered,
    "That occurrence was never registered.",
  );
}
