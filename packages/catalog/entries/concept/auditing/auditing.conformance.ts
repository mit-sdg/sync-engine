import { describe, expect, test } from "vite-plus/test";
import {
  ENTRY_EVENT_CONFLICT_MESSAGE,
  EntryEventConflict,
  INVALID_ENTRY_ACTION_MESSAGE,
  INVALID_ENTRY_DETAIL_MESSAGE,
  InvalidEntryAction,
  InvalidEntryDetail,
  type ActorEntryRecord,
  type EntryDetailsRecord,
  type RecordInput,
  type TargetEntryRecord,
  type TrailEntryRecord,
  type TrailExtentRecord,
} from "./auditing.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface AuditingBehavior {
  record(input: RecordInput): Awaitable<{ entry: string; position: number }>;
  _get(input: { entry: string }): Awaitable<EntryDetailsRecord[]>;
  _since(input: { trail: string; after: number }): Awaitable<TrailEntryRecord[]>;
  _byActor(input: { trail: string; actor: string }): Awaitable<ActorEntryRecord[]>;
  _forTarget(input: { trail: string; target: string }): Awaitable<TargetEntryRecord[]>;
  _extent(input: { trail: string }): Awaitable<TrailExtentRecord>;
}

export interface AuditingHarness {
  concept: AuditingBehavior;
  close(): Awaitable<void>;
}

export type AuditingHarnessFactory = (identities: readonly string[]) => Awaitable<AuditingHarness>;

const HOLD = new Date("2026-08-10T09:00:00.000Z");
const RELEASE = new Date("2026-08-10T09:05:00.000Z");

