import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { bindInterface, defineInterface } from "@mit-sdg/sync-engine/boundary";
import { compileHtml } from "../src/compiled/index.ts";
import { html, immediate, many, renderer } from "../src/language/index.ts";

function install<const Declarations extends Record<string, object>>(declarations: Declarations) {
  const Browser = defineInterface(declarations);
  const system = assemble({
    conceptSet: conceptSet({}),
    composition: {},
    interfaces: { ...declarations, Browser },
  });
  return { Browser, system };
}

class NotingConcept {
  note(_input: { text: string }): { note: string } {
    return { note: "n" };
  }
}

describe("immediates", () => {
  test("an invocation lowers to inert identity-and-args data in an arming seat", () => {
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Clear = immediate("Empties its fields after acceptance.", {
      on: "accepted",
      fields: many("field"),
    });
    const Composer = renderer(
      "Records one note.",
      (_inputs, _bindings, { draft }) => html`
        <input ${draft} />
        <button ${Noting.note({ text: draft })} ${Clear({ fields: [draft] })}>Record</button>
      `,
    );
    install({ Clear, Composer });
    const parts = Composer({}).$renderer.body.parts;
    const armed = parts.find((part) => part.kind === "immediate");
    expect(armed).toMatchObject({
      kind: "immediate",
      invocation: {
        $immediate: { identity: "Clear", on: "accepted", contract: { fields: { many: "field" } } },
        args: { fields: [{ scope: "field", name: "draft" }] },
      },
    });
  });

  test("arguments are checked against the declared contract", () => {
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Clear = immediate("Empties its fields after acceptance.", {
      on: "accepted",
      fields: many("field"),
    });
    const Missing = renderer(
      "Omits the argument.",
      (_inputs, _bindings, { draft }) => html`
        <button ${Noting.note({ text: draft })} ${Clear({})}>Record</button>
      `,
    );
    const Undeclared = renderer(
      "Adds an argument.",
      (_inputs, _bindings, { draft }) => html`
        <button ${Noting.note({ text: draft })} ${Clear({ fields: [draft], extra: draft })}>
          x
        </button>
      `,
    );
    install({ Clear, Missing, Undeclared });
    expect(() => Missing({})).toThrow('omitted declared argument "fields"');
    expect(() => Undeclared({})).toThrow('received undeclared argument "extra"');
  });

  test("forming emits the trigger attribute with resolved seat addresses", async () => {
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Refocus = immediate("Focuses its field after a refusal.", {
      on: "refused",
      field: "field",
    });
    const Composer = renderer(
      "Records one note.",
      (_inputs, _bindings, { draft }) => html`
        <input ${draft} />
        <button ${Noting.note({ text: draft })} ${Refocus({ field: draft })}>Record</button>
      `,
    );
    const { Browser, system } = install({ Refocus, Composer });
    const compiled = compileHtml(bindInterface({ system, interface: Browser }));
    expect(compiled.immediates).toEqual(["Refocus"]);
    const formed = await compiled.form(Composer({}));
    expect(formed.content.value).toContain(
      'data-rendered-on-refused="{&quot;immediate&quot;:&quot;Refocus&quot;,&quot;args&quot;:{&quot;field&quot;:&quot;root/1/field&quot;}}"',
    );
  });

  test("an unadmitted immediate is refused at compile", () => {
    const { Noting } = vocabulary({ concepts: { Noting: NotingConcept } }).concepts;
    const Stray = immediate("Never admitted.", { on: "accepted", fields: many("field") });
    const Composer = renderer(
      "Uses a stray immediate.",
      (_inputs, _bindings, { draft }) => html`
        <button ${Noting.note({ text: draft })} ${Stray({ fields: [draft] })}>Record</button>
      `,
    );
    install({ Stray });
    const { Browser, system } = install({ Composer });
    expect(() => compileHtml(bindInterface({ system, interface: Browser }))).toThrow(
      'immediate "Stray" is not admitted',
    );
  });
});
