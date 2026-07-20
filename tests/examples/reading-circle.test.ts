import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import {
  createReadingCircleClient,
  loadCirclePage,
} from "../../examples/reading-circle/src/client.ts";
import { GatheringConcept } from "../../examples/concepts/gathering/gathering.ts";
import {
  buildReadingCircle,
  buildReadingCircleHttp,
} from "../../examples/reading-circle/src/edge.ts";
import { runScenario } from "../../examples/reading-circle/src/scenario.ts";
import type { ReadingCircleWire } from "../../examples/reading-circle/generated/wire.ts";

describe("canonical reading-circle example", () => {
  test("the typed client runs the complete scenario through the standard gateway", async () => {
    await expect(runScenario()).resolves.toEqual({
      page: {
        circle: "after-dinner",
        name: "After Dinner",
        host: "Mara",
        members: [{ member: "Mara" }, { member: "Lin" }],
        reading: {
          reading: "The Dispossessed",
          responses: [
            {
              response: "response-1",
              member: "Lin",
              text: "The two worlds make each other's assumptions visible.",
            },
          ],
        },
      },
      duplicate: "ALREADY_JOINED",
      denied: "NOT_A_MEMBER",
    });
  });

  test("the assembly accepts ready-made concept instances", async () => {
    const ids = ["seeded", "ada-membership"];
    const gathering = new GatheringConcept(() => ids.shift() ?? "unexpected");
    const { gathering: circle } = gathering.create({ name: "Seeded Gathering", host: "Ada" });
    const { gateway } = buildReadingCircle({ Gathering: gathering });
    const circles = createLocalClient<ReadingCircleWire>({ invoker: gateway });
    await circles.circles.choose({ circle, reading: "An Essay" });

    await expect(circles.circles.page({ circle })).resolves.toMatchObject({
      page: { circle, members: [{ member: "Ada" }], reading: { reading: "An Essay" } },
    });
  });

  test("the frontend client reaches the fixed gateway through HTTP", async () => {
    const { gateway, handler } = buildReadingCircleHttp();
    const local = createLocalClient<ReadingCircleWire>({ invoker: gateway });
    const created = await local.circles.create({ name: "Web Gathering", host: "Ada" });
    if ("error" in created) throw new Error(String(created.error));
    const circle = String(created.circle);
    await local.circles.choose({ circle, reading: "An Essay" });
    const frontend = createReadingCircleClient({
      baseUrl: "http://reading.test/api",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    await expect(loadCirclePage(frontend, circle)).resolves.toMatchObject({
      circle,
      members: [{ member: "Ada" }],
    });
  });

  test("two circles can select the same item without sharing discussion state", async () => {
    const { gateway } = buildReadingCircle();
    const circles = createLocalClient<ReadingCircleWire>({ invoker: gateway });
    const ids: string[] = [];
    for (const name of ["north", "south"]) {
      const created = await circles.circles.create({ name, host: name });
      if ("error" in created) throw new Error(String(created.error));
      const circle = String(created.circle);
      ids.push(circle);
      await circles.circles.choose({ circle, reading: "Shared Essay" });
    }
    await circles.circles.respond({
      circle: ids[0],
      reading: "Shared Essay",
      member: "north",
      text: "North's response",
    });

    await expect(circles.circles.page({ circle: ids[1] })).resolves.toMatchObject({
      page: { reading: { responses: [] } },
    });
  });

  test("a response names the circle's current reading", async () => {
    const { application, gateway } = buildReadingCircle();
    const circles = createLocalClient<ReadingCircleWire>({ invoker: gateway });
    const created = await circles.circles.create({ name: "specific", host: "Ada" });
    if ("error" in created) throw new Error(String(created.error));
    const circle = String(created.circle);
    await circles.circles.choose({ circle, reading: "Current Essay" });

    await expect(
      application.invoker.invoke(
        "/circles/respond",
        { circle, reading: "Different Essay", member: "Ada", text: "Wrong discussion" },
        { timeoutMs: 5 },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "framework", code: "TIMED_OUT" },
    });
  });

  test("the rendered design has no unwritten concept prose", async () => {
    const spec = await readFile(
      new URL("../../examples/reading-circle/generated/reading-circle.md", import.meta.url),
      "utf8",
    );
    expect(spec).not.toContain("[unwritten");
  });
});
