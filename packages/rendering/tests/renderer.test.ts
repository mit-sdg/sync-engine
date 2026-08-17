import { describe, expect, test } from "vite-plus/test";
import { html, isRendererInvocation, renderer } from "../src/language/index.ts";

describe("renderer", () => {
  test("a call produces inert portable invocation data", () => {
    const Hello = renderer("Hello", html`<main>Hello, world.</main>`);
    const invocation = Hello({});

    expect(invocation).toEqual({
      $renderer: {
        format: "sync-engine.renderer",
        version: 1,
        name: "Hello",
        body: { kind: "html", value: "<main>Hello, world.</main>" },
      },
    });
    expect(isRendererInvocation(JSON.parse(JSON.stringify(invocation)))).toBe(true);
  });

  test("caller inputs remain at the invocation mapping's top level", () => {
    const Greeting = renderer<{ audience: string }>("Greeting", html`<p>Hello.</p>`);
    expect(Greeting({ audience: "world" }).audience).toBe("world");
    expect(() => Greeting({ audience: "world", $renderer: "shadow" } as never)).toThrow(
      'cannot be named "$renderer"',
    );
  });

  test("rejects interpolation until named renderer composition earns it", () => {
    expect(() => html(["<p>", "</p>"] as unknown as TemplateStringsArray)).toThrow(
      "do not support interpolations yet",
    );
  });
});
