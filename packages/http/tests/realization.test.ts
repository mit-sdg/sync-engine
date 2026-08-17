import { describe, expect, test } from "vite-plus/test";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { defineInterface, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { realize } from "../src/realization/index.ts";

describe("HTTP realization", () => {
  test("projects selected endpoints as checked POST claims over the admitted gateway", async () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const Api = defineInterface({ Ping });
    const system = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: {},
      interfaces: { Ping, Api },
    });
    const api = realize({ system, interface: Api });

    expect(api.claims).toEqual([{ method: "POST", path: "/ping", declarations: ["Ping"] }]);
    const response = await api.fetch(
      new Request("http://system.test/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
