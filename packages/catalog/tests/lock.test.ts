import { describe, expect, test } from "vite-plus/test";
import { EMPTY_LOCK, parseLock, serializeLock } from "../src/lock.ts";

describe("catalog lock", () => {
  test("serializes deterministically with a trailing newline", () => {
    const source = serializeLock(EMPTY_LOCK());
    expect(source.endsWith("\n")).toBe(true);
    expect(parseLock(source)).toEqual(EMPTY_LOCK());
  });
  test("rejects nonportable paths", () => {
    const lock = EMPTY_LOCK();
    lock.generated.push({ target: "../outside", hash: "x" });
    expect(() => parseLock(JSON.stringify(lock))).toThrow("portable");
  });

  test.each([
    ["invalid JSON", "{"],
    ["non-object root", "[]"],
    ["unknown root field", JSON.stringify({ ...EMPTY_LOCK(), unknown: true })],
    ["schema", JSON.stringify({ ...EMPTY_LOCK(), schema: 2 })],
    [
      "fixed paths",
      JSON.stringify({
        ...EMPTY_LOCK(),
        paths: { concepts: "other", recipes: "src/composition", generated: "src/catalog" },
      }),
    ],
    ["generated array", JSON.stringify({ ...EMPTY_LOCK(), generated: {} })],
    ["invalid floor", JSON.stringify({ ...EMPTY_LOCK(), floor: "Memory" })],
    [
      "unknown paths field",
      JSON.stringify({ ...EMPTY_LOCK(), paths: { ...EMPTY_LOCK().paths, other: "src" } }),
    ],
    [
      "invalid generated hash",
      JSON.stringify({
        ...EMPTY_LOCK(),
        generated: [{ target: "src/catalog/text.generated.d.ts", hash: "bad" }],
      }),
    ],
  ])("rejects malformed %s", (_label, source) => {
    expect(() => parseLock(source)).toThrow();
  });

  test("validates entry fields, floors, and duplicate targets", () => {
    const base = EMPTY_LOCK();
    base.generated = [
      { target: "src/catalog/composition.generated.ts", hash: "c".repeat(64) },
      { target: "src/catalog/registrations.generated.ts", hash: "d".repeat(64) },
      { target: "src/catalog/text.generated.d.ts", hash: "e".repeat(64) },
    ];
    const entry = {
      kind: "concept" as const,
      catalogVersion: "1.0.0-beta.8",
      sourceDigest: "a".repeat(64),
      requires: [],
      floor: "memory",
      packages: {},
      integration: {
        kind: "concept" as const,
        name: "A",
        export: "aRegistration",
        registration: "src/concepts/a.ts",
      },
      files: [
        {
          source: "source.ts",
          target: "src/concepts/a.ts",
          hash: "b".repeat(64),
          class: "rendered" as const,
        },
      ],
    };
    expect(() =>
      parseLock(JSON.stringify({ ...base, floor: "memory", entries: { "concept/a": entry } })),
    ).not.toThrow();
    expect(() =>
      parseLock(JSON.stringify({ ...base, floor: "mongo", entries: { "concept/a": entry } })),
    ).toThrow("locked floor");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: { "concept/a": { ...entry, extra: true } },
        }),
      ),
    ).toThrow("unknown field");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: { "concept/a": { ...entry, sourceDigest: "bad" } },
        }),
      ),
    ).toThrow("invalid lock entry");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: { "concept/a": { ...entry, requires: ["concept/a"] } },
        }),
      ),
    ).toThrow("may not record requirements");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: { "concept/a": { ...entry, packages: { dependency: "not-semver" } } },
        }),
      ),
    ).toThrow("invalid requirement");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: {
            "concept/a": {
              ...entry,
              integration: { ...entry.integration, export: "not-an-identifier" },
            },
          },
        }),
      ),
    ).toThrow("invalid concept integration");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: {
            "concept/a": {
              ...entry,
              files: [{ ...entry.files[0], class: "owned" }],
            },
          },
        }),
      ),
    ).toThrow("integration target is not tracked");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: {
            "concept/a": { ...entry, files: [{ ...entry.files[0], source: "" }] },
          },
        }),
      ),
    ).toThrow("invalid tracked file");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: {
            "concept/a": {
              ...entry,
              integration: { ...entry.integration, registration: "src/composition/a.ts" },
              files: [{ ...entry.files[0], target: "src/composition/a.ts" }],
            },
          },
        }),
      ),
    ).toThrow("must remain under src/concepts");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: { "concept/a": entry },
          generated: [],
        }),
      ),
    ).toThrow("track every generated file");
    expect(() => parseLock(JSON.stringify({ ...EMPTY_LOCK(), floor: "memory" }))).toThrow(
      "may not select a floor",
    );
    expect(() =>
      parseLock(
        JSON.stringify({
          ...EMPTY_LOCK(),
          generated: [
            { target: "src/catalog/text.generated.d.ts", hash: "a".repeat(64) },
            { target: "src/catalog/text.generated.d.ts", hash: "b".repeat(64) },
          ],
        }),
      ),
    ).toThrow("duplicate lock target");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          entries: {
            "recipe/a": {
              ...entry,
              kind: "recipe",
              floor: undefined,
              integration: {
                kind: "recipe",
                module: "src/composition/a.ts",
                test: "src/composition/a.test.ts",
                members: ["A"],
                routes: { A: "/a" },
              },
              files: [
                {
                  source: "a.ts",
                  target: "src/composition/a.ts",
                  hash: "b".repeat(64),
                  class: "owned",
                },
                {
                  source: "a.test.ts",
                  target: "src/composition/a.test.ts",
                  hash: "c".repeat(64),
                  class: "owned",
                },
              ],
            },
          },
        }),
      ),
    ).toThrow("must contain a concept");
    expect(() =>
      parseLock(
        JSON.stringify({
          ...base,
          floor: "memory",
          entries: {
            "concept/a": entry,
            "concept/b": {
              ...entry,
              integration: { ...entry.integration, name: "B", export: "bRegistration" },
            },
          },
        }),
      ),
    ).toThrow("duplicate lock target");
  });
});
