import { describe, expect, test } from "vite-plus/test";
import { defineFetchRealization } from "@mit-sdg/sync-engine-http/realization";
import { serve } from "../src/serve/index.ts";

function realization(interfaceName: string) {
  return defineFetchRealization({
    interface: interfaceName,
    claims: [{ method: "GET", path: "/", declarations: [`${interfaceName}.Home`] }],
    async fetch() {
      return new Response(interfaceName);
    },
  });
}

describe("serve", () => {
  test("refuses colliding external claims before opening a listener", async () => {
    await expect(
      serve({
        at: { hostname: "127.0.0.1", port: 0 },
        realizations: [realization("Browser"), realization("Preview")],
      }),
    ).rejects.toThrow('GET / is claimed by both "Browser" and "Preview"');
  });
});
