import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ownedTypeNameSpellings, parseSimpleStateForm } from "../src/index.ts";
import { describe, expect, test } from "vite-plus/test";

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const PRIMITIVES = new Set(["Date", "DateTime", "Flag", "Number", "String"]);

interface OracleOptions {
  readonly externalTypes?: readonly string[];
}

/** Independent, test-only canonical line scanner for valid SSF inventories. */
function oracleOwnedTypeNames(source: string, options: OracleOptions = {}): readonly string[] {
  const external = new Set(options.externalTypes ?? []);
  const declarations = new Set<string>();
  const aliases: Array<readonly [string, string]> = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) continue;
    const words = line.trim().split(/\s+/);
    if (words[0] === "alias" && words.length === 4 && words[2] === "for") {
      if (TYPE_NAME.test(words[1] ?? "") && TYPE_NAME.test(words[3] ?? "")) {
        aliases.push([words[1]!, words[3]!]);
      }
      continue;
    }
    if (words[0] !== "a" && words[0] !== "an") continue;
    let index = 1;
    if (["set", "seq", "element"].includes(words[index] ?? "")) {
      index += 1;
      if (words[index] === "of") index += 1;
    }
    const name = words[index];
    if (
      name !== undefined &&
      TYPE_NAME.test(name) &&
      !external.has(name) &&
      !PRIMITIVES.has(name)
    ) {
      declarations.add(name);
    }
  }
  const owned = new Set(declarations);
  for (const [alias, target] of aliases) {
    if (
      declarations.has(target) &&
      !declarations.has(alias) &&
      !external.has(alias) &&
      !PRIMITIVES.has(alias)
    ) {
      owned.add(alias);
    }
  }
  return [...owned].sort();
}

function stateFence(markdown: string): string {
  const match = /```state\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  if (match?.[1] === undefined) throw new Error("fixture has no State fence");
  return match[1];
}

function externalTypes(markdown: string): string[] {
  const match = /```types\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  return [...(match?.[1] ?? "").matchAll(/^external ([A-Z][A-Za-z0-9_]*)$/gm)].map(
    (declaration) => declaration[1] ?? "",
  );
}

function expectAgreement(label: string, source: string, options: OracleOptions = {}): void {
  const parsed = parseSimpleStateForm(source, options);
  expect(parsed.diagnostics, label).toEqual([]);
  expect(ownedTypeNameSpellings(parsed.document.inventory), label).toEqual(
    oracleOwnedTypeNames(source, options),
  );
}

describe("independent owned-type inventory oracle", () => {
  test("derives only structural declarations and explicit aliases", () => {
    expectAgreement(
      "focused",
      `a set of Mice with
  a parent Mouse
  a owner Person

alias Mouse for Mice

a Selected set of Mice

an element Settings`,
      { externalTypes: ["Person"] },
    );
    const withoutAlias = parseSimpleStateForm("a set of Mice with\n  a parent Mouse");
    expect(ownedTypeNameSpellings(withoutAlias.document.inventory)).toEqual(["Mice"]);
  });

  test("agrees for every catalog concept State", async () => {
    const entries = resolve(import.meta.dirname, "../../catalog/entries/concept");
    const concepts = (await readdir(entries, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
    for (const concept of concepts) {
      const path = resolve(entries, concept, "spec.md");
      const markdown = await readFile(path, "utf8");
      expectAgreement(path, stateFence(markdown), { externalTypes: externalTypes(markdown) });
    }
  });
});
