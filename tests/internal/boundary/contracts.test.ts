/**
 * Endpoint input contracts. Before recording an action ask, invocation checks
 * that the body is an object and contains each required key. Explicit `null`
 * counts as present. Declared defaults fill absent keys, and endpoints without
 * a declaration derive required keys from their receive pattern.
 */

import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { endpoint, FrameworkErrorCode, receive, respond } from "@sync-engine/boundary";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { renderInputContracts } from "@sync-engine/internal/boundary/protocol/endpoints";

function setup() {
  const composition = {
    Save: endpoint(
      "/items/save",
      ({ session, item }: Vars) => receive({ session, item }).then(respond({ item })),
      { input: { required: ["session", "item"] } },
    ),
    Note: endpoint(
      "/items/note",
      ({ item, note }: Vars) => receive({ item, note }).then(respond({ item, note })),
      { input: { required: ["item"], defaults: { note: null } } },
    ),
    Bare: endpoint("/items/bare", ({ item }: Vars) => receive({ item }).then(respond({ item }))),
  };
  const app = assemble({
    vocabulary: vocabulary({ concepts: {}, computations: {} }),
    composition,
  });
  return { invoker: app.invoker, contracts: app.contracts };
}

describe("declared endpoint input contracts", () => {
  test("a body missing a required key refuses INVALID_INPUT naming path and key", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke("/items/save" as never, { item: "i1" } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("framework");
      if (result.error.kind === "framework") {
        expect(result.error.code).toBe(FrameworkErrorCode.INVALID_INPUT);
        expect(result.error.detail).toBe('/items/save requires "session"');
      }
    }
  });

  test("a non-object body refuses INVALID_INPUT instead of throwing", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke("/items/save" as never, 7 as never);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: "/items/save requires a JSON object",
      },
    });
  });

  test("a required field inherited from a prototype is not admitted", async () => {
    const { invoker } = setup();
    const inherited = Object.create({ session: "not-owned" }) as Record<string, unknown>;
    inherited.item = "i1";

    const result = await invoker.invoke("/items/save" as never, inherited as never);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: '/items/save requires "session"',
      },
    });
  });

  test("a valid body reaches the endpoint", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke(
      "/items/save" as never,
      {
        session: "s1",
        item: "i1",
      } as never,
    );

    expect(result).toEqual({ ok: true, value: { item: "i1" } });
  });

  test("an explicit null is a present value — required passes", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke(
      "/items/save" as never,
      {
        session: null,
        item: "i1",
      } as never,
    );

    // Input validation accepts the key. The endpoint then binds its null value
    // and returns a response.
    expect(result.ok).toBe(true);
  });

  test("a declared default fills an absent key before the action is asked", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke("/items/note" as never, { item: "i1" } as never);

    expect(result).toEqual({ ok: true, value: { item: "i1", note: null } });
  });

  test("a present key is never overwritten by its default", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke(
      "/items/note" as never,
      {
        item: "i1",
        note: "hello",
      } as never,
    );

    expect(result).toEqual({ ok: true, value: { item: "i1", note: "hello" } });
  });

  test("defaults and admitted input preserve prototype-named own data", async () => {
    const defaults = JSON.parse(
      '{"__proto__":{"nested":{"__proto__":"kept"}},"prototype":"default"}',
    ) as Record<string, unknown>;
    let admitted: Record<string, unknown> | undefined;
    const Special = endpoint("/special", () => receive().then(respond({ ok: true })), {
      input: { required: ["constructor"], defaults },
      validators: {
        input: (value) => {
          admitted = value as Record<string, unknown>;
          return { ok: true };
        },
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Special },
    });
    const input = JSON.parse('{"constructor":"caller"}') as Record<string, unknown>;

    expect(await app.invoker.invoke("/special" as never, input as never)).toEqual({
      ok: true,
      value: { ok: true },
    });
    if (admitted === undefined) throw new Error("input validator did not run");
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(Object.hasOwn(admitted, key)).toBe(true);
    }
    const nested = (admitted.__proto__ as Record<string, unknown>).nested as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(nested, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(admitted)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
  });

  test("an undeclared endpoint derives required keys from its receive pattern", async () => {
    const { invoker } = setup();

    const result = await invoker.invoke("/items/bare" as never, {} as never, { timeoutMs: 200 });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: '/items/bare requires "item"',
      },
    });
  });

  test("assembly combines declarations with contracts derived from reactions", () => {
    const { contracts } = setup();

    expect(Object.keys(contracts).sort()).toEqual(["/items/bare", "/items/note", "/items/save"]);
    expect(contracts["/items/save"]).toEqual({ required: ["session", "item"] });
    expect(contracts["/items/bare"]).toEqual({ required: ["item"] });
  });

  test("two declarations for one path are a definition error", () => {
    const composition = {
      A: endpoint("/dup", ({ x }: Vars) => receive({ x }).then(respond({ x })), {
        input: { required: ["x"] },
      }),
      B: endpoint("/dup", ({ y }: Vars) => receive({ y }).then(respond({ y })), {
        input: { required: ["y"] },
      }),
    };

    expect(() =>
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition,
      }),
    ).toThrow(/duplicate input contract for \/dup/);
  });

  test("renderInputContracts describes input validation", () => {
    const { contracts } = setup();

    const rendered = renderInputContracts(contracts);

    expect(rendered).toContain("## Endpoint input contracts");
    expect(rendered).toContain("- `/items/save` — requires `session`, `item`");
    expect(rendered).toContain(
      "- `/items/note` — requires `item`; fills `note` with null when absent",
    );
    expect(renderInputContracts({})).toBe("");
  });
});
