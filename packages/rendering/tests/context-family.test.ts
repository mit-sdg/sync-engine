import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { bindInterface, defineInterface } from "@mit-sdg/sync-engine/boundary";
import { compileContext, resolveContextAsk } from "../src/compiled/index.ts";
import { context, each, html, immediate, renderer, where } from "../src/language/index.ts";

function install<const Declarations extends Record<string, object>>(declarations: Declarations) {
  const Reasoner = defineInterface(declarations);
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { ...declarations, Reasoner },
  });
  return { Reasoner, system };
}

class ReasoningConcept {
  static readonly queries = { _get: "many", _extensions: "many" } as const;
  static readonly queryIdentities = { _extensions: ["extension"] } as const;
  _get(_input: { consideration: string }): Array<{ question: string }> {
    return [];
  }
  _extensions(_input: {
    consideration: string;
  }): Array<{ extension: string; contribution: string }> {
    return [];
  }
  extend(_input: { consideration: string; reasoner: string; contribution: string }): {
    extension: string;
  } {
    return { extension: "extension" };
  }
  conclude(_input: {
    consideration: string;
    reasoner: string;
    answer: string;
  }): Record<string, never> {
    return {};
  }
}

const { Reasoning } = vocabulary({ concepts: { Reasoning: ReasoningConcept } }).concepts;

