import { describe, expect, test } from "vite-plus/test";
import { assemble } from "@sync-engine/assembly";
import { bindInterface, defineInterface, endpoint, receive, respond } from "@sync-engine/boundary";
import { interfaceDeclaration, vocabulary } from "@sync-engine/advanced";

const emptyVocabulary = vocabulary({ concepts: {}, computations: {} });

function system(interfaces: Record<string, unknown>, composition: Record<string, unknown> = {}) {
  return assemble({ vocabulary: emptyVocabulary, composition, interfaces });
}

describe("interface definitions", () => {
  test("registers a selected endpoint from the complete interface namespace", async () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const Browser = defineInterface({ Ping });
    const assembled = system({ Ping, Browser });

    await expect(assembled.invoker.invoke("/ping", {})).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(bindInterface({ system: assembled, interface: Browser })).toMatchObject({
      identity: "Browser",
      members: [{ identity: "Ping", kind: "endpoint", value: Ping }],
    });
  });

  test("allows one canonical declaration to participate in several interfaces", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const Browser = defineInterface({ Ping });
    const Automation = defineInterface({ Ping });
    const assembled = system({ Ping, Browser, Automation });

    expect(bindInterface({ system: assembled, interface: Browser }).members[0]?.identity).toBe(
      "Ping",
    );
    expect(bindInterface({ system: assembled, interface: Automation }).members[0]?.identity).toBe(
      "Ping",
    );
  });

  test("refuses aliases because a declaration has one canonical identity", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const Browser = defineInterface({ Alias: Ping });

    expect(() => system({ Ping, Browser })).toThrow(
      'interface "Browser" member "Alias" is canonically exported as "Ping"',
    );
    expect(() => system({ Ping, AlsoPing: Ping })).toThrow(
      'same interface value is exported as both "Ping" and "AlsoPing"',
    );
  });

  test("records declaration dependencies reached by an endpoint", () => {
    let identity: string | undefined;
    const Card = interfaceDeclaration(
      () => ({ format: "sync-engine.renderer", identity }),
      (installed) => {
        identity = installed;
      },
    );
    const Home = endpoint("/", () => receive().then(respond({ fragment: Card() })));
    const Browser = defineInterface({ Home });
    const assembled = system({ Home, Card, Browser });
    const binding = bindInterface({ system: assembled, interface: Browser });

    expect(binding.dependencies.Home).toEqual([
      expect.objectContaining({ identity: "Card", value: Card, kind: "declaration" }),
    ]);
  });

  test("binds only a definition admitted by the supplied system", () => {
    const First = endpoint("/first", () => receive().then(respond({ ok: true })));
    const FirstInterface = defineInterface({ First });
    const first = system({ First, FirstInterface });
    const Second = endpoint("/second", () => receive().then(respond({ ok: true })));
    const SecondInterface = defineInterface({ Second });
    const second = system({ Second, SecondInterface });

    expect(() => bindInterface({ system: second, interface: FirstInterface })).toThrow(
      "interface must belong to the supplied system",
    );
    expect(bindInterface({ system: first, interface: FirstInterface }).identity).toBe(
      "FirstInterface",
    );
  });
});
