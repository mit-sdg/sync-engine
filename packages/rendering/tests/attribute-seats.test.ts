import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { bindInterface, defineInterface } from "@mit-sdg/sync-engine/boundary";
import { compileHtml, diffHtml } from "../src/compiled/index.ts";
import { html, renderer, where } from "../src/language/index.ts";

function install<const Declarations extends Record<string, object>>(declarations: Declarations) {
  const Browser = defineInterface(declarations);
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { ...declarations, Browser },
  });
  return { Browser, system };
}

describe("attribute value seats", () => {
  test("an unquoted seat lowers the attribute markup into one statement", () => {
    const Tabs = renderer(
      "Marks the selected tab.",
      ({ selected }) => html`<nav><button aria-selected=${selected}>Overview</button></nav>`,
    );
    install({ Tabs });
    expect(Tabs({ selected: "true" }).$renderer.body.parts).toEqual([
      { kind: "literal", value: "<nav><button " },
      {
        kind: "attribute",
        element: 2,
        name: "aria-selected",
        form: "value",
        value: [{ kind: "ref", ref: { scope: "input", name: "selected" } }],
      },
      { kind: "literal", value: ">Overview</button></nav>" },
    ]);
  });

  test("a quoted seat may mix literal text with a bound value", () => {
    const Card = renderer(
      "A card whose tone follows state.",
      ({ tone }) => html`<article class="card ${tone}">Report</article>`,
    );
    install({ Card });
    expect(Card({ tone: "settled" }).$renderer.body.parts).toEqual([
      { kind: "literal", value: "<article " },
      {
        kind: "attribute",
        element: 1,
        name: "class",
        form: "value",
        value: [
          { kind: "literal", value: "card " },
          { kind: "ref", ref: { scope: "input", name: "tone" } },
        ],
      },
      { kind: "literal", value: ">Report</article>" },
    ]);
  });

  test("a presence seat lowers with its ? stripped", () => {
    const Promote = renderer(
      "Disabled while busy.",
      ({ busy }) => html`<button ?disabled=${busy}>Promote</button>`,
    );
    install({ Promote });
    expect(Promote({ busy: true }).$renderer.body.parts).toEqual([
      { kind: "literal", value: "<button " },
      {
        kind: "attribute",
        element: 1,
        name: "disabled",
        form: "presence",
        value: [{ kind: "ref", ref: { scope: "input", name: "busy" } }],
      },
      { kind: "literal", value: ">Promote</button>" },
    ]);
  });

  test("href and img src carry the url check; iframe src is relative-only", () => {
    const Links = renderer(
      "Bound link targets.",
      ({ target, portrait, preview }) =>
        html`<a href=${target}>Open</a><img src=${portrait} alt="" /><iframe
            src=${preview}
          ></iframe>`,
    );
    install({ Links });
    const checks = Links({ target: "/x", portrait: "/y", preview: "/z" })
      .$renderer.body.parts.filter((part) => part.kind === "attribute")
      .map((part) => (part.kind === "attribute" ? [part.name, part.check] : []));
    expect(checks).toEqual([
      ["href", "url"],
      ["src", "url"],
      ["src", "relative-url"],
    ]);
  });

  test("a mixed unquoted value is refused toward quoting", () => {
    const strings = Object.assign(["<article class=", "px>Report</article>"], {
      raw: ["<article class=", "px>Report</article>"],
    }) as unknown as TemplateStringsArray;
    const Broken = renderer("Unquoted mixing.", ({ tone }) => html(strings, tone));
    install({ Broken });
    expect(() => Broken({ tone: "x" })).toThrow("quote the attribute");
  });

  test("a field cannot occupy an attribute value seat", () => {
    const Held = renderer(
      "A held value in an attribute.",
      (_inputs, _reads, { draft }) => html`<input value=${draft} />`,
    );
    install({ Held });
    expect(() => Held({})).toThrow(
      'html: field "draft" at interpolation 1 must arm an element, not occupy text or an attribute value.',
    );
  });
});

describe("walls", () => {
  test("event handler attributes are refused by name", () => {
    const Run = renderer(
      "An inline handler.",
      ({ handler }) => html`<button onclick=${handler}>Run</button>`,
    );
    install({ Run });
    expect(() => Run({ handler: "x" })).toThrow("is an event handler");
  });

  test("bound form destinations are refused", () => {
    const Form = renderer(
      "A bound form action.",
      ({ target }) => html`<form action=${target}><button>Go</button></form>`,
    );
    install({ Form });
    expect(() => Form({ target: "/x" })).toThrow("route around the admitted ask path");
  });

  test("bound src is refused off img and iframe", () => {
    const Embed = renderer("A bound embed source.", ({ target }) => html`<embed src=${target} />`);
    install({ Embed });
    expect(() => Embed({ target: "/x" })).toThrow("supported on img and iframe");
  });

  test("a bound style attribute is refused", () => {
    const Styled = renderer("A bound style.", ({ look }) => html`<div style=${look}>x</div>`);
    install({ Styled });
    expect(() => Styled({ look: "color:red" })).toThrow("state variation belongs to class");
  });

  test("statements inside guarded elements are refused", () => {
    const Meta = renderer(
      "A bound meta.",
      ({ content }) => html`<meta name="description" content=${content} />`,
    );
    install({ Meta });
    expect(() => Meta({ content: "x" })).toThrow("inside a <meta> element");
  });

  test("holes inside script raw text are refused", () => {
    const Inline = renderer(
      "A scripted value.",
      ({ value }) =>
        html`<script>
          const x = ${value};
        </script>`,
    );
    install({ Inline });
    expect(() => Inline({ value: "1" })).toThrow("inside a <script> element's raw text");
  });
});