describe("context family", () => {
  test("literal text is content with common indentation stripped", async () => {
    const Steady = renderer(
      "Explains how to extend one consideration.",
      () => context`
        Develop the answer incrementally.
          Keep nested indentation.

        Conclude only when the question has an answer.
      `,
    );
    const { Reasoner, system } = install({ Steady });
    const formed = await compileContext(bindInterface({ system, interface: Reasoner })).form(
      Steady({}),
    );
    expect(formed.text).toBe(
      "Develop the answer incrementally.\n" +
        "  Keep nested indentation.\n" +
        "\n" +
        "Conclude only when the question has an answer.\n",
    );
  });

  test("forms one unit: shows, identified rows, and generic flow asks", async () => {
    const Open = renderer(
      "Projects one open consideration to its designated reasoner.",
      (
        { consideration, reasoner },
        { question, extension, prior },
        { contribution, answer },
      ) => context`
        ## Question

        ${where(Reasoning._get({ consideration }).is({ question })).context`
          ${question}

          ## Your prior contributions

          ${each(Reasoning._extensions({ consideration }).is({ extension, contribution: prior }))
            .context`
            - ${prior}
          `}
          ${Reasoning.extend({ consideration, reasoner, contribution })}
          ${Reasoning.conclude({ consideration, reasoner, answer })}
        `}
      `,
    );
    const { Reasoner, system } = install({ Open });
    const compiled = compileContext(bindInterface({ system, interface: Reasoner }));
    const formed = await compiled.form(Open({ consideration: "c-1", reasoner: "gemini" }), {
      async read(read, input) {
        expect(input).toEqual({ consideration: "c-1" });
        if (read.query === "_get") return [{ question: "Is 7 prime?" }];
        return [
          { extension: "e-1", contribution: "It is odd." },
          { extension: "e-2", contribution: "It has no divisors below 3." },
        ];
      },
    });

    expect(formed.holder).toBe('Open({"consideration":"c-1","reasoner":"gemini"})');
    expect(formed.text).toContain("## Question");
    expect(formed.text).toContain("Is 7 prime?");
    expect(formed.text).toContain("- It is odd.\n");
    expect(formed.text).toContain("- It has no divisors below 3.");
    expect(formed.asks).toHaveLength(2);
    expect(formed.asks[0]).toMatchObject({
      concept: "Reasoning",
      action: "extend",
      input: {
        consideration: { source: "value", value: "c-1" },
        reasoner: { source: "value", value: "gemini" },
        contribution: { source: "blank", name: "contribution" },
      },
      blanks: ["contribution"],
    });
    expect(formed.asks[1]).toMatchObject({
      action: "conclude",
      blanks: ["answer"],
    });
    expect(formed.reads).toEqual([
      { concept: "Reasoning", query: "_get", input: { consideration: "c-1" } },
      { concept: "Reasoning", query: "_extensions", input: { consideration: "c-1" } },
    ]);
    expect(formed.sources.some((source) => source.kind === "row")).toBe(true);
    expect(formed.revision).toMatch(/^context-v1-[0-9a-f]{8}$/);

    const again = await compiled.form(Open({ consideration: "c-1", reasoner: "gemini" }), {
      async read(read) {
        if (read.query === "_get") return [{ question: "Is 7 prime?" }];
        return [
          { extension: "e-1", contribution: "It is odd." },
          { extension: "e-2", contribution: "It has no divisors below 3." },
        ];
      },
    });
    expect(again.revision).toBe(formed.revision);

    const moved = await compiled.form(Open({ consideration: "c-1", reasoner: "gemini" }), {
      async read(read) {
        if (read.query === "_get") return [{ question: "Is 7 prime?" }];
        return [{ extension: "e-1", contribution: "It is odd." }];
      },
    });
    expect(moved.revision).not.toBe(formed.revision);
  });

  test("resolveContextAsk maps blanks to the exact registered occurrence", async () => {
    const Asking = renderer(
      "Offers one extend ask.",
      ({ consideration, reasoner }, _bindings, { contribution }) => context`
        Extend when useful.
        ${Reasoning.extend({ consideration, reasoner, contribution })}
      `,
    );
    const { Reasoner, system } = install({ Asking });
    const formed = await compileContext(bindInterface({ system, interface: Reasoner })).form(
      Asking({ consideration: "c-9", reasoner: "gemini" }),
    );
    const resolved = resolveContextAsk(formed, formed.asks[0].id, { contribution: "It is odd." });
    expect(resolved.input).toEqual({
      consideration: "c-9",
      reasoner: "gemini",
      contribution: "It is odd.",
    });
    expect(() => resolveContextAsk(formed, "root/nowhere/ask", {})).toThrow(/unknown ask/);
    expect(() =>
      resolveContextAsk(formed, formed.asks[0].id, { contribution: "x", extra: "y" }),
    ).toThrow(/unknown blank/);
    expect(() => resolveContextAsk(formed, formed.asks[0].id, {})).toThrow(/as a string/);
  });

  test("a blank cannot be shown in text", () => {
    const Leak = renderer(
      "Shows a blank.",
      (_inputs, _bindings, { contribution }) => context`Draft: ${contribution}`,
    );
    install({ Leak });
    expect(() => Leak.declaration).toThrow(/has no held value before ask time/);
  });

  test("display-seat qualifiers are refused in flow asks", () => {
    const Seated = renderer(
      "Routes a refusal to a seat.",
      ({ consideration, reasoner }, _bindings, { contribution, refusal }) => context`
        ${Reasoning.extend({ consideration, reasoner, contribution }).refuses({ refusal })}
      `,
    );
    install({ Seated });
    expect(() => Seated.declaration).toThrow(/names display seats/);
  });

  test("an ask under an each clause is refused at declaration", () => {
    const Flat = renderer(
      "Flattens several considerations into one unit.",
      ({ reasoner }, { question, consideration }, { contribution }) => context`
        ${each(Reasoning._get({ consideration: reasoner }).is({ question })).context`
          ${question}
          ${Reasoning.extend({ consideration: reasoner, reasoner, contribution })}
        `}
      `,
    );
    install({ Flat });
    expect(() => Flat.declaration).toThrow(/no single subject/);
  });

  test("cross-family placement is refused in both directions", () => {
    const Page = renderer("An HTML page.", () => html`<main>Hello.</main>`);
    const Note = renderer("A context note.", () => context`Hello.`);
    const MixedContext = renderer("Places HTML in context.", () => context`${Page({})}`);
    const MixedHtml = renderer("Places context in HTML.", () => html`<main>${Note({})}</main>`);
    install({ Page, Note, MixedContext, MixedHtml });
    expect(() => MixedContext.declaration).toThrow(/uses the html family/);
    expect(() => MixedHtml.declaration).toThrow(/uses the context family/);
  });

  test("a read placement must match its surrounding family", () => {
    const Wrong = renderer(
      "Uses an html read inside context.",
      ({ consideration }, { question }) => context`
        ${where(Reasoning._get({ consideration }).is({ question })).html`<p>${question}</p>`}
      `,
    );
    install({ Wrong });
    expect(() => Wrong.declaration).toThrow(/must use its context placement/);
  });

  test("immediates cannot arm a context projection", () => {
    const Clear = immediate("Clears nothing.", { on: "accepted" });
    const Armed = renderer("Arms an immediate in text.", () => context`${Clear({})}`);
    install({ Armed, Clear });
    expect(() => Armed.declaration).toThrow(/arms an HTML element/);
  });

  test("a shown object is refused as implicit structure", async () => {
    class HoldingConcept {
      static readonly queries = { _bag: "many" } as const;
      _bag(_input: Record<string, never>): Array<{ value: unknown }> {
        return [];
      }
    }
    const { Holding } = vocabulary({ concepts: { Holding: HoldingConcept } }).concepts;
    const Shows = renderer(
      "Shows a read value.",
      (_inputs, { value }) => context`${where(Holding._bag({}).is({ value })).context`${value}`}`,
    );
    const { Reasoner, system } = install({ Shows });
    const compiled = compileContext(bindInterface({ system, interface: Reasoner }));
    await expect(
      compiled.form(Shows({}), {
        async read() {
          return [{ value: { nested: true } }];
        },
      }),
    ).rejects.toThrow(/needs a string or finite number/);
  });

  test("compileContext refuses an interface carrying an HTML renderer", () => {
    const Page = renderer("An HTML page.", () => html`<main>Hello.</main>`);
    const { Reasoner, system } = install({ Page });
    expect(() => compileContext(bindInterface({ system, interface: Reasoner }))).toThrow(
      /uses the html family/,
    );
  });
});
