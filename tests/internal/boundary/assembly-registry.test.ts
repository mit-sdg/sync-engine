import { describe, expect, test } from "vite-plus/test";
import {
  assemblyBehind,
  rememberAssembly,
} from "../../../src/engine/boundary/assembly/assembly-registry.ts";

type RegistryModule = typeof import("../../../src/engine/boundary/assembly/assembly-registry.ts");

describe("assembly registry", () => {
  test("shares assemblies between separately loaded package copies", async () => {
    const facade = {};
    const assembled = {} as never;
    rememberAssembly(facade, assembled);

    const duplicateUrl = new URL(
      "../../../src/engine/boundary/assembly/assembly-registry.ts?duplicate",
      import.meta.url,
    );
    const duplicate = (await import(duplicateUrl.href)) as RegistryModule;

    expect(duplicate.assemblyBehind(facade)).toBe(assembled);
    expect(assemblyBehind(facade)).toBe(assembled);
  });
});