async function withAuditing(
  create: AuditingHarnessFactory,
  identities: readonly string[],
  run: (concept: AuditingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create(identities);
  try {
    await run(harness.concept);
  } finally {
    await harness.close();
  }
}

async function expectRefusal(
  attempt: () => Awaitable<unknown>,
  refusal: abstract new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  let caught: unknown;
  try {
    await attempt();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(refusal);
  expect((caught as Error).message).toBe(message);
}

export function auditingConformance(
  floor: string,
  create: AuditingHarnessFactory,
  skip = false,
): void {
  describe(`Auditing ${floor}`, () => {
    test.skipIf(skip)("follows its principle", async () => {
      await withAuditing(create, ["entry-1", "entry-2", "entry-3"], async (auditing) => {
        expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 0, last: 0 });

        const held = await auditing.record({
          trail: "workspace-1",
          event: "evt-1",
          actor: "ari",
          action: "reservation.hold",
          detail: "Held the 9am slot.",
          target: "slot-4",
          at: HOLD,
        });
        expect(held).toEqual({ entry: "entry-1", position: 1 });
        expect(
          await auditing.record({
            trail: "workspace-1",
            event: "evt-2",
            actor: "bo",
            action: "reservation.release",
            detail: "",
            target: "slot-9",
            at: RELEASE,
          }),
        ).toEqual({ entry: "entry-2", position: 2 });

        expect(await auditing._since({ trail: "workspace-1", after: 0 })).toEqual([
          {
            entry: "entry-1",
            position: 1,
            event: "evt-1",
            actor: "ari",
            action: "reservation.hold",
            detail: "Held the 9am slot.",
            target: "slot-4",
            recordedAt: HOLD,
          },
          {
            entry: "entry-2",
            position: 2,
            event: "evt-2",
            actor: "bo",
            action: "reservation.release",
            detail: "",
            target: "slot-9",
            recordedAt: RELEASE,
          },
        ]);
        expect(await auditing._get({ entry: "entry-1" })).toEqual([
          {
            trail: "workspace-1",
            position: 1,
            event: "evt-1",
            actor: "ari",
            action: "reservation.hold",
            detail: "Held the 9am slot.",
            target: "slot-4",
            recordedAt: HOLD,
          },
        ]);
        expect(
          (await auditing._forTarget({ trail: "workspace-1", target: "slot-4" })).map(
            ({ entry, actor }) => ({ entry, actor }),
          ),
        ).toEqual([{ entry: "entry-1", actor: "ari" }]);
        expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 2, last: 2 });

        expect(
          await auditing.record({
            trail: "workspace-1",
            event: "evt-1",
            actor: "ari",
            action: "reservation.hold",
            detail: "Held the 9am slot.",
            target: "slot-4",
            at: RELEASE,
          }),
        ).toEqual({ entry: "entry-1", position: 1 });
        await expectRefusal(
          () =>
            auditing.record({
              trail: "workspace-1",
              event: "evt-1",
              actor: "ari",
              action: "reservation.hold",
              detail: "Held the 9am slot.",
              target: "slot-7",
              at: RELEASE,
            }),
          EntryEventConflict,
          ENTRY_EVENT_CONFLICT_MESSAGE,
        );
        expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 2, last: 2 });
        expect((await auditing._get({ entry: "entry-1" }))[0]?.recordedAt).toEqual(HOLD);
      });
    });

    test.skipIf(skip)("refuses an unusable action or detail without recording it", async () => {
      await withAuditing(create, ["entry-1", "entry-2"], async (auditing) => {
        const ask = (action: string, detail: string): RecordInput => ({
          trail: "workspace-1",
          event: "evt-refused",
          actor: "ari",
          action,
          detail,
          target: "slot-4",
          at: HOLD,
        });

        for (const action of [" \n\t", "x".repeat(101)])
          await expectRefusal(
            () => auditing.record(ask(action, "")),
            InvalidEntryAction,
            INVALID_ENTRY_ACTION_MESSAGE,
          );
        await expectRefusal(
          () => auditing.record(ask("reservation.hold", "x".repeat(501))),
          InvalidEntryDetail,
          INVALID_ENTRY_DETAIL_MESSAGE,
        );
        expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 0, last: 0 });

        expect(await auditing.record(ask("x".repeat(100), "x".repeat(500)))).toEqual({
          entry: "entry-1",
          position: 1,
        });
        expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 1, last: 1 });
      });
    });

    test.skipIf(skip)("numbers each trail separately and reads back by actor", async () => {
      await withAuditing(create, ["entry-1", "entry-2", "entry-3", "entry-4"], async (auditing) => {
        const ask = (trail: string, event: string, actor: string): RecordInput => ({
          trail,
          event,
          actor,
          action: "gathering.join",
          detail: "",
          target: "gathering-3",
          at: HOLD,
        });

        expect(await auditing.record(ask("workspace-1", "evt-1", "ari"))).toEqual({
          entry: "entry-1",
          position: 1,
        });
        expect(await auditing.record(ask("workspace-2", "evt-1", "ari"))).toEqual({
          entry: "entry-2",
          position: 1,
        });
        expect(await auditing.record(ask("workspace-1", "evt-2", "bo"))).toEqual({
          entry: "entry-3",
          position: 2,
        });
        expect(await auditing.record(ask("workspace-1", "evt-3", "ari"))).toEqual({
          entry: "entry-4",
          position: 3,
        });

        expect(
          (await auditing._byActor({ trail: "workspace-1", actor: "ari" })).map(
            ({ entry, position }) => ({ entry, position }),
          ),
        ).toEqual([
          { entry: "entry-1", position: 1 },
          { entry: "entry-4", position: 3 },
        ]);
        expect(await auditing._byActor({ trail: "workspace-2", actor: "bo" })).toEqual([]);
        expect(
          (await auditing._since({ trail: "workspace-1", after: 1 })).map(
            ({ position }) => position,
          ),
        ).toEqual([2, 3]);
        expect(await auditing._since({ trail: "workspace-1", after: 3 })).toEqual([]);
        expect(await auditing._since({ trail: "workspace-3", after: 0 })).toEqual([]);
        expect(await auditing._extent({ trail: "workspace-2" })).toEqual({
          entries: 1,
          last: 1,
        });
        expect(await auditing._forTarget({ trail: "workspace-3", target: "gathering-3" })).toEqual(
          [],
        );
        expect(await auditing._get({ entry: "missing" })).toEqual([]);
      });
    });

    test.skipIf(skip)("keeps a recorded entry unchanged by later callers", async () => {
      await withAuditing(create, ["entry-1"], async (auditing) => {
        const supplied = new Date(HOLD.getTime());
        const recording = auditing.record({
          trail: "workspace-1",
          event: "evt-1",
          actor: "ari",
          action: "reservation.hold",
          detail: "Held the 9am slot.",
          target: "slot-4",
          at: supplied,
        });
        supplied.setUTCFullYear(2030);
        await recording;

        const [first] = await auditing._get({ entry: "entry-1" });
        expect(first?.recordedAt).toEqual(HOLD);
        first?.recordedAt.setUTCFullYear(2031);
        const [second] = await auditing._get({ entry: "entry-1" });
        expect(second?.recordedAt).toEqual(HOLD);
      });
    });
  });
}
