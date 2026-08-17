import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import {
  bindInterface,
  defineInterface,
  endpoint,
  receive,
  respond,
} from "@mit-sdg/sync-engine/boundary";
import { compileHtml } from "../src/compiled/index.ts";
import {
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

  test("caller inputs remain at the invocation mapping's top level", () => {
    const Greeting = renderer<{ audience: string }>("Greets one audience.", ({ audience }) => {
      void audience;
      return html`<p>Hello.</p>`;
    });
    install({ Greeting });
    expect(Greeting({ audience: "world" }).audience).toBe("world");
    expect(() => Greeting({ audience: "world", $renderer: "shadow" } as never)).toThrow(
      'cannot be named "$renderer"',
    );
    expect(() => Greeting({} as never)).toThrow('omitted declared input "audience"');
    expect(() => Greeting({ audience: "world", tone: "warm" } as never)).toThrow(
      'supplied undeclared input "tone"',
    );
  });

  test("a direct child invocation lowers as one named subtree placement", () => {
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
    expect(compiled.form(Hello({}))).toEqual({
      holder: "Hello:root",
      content: { format: "html", value: "<main><h1>Hello, world.</h1></main>" },
    });
  });

  test("refuses arbitrary values and renderer invocations in the wrong markup seat", () => {
    expect(() => html`<p>${"computed"}</p>`).toThrow("is not a checked authored statement");

    const Heading = renderer("Shows the greeting heading.", () => html`<h1>Hello.</h1>`);
    install({ Heading });
    expect(() => html`<main class="${Heading({})}"></main>`).toThrow("must occupy a subtree place");
  });

  test("refuses an unexported or renamed child with a repairable identity error", () => {
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

    expect(() => compiled.form(renamed)).toThrow(
      'renderer "RenamedHeading" is not admitted by interface "Browser"',
    );
  });
});