describe("formed attributes and refusal seats", () => {
  test("bound attributes form once per element and patch by name", async () => {
    class PanelConcept {
      _state(_input: object): Array<{ busy: boolean; tone: string }> {
        return [];
      }
    }
    const { Panel } = vocabulary({ concepts: { Panel: PanelConcept } }).concepts;
    const Card = renderer(
      "A card whose attributes follow state.",
      (_inputs, { busy, tone }) =>
        html`${where(Panel._state({}).is({ busy, tone }))
          .html`<button ?disabled=${busy} class="card ${tone}">Promote</button>`}`,
    );
    const { Browser, system } = install({ Card });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    let rows: Array<{ busy: boolean; tone: string }> = [{ busy: true, tone: "settled" }];
    const reader = {
      async read() {
        return rows;
      },
    };
    const before = await compiled.form(Card({}), reader);
    expect(before.content.value).toContain(
      'data-rendered-attrs="root/1/clause/present/e1" disabled class="card settled"',
    );
    rows = [{ busy: false, tone: "alert" }];
    const after = await compiled.form(Card({}), reader);
    expect(diffHtml(before, after)).toEqual([
      { kind: "attr", element: "root/1/clause/present/e1", name: "disabled", value: null },
      { kind: "attr", element: "root/1/clause/present/e1", name: "class", value: "card alert" },
    ]);
  });

  test(".refuses routes the refusal into an addressed display seat", async () => {
    class NotingConcept {
      note(_input: { text: string }): { note: string } {
        return { note: "n" };
      }
    }
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Composer = renderer(
      "Records one note.",
      (_inputs, _bindings, { draft, trouble }) => html`
        <input ${draft} />
        <button ${Noting.note({ text: draft }).refuses({ trouble })}>Record</button>
        <p ${trouble}></p>
      `,
    );
    const { Browser, system } = install({ Composer });
    const formed = await compileHtml(bindInterface({ system, interface: Browser })).form(
      Composer({}),
    );
    expect(formed.asks[0].refuses).toEqual({
      trouble: { name: "trouble", address: "root/5/refusal" },
    });
    expect(formed.content.value).toContain('data-rendered-refusal="root/5/refusal"');
    expect(formed.content.value).toContain('data-rendered-ask-refuses="root/5/refusal"');
  });

  test("a refusal seat may not double as a held field, and must be placed", () => {
    class NotingConcept {
      note(_input: { text: string }): { note: string } {
        return { note: "n" };
      }
    }
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Doubled = renderer(
      "Confuses a seat with a draft.",
      (_inputs, _bindings, { trouble }) => html`
        <input ${trouble} />
        <button ${Noting.note({ text: trouble }).refuses({ trouble })}>Record</button>
      `,
    );
    const Unplaced = renderer(
      "Never places its refusal seat.",
      (_inputs, _bindings, { draft, trouble }) => html`
        <input ${draft} />
        <button ${Noting.note({ text: draft }).refuses({ trouble })}>Record</button>
      `,
    );
    install({ Doubled, Unplaced });
    expect(() => Doubled({})).toThrow("cannot also hold a draft");
    expect(() => Unplaced({})).toThrow("is never placed");
  });

  test("checked url values and presence types are refused at form time", async () => {
    const Link = renderer("A bound link.", ({ target }) => html`<a href=${target}>Open</a>`);
    const Busy = renderer(
      "A bound presence.",
      ({ busy }) => html`<button ?disabled=${busy}>Go</button>`,
    );
    const { Browser, system } = install({ Link, Busy });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    await expect(compiled.form(Link({ target: "javascript:alert(1)" }))).rejects.toThrow(
      "only relative paths and https:",
    );
    await expect(compiled.form(Busy({ busy: "false" }))).rejects.toThrow("needs a boolean");
    expect(
      (await compiled.form(Link({ target: "https://ctx.example/x" }))).content.value,
    ).toContain('href="https://ctx.example/x"');
    expect((await compiled.form(Busy({ busy: false }))).content.value).toContain(
      "<button data-rendered-attrs=",
    );
  });
});
