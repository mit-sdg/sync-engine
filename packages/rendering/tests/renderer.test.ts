import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import {
  bindInterface,
  defineInterface,
  endpoint,
  receive,
  respond,
} from "@mit-sdg/sync-engine/boundary";
import { compileHtml, diffHtml } from "../src/compiled/index.ts";
import {
  each,
  html,
  isRendererInvocation,
  renderer,
  type RendererInvocation,
} from "../src/language/index.ts";

function install<const Declarations extends Record<string, object>>(declarations: Declarations) {
  const Browser = defineInterface(declarations);
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { ...declarations, Browser },
  });
  return { Browser, system };
}

describe("renderer", () => {
  test("a call produces inert portable invocation data", () => {
    const Hello = renderer("Greets the visitor.", () => html`<main>Hello, world.</main>`);
    install({ Hello });
    const invocation = Hello({});

    expect(invocation).toEqual({
      $renderer: {
        format: "sync-engine.renderer",
        version: 1,
        identity: "Hello",
        description: "Greets the visitor.",
        inputs: [],
        body: {
          kind: "html",
          parts: [{ kind: "literal", value: "<main>Hello, world.</main>" }],
        },
      },
    });
    expect(isRendererInvocation(JSON.parse(JSON.stringify(invocation)))).toBe(true);
  });

  test("caller inputs remain at the invocation mapping's top level", async () => {
    const Greeting = renderer(
      "Greets one audience.",
      ({ audience }) => html`<p>Hello, ${audience}.</p>`,
    );
    const { Browser, system } = install({ Greeting });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    expect(Greeting({ audience: "world" }).audience).toBe("world");
    const formed = await compiled.form(Greeting({ audience: "<world>" }));
    expect(formed.content.value).toContain("&lt;world&gt;");
    expect(formed.tree.children).toMatchObject([
      { kind: "show", address: "root/1/show", value: "<world>" },
    ]);
    expect(() => Greeting({ audience: "world", $renderer: "shadow" } as never)).toThrow(
      'cannot be named "$renderer"',
    );
    expect(() => Greeting({} as never)).toThrow('omitted declared input "audience"');
    expect(() => Greeting({ audience: "world", tone: "warm" } as never)).toThrow(
      'supplied undeclared input "tone"',
    );
  });

  test("a direct child invocation lowers as one named subtree placement", async () => {
    const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello, world.</h1>`);
    const Hello = renderer("Composes the greeting.", () => html`<main>${Heading({})}</main>`);
    const { Browser, system } = install({ Heading, Hello });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));

    expect(Hello({}).$renderer.body).toEqual({
      kind: "html",
      parts: [
        { kind: "literal", value: "<main>" },
        { kind: "renderer", invocation: Heading({}) },
        { kind: "literal", value: "</main>" },
      ],
    });
    expect(compiled.renderers).toEqual(["Heading", "Hello"]);
    expect(await compiled.form(Hello({}))).toEqual({
      holder: "Hello:root",
      fields: [],
      asks: [],
      reads: [],
      tree: {
        kind: "root",
        address: "root",
        children: [
          {
            kind: "renderer",
            address: "root/1/renderer",
            renderer: "Heading",
            children: [],
          },
        ],
      },
      content: { format: "html", value: "<main><h1>Hello, world.</h1></main>" },
    });
  });

  test("a named child receives a value from its caller input scope", async () => {
    const Heading = renderer("Shows one supplied heading.", ({ title }) => html`<h1>${title}</h1>`);
    const Page = renderer(
      "Passes its heading into one named child.",
      ({ heading }) => html`<main>${Heading({ title: heading })}</main>`,
    );
    const { Browser, system } = install({ Heading, Page });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));

    expect(Page({ heading: "A <legible> page" }).$renderer.body).toMatchObject({
      parts: [
        { kind: "literal", value: "<main>" },
        {
          kind: "renderer",
          invocation: {
            title: { scope: "input", name: "heading" },
          },
        },
        { kind: "literal", value: "</main>" },
      ],
    });
    expect((await compiled.form(Page({ heading: "A <legible> page" }))).content.value).toBe(
      "<main><h1>" +
        "<!--sync:start:root/1/renderer/1/show-->A &lt;legible&gt; page" +
        "<!--sync:end:root/1/renderer/1/show--></h1></main>",
    );
  });

  test("fields and asks form checked element bindings", async () => {
    class PresentingConcept {
      create(_input: { name: string }): { profile: string } {
        return { profile: "profile" };
      }
    }
    class WelcomingConcept {
      welcome(_input: { space: string; participant: string }): { welcome: string } {
        return { welcome: "welcome" };
      }
    }
    const { Presenting, Welcoming } = vocabulary({
      concepts: { Presenting: PresentingConcept, Welcoming: WelcomingConcept },
    }).concepts;
    const Controls = renderer(
      "Creates a Profile and welcomes it to one space.",
      ({ space }, _bindings, { name, profile }) => html`
        <input ${name} />
        <button ${Presenting.create({ name }).responds({ profile })}>Create profile</button>
        <input type="hidden" ${profile} />
        <button ${Welcoming.welcome({ space, participant: profile })}>Enter space</button>
      `,
    );
    const { Browser, system } = install({ Controls });
    const formed = await compileHtml(bindInterface({ system, interface: Browser })).form(
      Controls({ space: "atlas" }),
    );

    expect(formed.fields).toEqual(["name", "profile"]);
    expect(formed.asks).toEqual([
      {
        id: "root/3/ask",
        concept: "Presenting",
        action: "create",
        input: { name: { source: "field", name: "name", address: "root/1/field" } },
        output: { profile: { name: "profile", address: "root/5/field" } },
      },
      {
        id: "root/7/ask",
        concept: "Welcoming",
        action: "welcome",
        input: {
          space: { source: "value", value: "atlas" },
          participant: { source: "field", name: "profile", address: "root/5/field" },
        },
        output: {},
      },
    ]);
    expect(formed.content.value).toContain(
      'data-rendered-field="name" data-rendered-seat="root/1/field"',
    );
    expect(formed.content.value).toContain('<button data-rendered-ask="root/3/ask">');
  });

  test("a repeated read binds rows and forms their shown values", async () => {
    class ListingConcept {
      _in(_input: { space: string }): Array<{ item: string; name: string }> {
        return [];
      }
    }
    const { Listing } = vocabulary({ concepts: { Listing: ListingConcept } }).concepts;
    const List = renderer(
      "Lists the named items in one space.",
      ({ space }, { item, name }) =>
        html`<ul>
          ${each(Listing._in({ space }).is({ item, name })).html`<li>${name}</li>`}
        </ul>`,
    );
    const { Browser, system } = install({ List });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));

    const formed = await compiled.form(List({ space: "atlas" }), {
      async read(read, input) {
        expect(read).toMatchObject({ concept: "Listing", query: "_in" });
        expect(input).toEqual({ space: "atlas" });
        return [
          { item: "one", name: "<Maya>" },
          { item: "two", name: "Ravi" },
        ];
      },
    });
    expect(formed.content.value).toContain("&lt;Maya&gt;");
    expect(formed.content.value).toContain("Ravi");
    expect(formed.reads).toEqual([{ concept: "Listing", query: "_in", input: { space: "atlas" } }]);
  });

  test("gives repeated fields and asks row-scoped addresses", async () => {
    class ListingConcept {
      static readonly queries = { _in: "many" } as const;
      static readonly queryIdentities = { _in: ["item"] } as const;
      _in(_: Record<string, never>): Array<{ item: string }> {
        return [];
      }
    }
    class EditingConcept {
      save(_input: { item: string; value: string }): Record<string, never> {
        return {};
      }
    }
    const { Listing, Editing } = vocabulary({
      concepts: { Listing: ListingConcept, Editing: EditingConcept },
    }).concepts;
    const Controls = renderer(
      "Edits identified rows independently.",
      (_inputs, { item }, { draft }) => html`
        <ul>
          ${each(Listing._in({}).is({ item })).html`
            <li>
              <input ${draft}>
              <button ${Editing.save({ item, value: draft })}>Save</button>
            </li>
          `}
        </ul>
      `,
    );
    const { Browser, system } = install({ Controls });
    const formed = await compileHtml(bindInterface({ system, interface: Browser })).form(
      Controls({}),
      {
        async read() {
          return [{ item: "one" }, { item: "two" }];
        },
      },
    );

    expect(formed.asks).toHaveLength(2);
    const addresses = formed.asks.map((ask) => {
      const source = ask.input.value;
      if (source.source !== "field") throw new Error("expected a row field");
      return source.address;
    });
    expect(new Set(addresses).size).toBe(2);
    expect(addresses.every((address) => address.includes("/key-"))).toBe(true);
    expect(formed.asks[0].input.item).toEqual({ source: "value", value: "one" });
    expect(formed.asks[1].input.item).toEqual({ source: "value", value: "two" });
  });

  test("diffs identified rows by query-owned identity and preserves existing row addresses", async () => {
    class ListingConcept {
      static readonly queries = { _in: "many" } as const;
      static readonly queryIdentities = { _in: ["item"] } as const;
      _in(_input: { space: string }): Array<{ item: string; name: string }> {
        return [];
      }
    }
    const { Listing } = vocabulary({ concepts: { Listing: ListingConcept } }).concepts;
    const List = renderer(
      "Lists identified items.",
      ({ space }, { item, name }) =>
        html`<ul>
          ${each(Listing._in({ space }).is({ item, name })).html`<li>${name}</li>`}
        </ul>`,
    );
    const { Browser, system } = install({ List });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    let rows = [
      { item: "one", name: "Maya" },
      { item: "two", name: "Ravi" },
    ];
    const reader = {
      async read() {
        return rows;
      },
    };
    const before = await compiled.form(List({ space: "atlas" }), reader);
    rows = [
      { item: "two", name: "Ravi" },
      { item: "one", name: "May" },
      { item: "three", name: "Lin" },
    ];
    const after = await compiled.form(List({ space: "atlas" }), reader);
    const patches = diffHtml(before, after);

    expect(patches.map(({ kind }) => kind)).toEqual(["rows", "show"]);
    const rowPatch = patches[0];
    if (rowPatch.kind !== "rows") throw new Error("expected an identified row patch");
    expect(rowPatch.entered).toHaveLength(1);
    expect(rowPatch.left).toEqual([]);
    expect(rowPatch.order[1]).toBe(
      (before.tree.children[0] as { rows: readonly { address: string }[] }).rows[0].address,
    );
    expect(patches).not.toContainEqual(expect.objectContaining({ kind: "root" }));
  });

  test("falls back to replacing one clause when a repeated query has no identity promise", async () => {
    class ListingConcept {
      static readonly queries = { _in: "many" } as const;
      _in(_: Record<string, never>): Array<{ name: string }> {
        return [];
      }
    }
    const { Listing } = vocabulary({ concepts: { Listing: ListingConcept } }).concepts;
    const List = renderer(
      "Lists unidentified items.",
      (_inputs, { name }) =>
        html`<ul>
          ${each(Listing._in({}).is({ name })).html`<li>${name}</li>`}
        </ul>`,
    );
    const { Browser, system } = install({ List });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    let rows = [{ name: "Maya" }];
    const reader = {
      async read() {
        return rows;
      },
    };
    const before = await compiled.form(List({}), reader);
    rows = [{ name: "May" }];
    const after = await compiled.form(List({}), reader);

    expect(diffHtml(before, after)).toMatchObject([{ kind: "clause", html: expect.any(String) }]);
  });

  test("refuses arbitrary values and renderer invocations in the wrong markup seat", () => {
    expect(() => html`<p>${"computed"}</p>`).toThrow("is not a checked authored statement");

    const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello.</h1>`);
    const Greeting = renderer(
      "Greets one audience.",
      ({ audience }) => html`<p title="${audience}">Hello.</p>`,
    );
    install({ Heading, Greeting });
    expect(() => html`<main class="${Heading({})}"></main>`).toThrow("must occupy a subtree place");
    expect(() => Greeting.declaration).toThrow("must be shown between elements");
  });

  test("refuses an unexported or renamed child with a repairable identity error", async () => {
    const HiddenHeading = renderer("Shows a hidden heading.", () => html`<h1>Hello.</h1>`);
    const HiddenHello = renderer(
      "Composes a hidden child.",
      () => html`<main>${HiddenHeading({})}</main>`,
    );
    const HiddenHome = endpoint("/", () => receive({}).then(respond(HiddenHello({}))));
    const HiddenBrowser = defineInterface({ HiddenHome });
    expect(() =>
      assemble({
        conceptSet: conceptSet({}),
        composition: {},
        interfaces: { HiddenHello, HiddenHome, HiddenBrowser },
      }),
    ).toThrow("must be a canonical top-level interface export");

    const InputlessHeading = renderer("Shows a fixed heading.", () => html`<h1>Hello.</h1>`);
    const InvalidHello = renderer(
      "Supplies an input its child did not declare.",
      () => html`<main>${InputlessHeading({ tone: "warm" } as never)}</main>`,
    );
    const InvalidHome = endpoint("/", () => receive({}).then(respond(InvalidHello({}))));
    const InvalidBrowser = defineInterface({ InvalidHome });
    expect(() =>
      assemble({
        conceptSet: conceptSet({}),
        composition: {},
        interfaces: {
          InputlessHeading,
          InvalidHello,
          InvalidHome,
          InvalidBrowser,
        },
      }),
    ).toThrow('caller supplied undeclared input "tone"');

    const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello.</h1>`);
    const Hello = renderer("Composes the greeting.", () => html`<main>${Heading({})}</main>`);
    const { Browser, system } = install({ Heading, Hello });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    const renamed = JSON.parse(JSON.stringify(Hello({}))) as RendererInvocation;
    const child = renamed.$renderer.body.parts.find((part) => part.kind === "renderer");
    if (child?.kind !== "renderer") throw new Error("expected child placement");
    (child.invocation.$renderer as { identity: string }).identity = "RenamedHeading";

    await expect(compiled.form(renamed)).rejects.toThrow(
      'renderer "RenamedHeading" is not admitted by interface "Browser"',
    );
  });
});
