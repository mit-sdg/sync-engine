import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, when } from "@mit-sdg/sync-engine/language";
import {
  applicationManifest,
  parseApplicationManifest,
  renderApplicationManifest,
} from "@mit-sdg/sync-engine/tooling";
import {
  createApplicationAnalysis,
  readApplicationSourceDocument,
} from "@mit-sdg/sync-engine-analysis/ir";
import {
  analyzeApplicationProject,
  applicationProjectAnalysisDigest,
  loadApplicationProject,
  parseApplicationProjectAnalysis,
  renderApplicationProjectAnalysis,
} from "@mit-sdg/sync-engine-analysis/project";

const bunVersion = process.versions.bun;
const runtime = bunVersion === undefined ? `Node ${process.versions.node}` : `Bun ${bunVersion}`;

function assert(condition, message) {
  if (!condition) throw new Error(`[${runtime}] ${message}`);
}

class NotesConcept {
  add({ title }) {
    return { title };
  }

  _all() {
    return [];
  }
}

const words = vocabulary({ concepts: { Notes: NotesConcept }, computations: {} });
const { Notes } = words.concepts;
const RecordNote = reaction(({ title }) =>
  when(Notes.add({ title }).responds({ title })).then(Notes.add({ title })),
);
const application = assemble({ vocabulary: words, composition: { RecordNote } });
const manifest = parseApplicationManifest(
  renderApplicationManifest(applicationManifest(application)),
);
assert(manifest.version === 1, "packed consumer did not generate and parse a V1 manifest");
assert(manifest.generator.version === "1.0.0-beta.14", "packed core provenance is not beta.14");

const consumer = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(consumer, "analysis-project");
rmSync(projectDirectory, { recursive: true, force: true });
console.log(`[${runtime}] running packed analysis consumer scenario`);
try {
  mkdirSync(resolve(projectDirectory, "src"), { recursive: true });
  writeFileSync(
    resolve(projectDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ["src/application.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(projectDirectory, "src/application.ts"),
    `import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, when } from "@mit-sdg/sync-engine/language";

class NotesConcept {
  add({ title }: { title: string }) { return { title }; }
  _all() { return []; }
}
const words = vocabulary({ concepts: { Notes: NotesConcept }, computations: {} });
const { Notes } = words.concepts;
export const RecordNote = reaction(({ title }) =>
  when(Notes.add({ title }).responds({ title })).then(Notes.add({ title })),
);
export const application = assemble({ vocabulary: words, composition: { RecordNote } });
`,
  );

  const projectOptions = {
    repositoryRoot: consumer,
    tsconfigPath: "analysis-project/tsconfig.json",
    sourceRevision: "packed-consumer-revision",
    manifest,
    manifestSourceRevision: "packed-consumer-revision",
    expectedManifestDigest: manifest.digest,
  };
  const project =
    bunVersion === undefined
      ? await analyzeApplicationProject(projectOptions)
      : loadApplicationProject(projectOptions);
  assert(
    project.provenance.analyzer.version === "1.0.0-beta.14",
    "packed analyzer provenance is not beta.14",
  );
  assert(project.version === 3, "packed project analysis is not V3");
  assert(project.applicationIndex.version === 3, "packed application index is not V3");
  assert(project.sourceIndex.version === 3, "packed source index is not V3");
  assert(
    project.provenance.files.reduce((total, file) => total + file.byteLength, 0) ===
      project.resourceUsage.projectBytes,
    "packed project byte usage is not derivable from file records",
  );
  assert(
    project.provenance.manifest.generator.version === "1.0.0-beta.14",
    "packed project core provenance is not beta.14",
  );
  assert(
    project.provenance.files.every(({ path }) => !path.startsWith("..")),
    "packed analysis escaped its consumer root",
  );
  assert(
    project.sourceIndex.entries.every(({ sources }) =>
      sources.every((anchor) => !("text" in anchor) && !("excerpt" in anchor)),
    ),
    "packed project snapshot retained source text",
  );

  const trustedProjectDigest = applicationProjectAnalysisDigest(project);
  const renderedProject = renderApplicationProjectAnalysis(project);
  const parsedProject = parseApplicationProjectAnalysis(renderedProject);
  assert(
    applicationProjectAnalysisDigest(parsedProject) === trustedProjectDigest,
    "packed project codec round trip changed its digest",
  );

  const facade = createApplicationAnalysis({
    manifest,
    project: parsedProject,
    expectedProjectDigest: trustedProjectDigest,
  });
  const catalog = await facade.catalog();
  assert(
    catalog.items.some(({ ref }) => ref.kind === "reaction" && ref.reaction === "RecordNote"),
    "packed catalog omitted RecordNote",
  );
  const action = { kind: "action", concept: "Notes", action: "add" };
  const description = await facade.describe({ ref: action, detail: "definition" });
  assert(
    description.definition?.kind === "action",
    "packed description omitted the action definition",
  );
  const sources = await facade.sources({ query: { kind: "ref", ref: action } });
  assert(sources.items.length > 0, "packed source lookup omitted action metadata");
  const anchor = sources.items[0].anchor;
  const sourceRead = await readApplicationSourceDocument(
    parsedProject.sourceIndex,
    anchor.range.path,
    {
      readFile: (path) => readFileSync(resolve(consumer, path), "utf8"),
    },
  );
  const sourceText = sourceRead.text.slice(anchor.range.start.offset, anchor.range.end.offset);
  assert(sourceText.includes("add("), "verified source slice omitted action text");
  assert(
    createHash("sha256").update(sourceText, "utf8").digest("hex") === anchor.digest,
    "verified source slice did not match the anchor digest",
  );
  const impact = await facade.impact({ seeds: [action] });
  assert(impact.trace.version === 3, "packed impact trace is not V3");
  assert(impact.trace.seeds.length === 1, "packed impact did not retain its seed");

  assert(!("format" in catalog), "granular results must not expose a persisted wire format");
  assert(Object.isFrozen(catalog), "granular results must be immutable");

  for (const specifier of [
    "@mit-sdg/sync-engine/tooling",
    "@mit-sdg/sync-engine-analysis/ir",
    "@mit-sdg/sync-engine-analysis/project",
  ]) {
    const entrypoint = fileURLToPath(import.meta.resolve(specifier));
    const packageRoot = resolve(entrypoint, "../../..");
    assert(
      !lstatSync(packageRoot).isSymbolicLink(),
      `${specifier} resolved through a package symlink`,
    );
    assert(
      entrypoint.startsWith(resolve(consumer, "node_modules")),
      `${specifier} resolved outside the packed consumer`,
    );
  }

  console.log(`[${runtime}] packed analysis consumer scenario passed`);
} finally {
  rmSync(projectDirectory, { recursive: true, force: true });
}
