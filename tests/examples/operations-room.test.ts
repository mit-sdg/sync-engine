import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import {
  createOperationsRoomClient,
  loadRoomDashboard,
} from "../../examples/operations-room/src/client.ts";
import { AlertingConcept } from "../../examples/concepts/alerting/alerting.ts";
import { DiscussingConcept } from "../../examples/concepts/discussing/discussing.ts";
import { GatheringConcept } from "../../examples/concepts/gathering/gathering.ts";
import { SelectingConcept } from "../../examples/concepts/selecting/selecting.ts";
import { assembleOperationsRoom } from "../../examples/operations-room/src/assembly.ts";
import {
  currentMitigation,
  responseStats,
  requiredCurrentMitigation,
  roomSummary,
} from "../../examples/operations-room/src/composition/room.ts";
import { buildOperationsRoomHttp } from "../../examples/operations-room/src/edge.ts";
import { runScenario } from "../../examples/operations-room/src/scenario.ts";
import { identities } from "../../examples/support/identities.ts";

function buildRoom(options: {
  alerts: boolean;
  contributions?: "responders" | "host";
  discussion: boolean;
}) {
  return assembleOperationsRoom({
    ...options,
    instances: {
      Alerting: new AlertingConcept(identities("alert-mara", "alert-lin")),
      Discussing: new DiscussingConcept(identities("discussion-1", "response-1")),
      Gathering: new GatheringConcept(identities("checkout-latency", "member-mara", "member-lin")),
      Selecting: new SelectingConcept(identities("selection-1")),
    },
  });
}

