import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { defineInterface, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { html, renderer } from "@mit-sdg/sync-engine-rendering/language";
import { expect, test } from "vite-plus/test";
import { realize } from "../src/realization/index.ts";

test("an opening holder document cannot be reused from a cache", async () => {
  const Hello = renderer("Greets the visitor.", () => html`<main>Hello.</main>`);
  const Home = endpoint("/", () => receive({}).then(respond(Hello({}))));
  const Browser = defineInterface({ Home });
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { Hello, Home, Browser },
  });
  const browser = realize({ system, interface: Browser });

  const response = await browser.fetch(new Request("http://system.test/"));

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
});
