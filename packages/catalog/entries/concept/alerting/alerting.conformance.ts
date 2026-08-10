import { expect, test } from "vite-plus/test";
import {
  AlertCauseConflict,
  AlertNotOpenForRecipient,
  type AlertDetails,
  type OpenAlertRecord,
} from "./alerting.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface AlertingImplementation {
  raise(input: {
    recipient: string;
    subject: string;
    cause: string;
    at: Date;
  }): Awaitable<{ alert: string }>;
  acknowledge(input: { alert: string; recipient: string }): Awaitable<{ alert: string }>;
  _openFor(input: { recipient: string }): Awaitable<OpenAlertRecord[]>;
  _get(input: { alert: string }): Awaitable<AlertDetails[]>;
}

export interface AlertingFixture {
  concept: AlertingImplementation;
  close(): Awaitable<void>;
}

export type AlertingFixtureFactory = (identities: readonly string[]) => Awaitable<AlertingFixture>;

function attempt<T>(operation: () => Awaitable<T>): Promise<T> {
  return Promise.resolve().then(operation);
}

export function defineAlertingConformance(create: AlertingFixtureFactory): void {
  test("follows the principle, retains closed alerts, and preserves state after refusals", async () => {
    const fixture = await create([
      "alert-mina",
      "replay-attempt",
      "conflict-attempt",
      "closed-replay-attempt",
    ]);
    const { concept } = fixture;
    const raisedAt = new Date("2026-01-02T03:04:05.000Z");
    const replayedAt = new Date("2026-01-03T03:04:05.000Z");
    try {
      const raised = await concept.raise({
        recipient: "Mina",
        subject: "deployment-7",
        cause: "selection-12",
        at: raisedAt,
      });
      expect(raised).toEqual({ alert: "alert-mina" });
      expect(
        await concept.raise({
          recipient: "Mina",
          subject: "deployment-7",
          cause: "selection-12",
          at: replayedAt,
        }),
      ).toEqual(raised);
      expect(await concept._get(raised)).toEqual([
        {
          recipient: "Mina",
          subject: "deployment-7",
          cause: "selection-12",
          raisedAt,
          open: true,
        },
      ]);

      await expect(
        attempt(() =>
          concept.raise({
            recipient: "Mina",
            subject: "deployment-8",
            cause: "selection-12",
            at: replayedAt,
          }),
        ),
      ).rejects.toThrow(AlertCauseConflict);
      await expect(
        attempt(() => concept.acknowledge({ ...raised, recipient: "Jo" })),
      ).rejects.toThrow(AlertNotOpenForRecipient);
      expect(await concept._openFor({ recipient: "Mina" })).toEqual([
        {
          alert: "alert-mina",
          subject: "deployment-7",
          cause: "selection-12",
          raisedAt,
        },
      ]);

      expect(await concept.acknowledge({ ...raised, recipient: "Mina" })).toEqual(raised);
      await expect(
        attempt(() => concept.acknowledge({ ...raised, recipient: "Mina" })),
      ).rejects.toThrow(AlertNotOpenForRecipient);
      expect(
        await concept.raise({
          recipient: "Mina",
          subject: "deployment-7",
          cause: "selection-12",
          at: replayedAt,
        }),
      ).toEqual(raised);
      expect(await concept._openFor({ recipient: "Mina" })).toEqual([]);
      expect(await concept._get(raised)).toEqual([
        {
          recipient: "Mina",
          subject: "deployment-7",
          cause: "selection-12",
          raisedAt,
          open: false,
        },
      ]);
      expect(await concept._get({ alert: "unknown" })).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  test("orders open alerts by raised time and then alert identity", async () => {
    const fixture = await create(["alert-z", "alert-a"]);
    const { concept } = fixture;
    const at = new Date("2026-02-03T04:05:06.000Z");
    try {
      await concept.raise({ recipient: "Mina", subject: "second", cause: "cause-z", at });
      await concept.raise({ recipient: "Mina", subject: "first", cause: "cause-a", at });
      expect(await concept._openFor({ recipient: "Mina" })).toEqual([
        { alert: "alert-a", subject: "first", cause: "cause-a", raisedAt: at },
        { alert: "alert-z", subject: "second", cause: "cause-z", raisedAt: at },
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("maps concurrent duplicate raises to one alert", async () => {
    const identities = Array.from({ length: 8 }, (_, index) => `alert-${index}`);
    const fixture = await create(identities);
    const { concept } = fixture;
    const at = new Date("2026-03-04T05:06:07.000Z");
    try {
      const results = await Promise.all(
        identities.map(() =>
          attempt(() =>
            concept.raise({
              recipient: "Mina",
              subject: "deployment-7",
              cause: "selection-12",
              at,
            }),
          ),
        ),
      );
      expect(new Set(results.map(({ alert }) => alert)).size).toBe(1);
      expect(await concept._openFor({ recipient: "Mina" })).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  test("allows only one concurrent acknowledgement", async () => {
    const fixture = await create(["alert"]);
    const { concept } = fixture;
    try {
      const raised = await concept.raise({
        recipient: "Mina",
        subject: "deployment-7",
        cause: "selection-12",
        at: new Date("2026-04-05T06:07:08.000Z"),
      });
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          attempt(() => concept.acknowledge({ ...raised, recipient: "Mina" })),
        ),
      );
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(5);
      for (const result of rejected) expect(result.reason).toBeInstanceOf(AlertNotOpenForRecipient);
      expect(await concept._get(raised)).toEqual([
        {
          recipient: "Mina",
          subject: "deployment-7",
          cause: "selection-12",
          raisedAt: new Date("2026-04-05T06:07:08.000Z"),
          open: false,
        },
      ]);
    } finally {
      await fixture.close();
    }
  });
}
