import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { defineInterface, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { html, immediate, renderer } from "@mit-sdg/sync-engine-rendering/language";
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

test("realizing refuses an admitted immediate with no bound implementation", () => {
  const Clear = immediate("Empties its field after acceptance.", {
    on: "accepted",
    field: "field",
  });
  class NotingConcept {
    note(_input: { text: string }): { note: string } {
      return { note: "n" };
    }
  }
  const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
  const Composer = renderer(
    "Records one note.",
    (_inputs, _bindings, { draft }) => html`
      <input ${draft} />
      <button ${Noting.note({ text: draft })} ${Clear({ field: draft })}>Record</button>
    `,
  );
  const Home = endpoint("/", () => receive({}).then(respond(Composer({}))));
  const Browser = defineInterface({ Home, Clear });
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { Clear, Composer, Home, Browser },
  });
  expect(() => realize({ system, interface: Browser })).toThrow(
    'immediate "Clear" has no bound implementation',
  );
  const bound = realize({
    system,
    interface: Browser,
    immediates: { Clear: ({ field }: { field: { value: string } }) => (field.value = "") },
  });
  expect(bound.claims.length).toBeGreaterThan(0);
});
