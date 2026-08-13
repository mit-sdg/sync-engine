import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { AlertingMemoryConcept } from "../entries/concept/alerting/alerting.memory.ts";
import { AlertingMongoConcept } from "../entries/concept/alerting/alerting.mongo.ts";
import { CommentingMemoryConcept } from "../entries/concept/commenting/commenting.memory.ts";
import { CommentingMongoConcept } from "../entries/concept/commenting/commenting.mongo.ts";
import { DiscussingMemoryConcept } from "../entries/concept/discussing/discussing.memory.ts";
import { DiscussingMongoConcept } from "../entries/concept/discussing/discussing.mongo.ts";
import { GatheringMemoryConcept } from "../entries/concept/gathering/gathering.memory.ts";
import { GatheringMongoConcept } from "../entries/concept/gathering/gathering.mongo.ts";
import { LabelingMemoryConcept } from "../entries/concept/labeling/labeling.memory.ts";
import { LabelingMongoConcept } from "../entries/concept/labeling/labeling.mongo.ts";
import { PostingMemoryConcept } from "../entries/concept/posting/posting.memory.ts";
import { PostingMongoConcept } from "../entries/concept/posting/posting.mongo.ts";
import { SelectingMemoryConcept } from "../entries/concept/selecting/selecting.memory.ts";
import { SelectingMongoConcept } from "../entries/concept/selecting/selecting.mongo.ts";
import { TimingConcept } from "../entries/concept/timing/timing.ts";
import { TrashingMemoryConcept } from "../entries/concept/trashing/trashing.memory.ts";
import { TrashingMongoConcept } from "../entries/concept/trashing/trashing.mongo.ts";
import { vocabulary } from "../entries/_typecheck/concept-set.ts";
import { compositions as incidentCompositions } from "../entries/recipe/incident-room/incident-room.ts";
import { compositions as boardCompositions } from "../entries/recipe/recoverable-board/recoverable-board.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const mongoEnabled =
  environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
type Floor = "memory" | "mongo";
type Awaitable<T> = T | Promise<T>;

