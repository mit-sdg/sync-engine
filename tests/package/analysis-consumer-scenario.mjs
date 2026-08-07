import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
import {
  applicationManifest,
  parseApplicationManifest,
  renderApplicationManifest,
} from "@mit-sdg/sync-engine/tooling";
import {
  analyzeApplicationProject,
  applicationAnalysisResultDigest,
  applicationProjectAnalysisDigest,
  createApplicationAnalysis,
  loadApplicationProject,
  parseApplicationAnalysisResult,
  parseApplicationProjectAnalysis,
  renderApplicationAnalysisResult,
  renderApplicationProjectAnalysis,
} from "@mit-sdg/sync-engine-analysis/tooling";
import {
  guidanceResourceDigest,
  guidanceSelectionDigest,
  loadGuidanceResource,
  selectGuidance,
  validateGuidanceResource,
  validateGuidanceSelection,
} from "@mit-sdg/sync-engine-analysis/guidance";

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
assert(manifest.version === 5, "packed consumer did not generate and parse a V5 manifest");
assert(manifest.generator.version === "1.0.0-beta.7", "packed core provenance is not beta.7");

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
    `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";

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
    project.provenance.analyzer.version === "1.0.0-beta.7",
    "packed analyzer provenance is not beta.7",
  );
  assert(
    project.provenance.manifest.generator.version === "1.0.0-beta.7",
    "packed project core provenance is not beta.7",
  );
  assert(
    project.provenance.files.every(({ path }) => !path.startsWith("..")),
    "packed analysis escaped its consumer root",
  );

  const renderedProject = renderApplicationProjectAnalysis(project);
  const parsedProject = parseApplicationProjectAnalysis(renderedProject);
  assert(
    applicationProjectAnalysisDigest(parsedProject) === applicationProjectAnalysisDigest(project),
    "packed project codec round trip changed its digest",
  );

  const facade = createApplicationAnalysis({ manifest, project: parsedProject });
  const catalog = await facade.catalog();
  assert(
    catalog.items.some(({ ref }) => ref.kind === "reaction" && ref.reaction === "RecordNote"),
    "packed catalog omitted RecordNote",
  );
  const action = { kind: "action", concept: "Notes", action: "add" };
  const description = await facade.describe({ ref: action, detail: "full" });
  assert(
    description.sources?.some(({ text }) => text?.includes("add(")),
    "packed description omitted source",
  );
  const sources = await facade.sources({ query: { kind: "ref", ref: action }, content: "text" });
  assert(
    sources.items.some(({ text }) => text?.includes("add(")),
    "packed source lookup omitted action text",
  );
  const impact = await facade.impact({ seeds: [action] });
  assert(impact.trace.seeds.length === 1, "packed impact did not retain its seed");

  const guidanceResource = await loadGuidanceResource();
  validateGuidanceResource(guidanceResource);
  assert(
    guidanceResource.producer.analysis.version === "1.0.0-beta.7",
    "packed guidance analyzer producer is not beta.7",
  );
  assert(
    guidanceResource.producer.coreVersion === "1.0.0-beta.7",
    "packed guidance core producer is not beta.7",
  );
  assert(
    guidanceResourceDigest(guidanceResource) === guidanceResource.digest &&
      /^[a-f0-9]{64}$/.test(guidanceResource.source.documentsDigest),
    "packed guidance resource digests are invalid",
  );
  const guidanceSelection = selectGuidance(guidanceResource, {
    ids: ["design-reactions", "review-scenarios"],
  });
  validateGuidanceSelection(guidanceSelection);
  assert(
    guidanceSelectionDigest(guidanceSelection) === guidanceSelection.digest,
    "packed guidance selection digest is invalid",
  );
  const guidanceResult = await facade.guidance({ selection: guidanceSelection });
  assert(
    guidanceResult.canonicalGuidance?.resourceDigest === guidanceResource.digest &&
      guidanceResult.canonicalGuidance.entries.map(({ id }) => id).join(",") ===
        "design-reactions,review-scenarios",
    "packed analysis guidance did not retain canonical selection identity",
  );

  const renderedResult = renderApplicationAnalysisResult(catalog);
  const parsedResult = parseApplicationAnalysisResult(renderedResult);
  assert(
    applicationAnalysisResultDigest(parsedResult) === applicationAnalysisResultDigest(catalog),
    "packed result codec round trip changed its digest",
  );

  for (const specifier of [
    "@mit-sdg/sync-engine/tooling",
    "@mit-sdg/sync-engine-analysis/guidance",
    "@mit-sdg/sync-engine-analysis/tooling",
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
