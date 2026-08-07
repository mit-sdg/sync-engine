import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
import { applicationManifest, type ApplicationManifestV5 } from "@mit-sdg/sync-engine/tooling";

class NotesConcept {
  add({ title }: { title: string }) {
    return { title };
  }

  _all() {
    return [];
  }
}

export function projectManifest(): ApplicationManifestV5 {
  const words = vocabulary({ concepts: { Notes: NotesConcept }, computations: {} });
  const { Notes } = words.concepts;
  const RecordNote = reaction(({ title }) =>
    when(Notes.add({ title }).responds({ title })).then(Notes.add({ title })),
  );
  return applicationManifest(assemble({ vocabulary: words, composition: { RecordNote } }));
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function config(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export interface ApplicationProjectFixture {
  readonly root: string;
  readonly outside: string;
  readonly manifest: ApplicationManifestV5;
  cleanup(): void;
}

export function applicationProjectFixture(
  options: { readonly large?: boolean } = {},
): ApplicationProjectFixture {
  const root = mkdtempSync(join(tmpdir(), "sync-engine-project-"));
  const outside = mkdtempSync(join(tmpdir(), "sync-engine-outside-"));
  const manifest = projectManifest();
  config(join(root, "tsconfig.json"), {
    files: [],
    references: [{ path: "./app" }],
  });
  config(join(root, "app/tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      composite: true,
      declaration: true,
      rootDir: "src",
      outDir: "dist",
      skipLibCheck: true,
      types: [],
      baseUrl: ".",
      paths: {
        "@domain": ["../domain/src/index.ts"],
        "@mit-sdg/sync-engine/assembly": ["stubs/core.d.ts"],
        "@mit-sdg/sync-engine/language": ["stubs/core.d.ts"],
      },
    },
    files: ["src/app.ts", "stubs/core.d.ts"],
    references: [{ path: "../domain" }],
  });
  config(join(root, "domain/tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      composite: true,
      declaration: true,
      rootDir: "src",
      outDir: "dist",
      skipLibCheck: true,
      types: [],
    },
    files: ["src/index.ts", "src/notes.ts", "src/diagnostic.ts"],
  });
  write(
    join(root, "app/stubs/core.d.ts"),
    `declare module "@mit-sdg/sync-engine/assembly" {
  export function assemble<T>(options: T): T;
}
declare module "@mit-sdg/sync-engine/language" {
  export function vocabulary<T>(options: T): { concepts: any };
  export function reaction<T>(declaration: (input: any) => T): T;
  export function when<T>(trigger: T): { then(value: unknown): T };
}
`,
  );
  const padding =
    options.large === true
      ? Array.from({ length: 25_000 }, (_, index) => `const padding${index} = ${index};`).join("\n")
      : "";
  write(
    join(root, "app/src/app.ts"),
    `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
import { NotesConcept } from "@domain";

const words = vocabulary({ concepts: { Notes: NotesConcept }, computations: {} });
const { Notes } = words.concepts;
export const RecordNote = reaction(({ title }) =>
  when(Notes.add({ title }).responds({ title })).then(Notes.add({ title })),
);
export const application = assemble({ vocabulary: words, composition: { RecordNote } });
${padding}
`,
  );
  write(join(root, "domain/src/index.ts"), `export { NotesConcept } from "./notes.ts";\n`);
  write(
    join(root, "domain/src/notes.ts"),
    `export class NotesConcept {
  add({ title }: { title: string }) { return { title }; }
  _all() { return []; }
}
`,
  );
  write(join(root, "domain/src/diagnostic.ts"), `export const broken: string = 42;\n`);
  config(join(outside, "base.json"), { compilerOptions: { strict: true } });
  write(join(outside, "outside.ts"), "export const outside = true;\n");
  return {
    root,
    outside,
    manifest,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
}

export function fixtureOptions(fixture: ApplicationProjectFixture) {
  return {
    repositoryRoot: fixture.root,
    tsconfigPath: "tsconfig.json",
    sourceRevision: "revision-1",
    manifest: fixture.manifest,
    manifestSourceRevision: "revision-1",
    expectedManifestDigest: fixture.manifest.digest,
  } as const;
}

export function linkOutsideDirectory(fixture: ApplicationProjectFixture): string {
  const path = join(fixture.root, "linked-outside");
  symlinkSync(fixture.outside, path, process.platform === "win32" ? "junction" : "dir");
  return path;
}