async function selectMitigation(app: ReturnType<typeof assembleOperationsRoom>): Promise<string> {
  const created = await app.invoker.invoke("/rooms/create", {
    name: "Checkout latency",
    host: "Mara",
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const room = String((created.value as { room: unknown }).room);
  await app.invoker.invoke("/rooms/join", { room, responder: "Lin" });
  await app.invoker.invoke("/rooms/choose-mitigation", {
    room,
    mitigation: "rollback-build-842",
  });
  return room;
}

async function dashboard(app: ReturnType<typeof assembleOperationsRoom>, room: string) {
  const result = await app.invoker.invoke("/rooms/get", { room });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return (result.value as { dashboard: unknown }).dashboard;
}

describe("operations-room composition", () => {
  test("the typed client runs the complete scenario through the standard gateway", async () => {
    await expect(runScenario()).resolves.toEqual({
      dashboard: {
        room: "checkout-latency",
        name: "Checkout latency",
        host: "Mara",
        responders: [
          {
            responder: "Mara",
            alerts: [{ alert: "alert-mara", mitigation: "rollback-build-842" }],
          },
          {
            responder: "Lin",
            alerts: [{ alert: "alert-lin", mitigation: "rollback-build-842" }],
          },
        ],
        current: {
          mitigation: "rollback-build-842",
          discussion: "discussion-1",
          responses: [
            {
              response: "response-1",
              responder: "Lin",
              text: "Latency is falling after rollback.",
            },
          ],
          responseCount: 1,
        },
      },
      duplicate: "ALREADY_JOINED",
    });
  });

  test("the frontend client reaches the fixed gateway through HTTP", async () => {
    const { handler } = buildOperationsRoomHttp();
    const local = createOperationsRoomClient({
      baseUrl: "http://operations.test/api",
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const created = await local.rooms.create({ name: "Release response", host: "Mara" });
    if ("error" in created) throw new Error(String(created.error));
    const room = String(created.room);
    await local.rooms["choose-mitigation"]({ room, mitigation: "pause-rollout" });

    await expect(loadRoomDashboard(local, room)).resolves.toMatchObject({
      room,
      current: { mitigation: "pause-rollout" },
    });
  });

  test("the staged formers make list and absence choices visible", async () => {
    const app = buildRoom({ alerts: false, discussion: false });
    const created = await app.invoker.invoke("/rooms/create", {
      name: "Checkout latency",
      host: "Mara",
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const room = String((created.value as { room: unknown }).room);
    await app.invoker.invoke("/rooms/join", { room, responder: "Lin" });

    await expect(app.form(roomSummary(room))).resolves.toEqual({
      room,
      name: "Checkout latency",
      host: "Mara",
      responders: [{ responder: "Mara" }, { responder: "Lin" }],
    });
    await expect(app.form(currentMitigation(room))).resolves.toBeNull();
    await expect(app.form(requiredCurrentMitigation(room))).rejects.toThrow("FORMER_NONE");
    await expect(app.form(roomSummary as never)).rejects.toThrow(
      "form(...) takes a named former with its sentence slots filled, " +
        "for example form(roomDashboard(room)).",
    );

    await app.invoker.invoke("/rooms/choose-mitigation", {
      room,
      mitigation: "rollback-build-842",
    });
    await expect(app.form(currentMitigation(room))).resolves.toEqual({
      room,
      mitigation: "rollback-build-842",
    });
    await expect(app.form(requiredCurrentMitigation(room))).resolves.toEqual({
      room,
      mitigation: "rollback-build-842",
    });
  });

  test("adding reaction packs changes the room without changing its concepts", async () => {
    const base = buildRoom({ alerts: false, discussion: false });
    const baseRoom = await selectMitigation(base);
    await expect(dashboard(base, baseRoom)).resolves.toMatchObject({
      current: {
        mitigation: "rollback-build-842",
        discussion: null,
        responses: [],
        responseCount: 0,
      },
      responders: [
        { responder: "Mara", alerts: [] },
        { responder: "Lin", alerts: [] },
      ],
    });

    const withDiscussion = buildRoom({ alerts: false, discussion: true });
    const discussionRoom = await selectMitigation(withDiscussion);
    await expect(dashboard(withDiscussion, discussionRoom)).resolves.toMatchObject({
      current: { discussion: "discussion-1", responseCount: 0 },
      responders: [
        { responder: "Mara", alerts: [] },
        { responder: "Lin", alerts: [] },
      ],
    });
    await expect(withDiscussion.form(responseStats("discussion-1"))).resolves.toEqual({
      responseCount: 0,
      firstResponse: null,
      responders: [],
    });

    const withAlerts = buildRoom({ alerts: true, discussion: true });
    const alertRoom = await selectMitigation(withAlerts);
    await expect(dashboard(withAlerts, alertRoom)).resolves.toMatchObject({
      current: { discussion: "discussion-1", responseCount: 0 },
      responders: [
        {
          responder: "Mara",
          alerts: [{ alert: "alert-mara", mitigation: "rollback-build-842" }],
        },
        {
          responder: "Lin",
          alerts: [{ alert: "alert-lin", mitigation: "rollback-build-842" }],
        },
      ],
    });
  });

  test("changing one policy pack changes the same contribution request", async () => {
    const responders = buildRoom({ alerts: false, discussion: true });
    const responderRoom = await selectMitigation(responders);
    await expect(
      responders.invoker.invoke("/rooms/contribute", {
        room: responderRoom,
        responder: "Lin",
        text: "Latency is falling after rollback.",
      }),
    ).resolves.toEqual({ ok: true, value: { response: "response-1" } });
    await expect(dashboard(responders, responderRoom)).resolves.toMatchObject({
      current: { responseCount: 1 },
    });
    await expect(responders.form(responseStats("discussion-1"))).resolves.toEqual({
      responseCount: 1,
      firstResponse: "response-1",
      responders: ["Lin"],
    });

    const hostOnly = buildRoom({ alerts: false, contributions: "host", discussion: true });
    const hostRoom = await selectMitigation(hostOnly);
    await expect(
      hostOnly.invoker.invoke("/rooms/contribute", {
        room: hostRoom,
        responder: "Lin",
        text: "Latency is falling after rollback.",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "domain", value: "HOST_ONLY" },
    });
    await expect(dashboard(hostOnly, hostRoom)).resolves.toMatchObject({
      current: { responseCount: 0 },
    });
  });

  test("the rendered design has no unwritten concept prose", async () => {
    const spec = await readFile(
      new URL("../../examples/operations-room/generated/operations-room.md", import.meta.url),
      "utf8",
    );
    expect(spec).not.toContain("[unwritten");
  });
});