function identities(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${String(++next)}`;
}

function clock(...instants: Date[]): { concept: TimingConcept; reads: () => number } {
  let index = 0;
  return {
    concept: new TimingConcept(() => {
      const instant = instants[Math.min(index, instants.length - 1)];
      index += 1;
      if (instant === undefined) throw new Error("The test clock has no instant.");
      return new Date(instant.getTime());
    }),
    reads: () => index,
  };
}

async function database(
  prefix: string,
  floor: Floor,
): Promise<{
  db?: Db;
  close(): Promise<void>;
}> {
  if (floor === "memory") return { close: async () => {} };
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`${prefix}_${crypto.randomUUID()}`);
  return {
    db,
    close: async () => {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}

type IncidentInstances = {
  Alerting: AlertingMemoryConcept | AlertingMongoConcept;
  Discussing: DiscussingMemoryConcept | DiscussingMongoConcept;
  Gathering: GatheringMemoryConcept | GatheringMongoConcept;
  Selecting: SelectingMemoryConcept | SelectingMongoConcept;
  Timing: TimingConcept;
};

type BoardInstances = {
  Commenting: CommentingMemoryConcept | CommentingMongoConcept;
  Labeling: LabelingMemoryConcept | LabelingMongoConcept;
  Posting: PostingMemoryConcept | PostingMongoConcept;
  Timing: TimingConcept;
  Trashing: TrashingMemoryConcept | TrashingMongoConcept;
};

async function incidentFloor(floor: Floor) {
  const resource = await database("catalog_incident_room", floor);
  const testClock = clock(
    new Date("2026-08-10T10:00:00.000Z"),
    new Date("2026-08-10T10:01:00.000Z"),
    new Date("2026-08-10T10:02:00.000Z"),
    new Date("2026-08-10T10:03:00.000Z"),
  );
  const instances: IncidentInstances =
    floor === "memory"
      ? {
          Alerting: new AlertingMemoryConcept(identities("alert")),
          Discussing: new DiscussingMemoryConcept(identities("discussion")),
          Gathering: new GatheringMemoryConcept(identities("gathering")),
          Selecting: new SelectingMemoryConcept(identities("selection")),
          Timing: testClock.concept,
        }
      : {
          Alerting: new AlertingMongoConcept({
            db: resource.db as Db,
            freshID: identities("alert"),
          }),
          Discussing: new DiscussingMongoConcept(resource.db as Db, identities("discussion")),
          Gathering: new GatheringMongoConcept(resource.db as Db, identities("gathering")),
          Selecting: new SelectingMongoConcept(resource.db as Db, identities("selection")),
          Timing: testClock.concept,
        };
  return { instances, reads: testClock.reads, close: resource.close };
}

async function boardFloor(floor: Floor) {
  const resource = await database("catalog_recoverable_board", floor);
  const testClock = clock(
    new Date("2026-08-10T11:00:00.000Z"),
    new Date("2026-08-10T11:01:00.000Z"),
    new Date("2026-08-10T11:02:00.000Z"),
    new Date("2026-08-10T11:03:00.000Z"),
    new Date("2026-08-10T11:04:00.000Z"),
  );
  const instances: BoardInstances =
    floor === "memory"
      ? {
          Commenting: new CommentingMemoryConcept(identities("comment")),
          Labeling: new LabelingMemoryConcept(identities("label")),
          Posting: new PostingMemoryConcept(identities("post")),
          Timing: testClock.concept,
          Trashing: new TrashingMemoryConcept(),
        }
      : {
          Commenting: new CommentingMongoConcept(resource.db as Db, identities("comment")),
          Labeling: new LabelingMongoConcept(resource.db as Db, identities("label")),
          Posting: new PostingMongoConcept(resource.db as Db, identities("post")),
          Timing: testClock.concept,
          Trashing: new TrashingMongoConcept(resource.db as Db),
        };
  return { instances, reads: testClock.reads, close: resource.close };
}

const incidentComposition = {
  ...incidentCompositions.RoomMembership,
  ...incidentCompositions.MitigationDiscussion,
  ...incidentCompositions.MitigationAlerts,
  ...incidentCompositions.IncidentDashboard,
};

const boardComposition = {
  ...boardCompositions.BoardContent,
  ...boardCompositions.BoardLabels,
  ...boardCompositions.PostRecovery,
  ...boardCompositions.BoardPages,
};

function incidentApplication(
  instances: IncidentInstances,
  overrides: Partial<IncidentInstances> = {},
) {
  return assemble({
    vocabulary,
    instances: { ...instances, ...overrides } as never,
    composition: incidentComposition,
    queryCache: "none",
  });
}

function boardApplication(instances: BoardInstances) {
  return assemble({
    vocabulary,
    instances: instances as never,
    composition: boardComposition,
    queryCache: "none",
  });
}

function interruptedDiscussing(
  target: IncidentInstances["Discussing"],
  call: number,
): IncidentInstances["Discussing"] {
  let calls = 0;
  return {
    open(input: { subject: string; at: Date }) {
      calls += 1;
      if (calls === call) throw new Error(`Interrupted open at call ${String(call)}.`);
      return target.open(input);
    },
    respond(input: { discussion: string; author: string; text: string; at: Date }) {
      return target.respond(input);
    },
    close(input: { discussion: string; at: Date }) {
      return target.close(input);
    },
    _openFor(input: { subject: string }) {
      return target._openFor(input);
    },
    _responses(input: { discussion: string }) {
      return target._responses(input);
    },
    _response(input: { response: string }) {
      return target._response(input);
    },
  } as unknown as IncidentInstances["Discussing"];
}

function interruptedAlerting(
  target: IncidentInstances["Alerting"],
  call: number,
  persistent = false,
): IncidentInstances["Alerting"] {
  let calls = 0;
  return {
    raise(input: { recipient: string; subject: string; cause: string; at: Date }) {
      calls += 1;
      if (calls === call || (persistent && calls > call)) {
        throw new Error(`Interrupted raise at call ${String(call)}.`);
      }
      return target.raise(input);
    },
    acknowledge(input: { alert: string; recipient: string }) {
      return target.acknowledge(input);
    },
    _openFor(input: { recipient: string }) {
      return target._openFor(input);
    },
    _get(input: { alert: string }) {
      return target._get(input);
    },
  } as unknown as IncidentInstances["Alerting"];
}

async function createIncidentRoom(
  application: ReturnType<typeof incidentApplication>,
): Promise<{ room: string; members: readonly string[] }> {
  const created = await application.invoker.invoke("/incident-rooms/create", {
    name: "Checkout latency",
    host: "Mara",
  });
  expect(created).toEqual({ ok: true, value: { room: "gathering-1" } });
  const room = "gathering-1";
  await expect(
    application.invoker.invoke("/incident-rooms/join", { room, member: "Lin" }),
  ).resolves.toEqual({ ok: true, value: { membership: "gathering-3" } });
  return { room, members: ["Mara", "Lin"] };
}

async function rows<T>(value: Awaitable<T>): Promise<T> {
  return value;
}

for (const floor of ["memory", "mongo"] as const) {
  describe(`Incident Room ${floor} floor`, () => {
    test.skipIf(floor === "mongo" && !mongoEnabled)(
      "uses one time binding, current-member snapshot semantics, and all endpoints",
      async () => {
        const fixture = await incidentFloor(floor);
        try {
          const application = incidentApplication(fixture.instances);
          const { room } = await createIncidentRoom(application);
          await expect(
            application.invoker.invoke("/incident-rooms/join", { room, member: "Lin" }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "ALREADY_JOINED" },
          });
          const chosen = await application.invoker.invoke("/incident-rooms/choose", {
            room,
            mitigation: "rollback-build-842",
          });
          expect(chosen).toEqual({
            ok: true,
            value: { selection: "selection-1", discussion: "discussion-1" },
          });
          expect(fixture.reads()).toBe(1);

          const discussion = await rows(
            fixture.instances.Discussing._openFor({ subject: "selection-1" }),
          );
          const maraAlerts = await rows(fixture.instances.Alerting._openFor({ recipient: "Mara" }));
          const linAlerts = await rows(fixture.instances.Alerting._openFor({ recipient: "Lin" }));
          expect(discussion).toEqual([
            {
              discussion: "discussion-1",
              openedAt: new Date("2026-08-10T10:00:00.000Z"),
            },
          ]);
          expect(maraAlerts).toEqual([
            {
              alert: "alert-1",
              subject: "selection-1",
              cause: "selection-1",
              raisedAt: new Date("2026-08-10T10:00:00.000Z"),
            },
          ]);
          expect(linAlerts[0]).toMatchObject({
            subject: "selection-1",
            cause: "selection-1",
            raisedAt: new Date("2026-08-10T10:00:00.000Z"),
          });

          await application.concepts.Gathering.join({ gathering: room, member: "Jo" });
          await application.concepts.Gathering.leave({ gathering: room, member: "Lin" });
          await expect(
            application.invoker.invoke("/incident-rooms/repair", {
              room,
              selection: "selection-1",
              member: "Mara",
            }),
          ).resolves.toMatchObject({ ok: true });
          expect(await rows(fixture.instances.Alerting._openFor({ recipient: "Jo" }))).toEqual([]);
          expect(await rows(fixture.instances.Alerting._openFor({ recipient: "Lin" }))).toEqual(
            linAlerts,
          );

          await expect(
            application.invoker.invoke("/incident-rooms/contribute", {
              room,
              member: "Jo",
              text: "Rollback is healthy.",
            }),
          ).resolves.toEqual({ ok: true, value: { response: "discussion-2" } });
          await expect(
            application.invoker.invoke("/incident-rooms/contribute", {
              room,
              member: "Lin",
              text: "I already left.",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "NOT_A_ROOM_MEMBER" },
          });

          const dashboard = await application.invoker.invoke("/incident-rooms/dashboard", {
            room,
          });
          expect(dashboard).toMatchObject({
            ok: true,
            value: {
              dashboard: {
                room,
                members: [{ member: "Mara" }, { member: "Jo" }],
                current: {
                  selection: "selection-1",
                  mitigation: "rollback-build-842",
                  discussion: "discussion-1",
                  responses: [
                    {
                      response: "discussion-2",
                      member: "Jo",
                      text: "Rollback is healthy.",
                    },
                  ],
                },
              },
            },
          });

          await expect(
            application.invoker.invoke("/incident-rooms/acknowledge", {
              alert: maraAlerts[0]?.alert,
              member: "Jo",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "ALERT_NOT_OPEN_FOR_RECIPIENT" },
          });
          await expect(
            application.invoker.invoke("/incident-rooms/acknowledge", {
              alert: maraAlerts[0]?.alert,
              member: "Mara",
            }),
          ).resolves.toEqual({ ok: true, value: { alert: "alert-1" } });
          await expect(
            application.invoker.invoke("/incident-rooms/acknowledge", {
              alert: maraAlerts[0]?.alert,
              member: "Mara",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "ALERT_NOT_OPEN_FOR_RECIPIENT" },
          });
          await expect(
            application.invoker.invoke("/incident-rooms/close-discussion", { room }),
          ).resolves.toEqual({ ok: true, value: { discussion: "discussion-1" } });
        } finally {
          await fixture.close();
        }
      },
    );

    for (const interruption of [
      { name: "after Selection", concept: "Discussing", call: 1, persistent: false },
      { name: "after Discussion creation", concept: "Alerting", call: 1, persistent: true },
      { name: "during Alert fan-out", concept: "Alerting", call: 2, persistent: false },
    ] as const) {
      test.skipIf(floor === "mongo" && !mongoEnabled)(
        `repairs an interruption ${interruption.name}`,
        async () => {
          const fixture = await incidentFloor(floor);
          try {
            const setup = incidentApplication(fixture.instances);
            const { room, members } = await createIncidentRoom(setup);
            const broken =
              interruption.concept === "Discussing"
                ? incidentApplication(fixture.instances, {
                    Discussing: interruptedDiscussing(
                      fixture.instances.Discussing,
                      interruption.call,
                    ),
                  })
                : incidentApplication(fixture.instances, {
                    Alerting: interruptedAlerting(
                      fixture.instances.Alerting,
                      interruption.call,
                      interruption.persistent,
                    ),
                  });
            await expect(
              broken.invoker.invoke("/incident-rooms/choose", {
                room,
                mitigation: "rollback-build-842",
              }),
            ).resolves.toEqual({
              ok: false,
              error: { kind: "framework", code: "INTERNAL_ERROR" },
            });

            const current = await rows(fixture.instances.Selecting._current({ scope: room }));
            expect(current).toEqual([
              {
                selection: "selection-1",
                scope: room,
                item: "rollback-build-842",
              },
            ]);
            const beforeDiscussion = await rows(
              fixture.instances.Discussing._openFor({ subject: "selection-1" }),
            );
            const beforeAlerts = await Promise.all(
              members.map((recipient) => rows(fixture.instances.Alerting._openFor({ recipient }))),
            );
            if (interruption.name === "after Selection") {
              expect(beforeDiscussion).toEqual([]);
              expect(beforeAlerts.flat()).toEqual([]);
            } else if (interruption.name === "after Discussion creation") {
              expect(beforeDiscussion).toHaveLength(1);
              expect(beforeAlerts.flat()).toEqual([]);
            } else {
              expect(beforeDiscussion).toHaveLength(1);
              expect(beforeAlerts.flat()).toHaveLength(1);
            }

            const repaired = incidentApplication(fixture.instances);
            for (const member of members) {
              await expect(
                repaired.invoker.invoke("/incident-rooms/repair", {
                  room,
                  selection: "selection-1",
                  member,
                }),
              ).resolves.toMatchObject({ ok: true });
            }
            const openDiscussion = await rows(
              fixture.instances.Discussing._openFor({ subject: "selection-1" }),
            );
            expect(openDiscussion).toHaveLength(1);
            const alerts = await Promise.all(
              members.map((recipient) => rows(fixture.instances.Alerting._openFor({ recipient }))),
            );
            expect(alerts.every((found) => found.length === 1)).toBe(true);
            for (const [alert] of alerts) {
              expect(alert).toMatchObject({
                subject: "selection-1",
                cause: "selection-1",
                raisedAt: openDiscussion[0]?.openedAt,
              });
            }

            const firstAlertIDs = alerts.map(([alert]) => alert?.alert);
            for (const member of members) {
              await repaired.invoker.invoke("/incident-rooms/repair", {
                room,
                selection: "selection-1",
                member,
              });
            }
            const replayed = await Promise.all(
              members.map((recipient) => rows(fixture.instances.Alerting._openFor({ recipient }))),
            );
            expect(replayed.map(([alert]) => alert?.alert)).toEqual(firstAlertIDs);
          } finally {
            await fixture.close();
          }
        },
      );
    }
  });

  describe(`Recoverable Board ${floor} floor`, () => {
    test.skipIf(floor === "mongo" && !mongoEnabled)(
      "uses disposition-only visibility while retaining Posting and Commenting records",
      async () => {
        const fixture = await boardFloor(floor);
        try {
          const application = boardApplication(fixture.instances);
          await expect(
            application.invoker.invoke("/recoverable-board/post", {
              author: "Ari",
              content: "Rollback completed",
            }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
          await expect(
            application.invoker.invoke("/recoverable-board/comment", {
              post: "post-1",
              author: "Bo",
              text: "Latency is normal.",
            }),
          ).resolves.toEqual({ ok: true, value: { comment: "comment-1" } });
          await expect(
            application.invoker.invoke("/recoverable-board/create-label", { name: "resolved" }),
          ).resolves.toEqual({ ok: true, value: { label: "label-1" } });
          await expect(
            application.invoker.invoke("/recoverable-board/label", {
              post: "post-1",
              label: "label-1",
            }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1", label: "label-1" } });

          const visible = {
            posts: [
              {
                post: "post-1",
                author: "Ari",
                content: "Rollback completed",
                publishedAt: new Date("2026-08-10T11:00:00.000Z"),
                comments: [
                  {
                    comment: "comment-1",
                    author: "Bo",
                    text: "Latency is normal.",
                    addedAt: new Date("2026-08-10T11:01:00.000Z"),
                  },
                ],
                labels: [{ label: "label-1", name: "resolved" }],
              },
            ],
          };
          await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
            ok: true,
            value: { board: visible },
          });

          await expect(
            application.invoker.invoke("/recoverable-board/trash", { post: "post-1" }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
          await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
            ok: true,
            value: { board: { posts: [] } },
          });
          await expect(
            application.invoker.invoke("/recoverable-board/comment", {
              post: "post-1",
              author: "Cy",
              text: "Hidden comment",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "POST_NOT_VISIBLE" },
          });
          expect(await rows(fixture.instances.Posting._get({ post: "post-1" }))).toHaveLength(1);
          expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(
            1,
          );
          expect(
            await rows(
              fixture.instances.Labeling._for({ scope: "recoverable-board", item: "post-1" }),
            ),
          ).toEqual([{ label: "label-1", name: "resolved" }]);

          await expect(
            application.invoker.invoke("/recoverable-board/restore", { post: "post-1" }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
          await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
            ok: true,
            value: { board: visible },
          });

          await application.invoker.invoke("/recoverable-board/trash", { post: "post-1" });
          await expect(
            application.invoker.invoke("/recoverable-board/purge", { post: "post-1" }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1" } });
          await expect(application.invoker.invoke("/recoverable-board/list", {})).resolves.toEqual({
            ok: true,
            value: { board: { posts: [] } },
          });
          await expect(
            application.invoker.invoke("/recoverable-board/restore", { post: "post-1" }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "ITEM_PURGED" },
          });

          // Purge is a permanent visibility decision, not a physical erasure claim.
          expect(await rows(fixture.instances.Posting._get({ post: "post-1" }))).toHaveLength(1);
          expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(
            1,
          );
          expect(
            await rows(
              fixture.instances.Labeling._for({ scope: "recoverable-board", item: "post-1" }),
            ),
          ).toEqual([{ label: "label-1", name: "resolved" }]);
          expect(await rows(fixture.instances.Trashing._state({ item: "post-1" }))).toEqual({
            status: "purged",
          });
          expect(fixture.reads()).toBe(5);
        } finally {
          await fixture.close();
        }
      },
    );

    test.skipIf(floor === "mongo" && !mongoEnabled)(
      "returns owner refusal codes without changing retained records",
      async () => {
        const fixture = await boardFloor(floor);
        try {
          const application = boardApplication(fixture.instances);
          await expect(
            application.invoker.invoke("/recoverable-board/post", {
              author: "Ari",
              content: " ",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "INVALID_POST_CONTENT" },
          });
          await application.invoker.invoke("/recoverable-board/post", {
            author: "Ari",
            content: "Post",
          });
          await expect(
            application.invoker.invoke("/recoverable-board/comment", {
              post: "post-1",
              author: "Ari",
              text: " ",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "INVALID_COMMENT_TEXT" },
          });
          await application.invoker.invoke("/recoverable-board/comment", {
            post: "post-1",
            author: "Ari",
            text: "Comment",
          });
          await application.invoker.invoke("/recoverable-board/create-label", { name: "urgent" });
          await expect(
            application.invoker.invoke("/recoverable-board/create-label", { name: "urgent" }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "LABEL_NAME_TAKEN" },
          });
          await application.invoker.invoke("/recoverable-board/label", {
            post: "post-1",
            label: "label-1",
          });

          await expect(
            application.invoker.invoke("/recoverable-board/retract-comment", {
              comment: "comment-1",
              author: "Bo",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "COMMENT_AUTHOR_MISMATCH" },
          });
          await expect(
            application.invoker.invoke("/recoverable-board/label", {
              post: "post-1",
              label: "label-1",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "LABEL_ALREADY_APPLIED" },
          });
          await application.invoker.invoke("/recoverable-board/trash", { post: "post-1" });
          await expect(
            application.invoker.invoke("/recoverable-board/trash", { post: "post-1" }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "ITEM_ALREADY_TRASHED" },
          });
          await expect(
            application.invoker.invoke("/recoverable-board/unlabel", {
              post: "post-1",
              label: "label-1",
            }),
          ).resolves.toEqual({ ok: true, value: { post: "post-1", label: "label-1" } });
          await expect(
            application.invoker.invoke("/recoverable-board/unlabel", {
              post: "post-1",
              label: "label-1",
            }),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "LABEL_NOT_APPLIED" },
          });
          expect(await rows(fixture.instances.Commenting._for({ target: "post-1" }))).toHaveLength(
            1,
          );
        } finally {
          await fixture.close();
        }
      },
    );
  });
}
