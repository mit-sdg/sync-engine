import { readFile } from "node:fs/promises";
import {
  diffApplicationManifests,
  type ApplicationManifestChange,
  type ApplicationManifestDiffReport,
} from "@engine/tooling/application-manifest-diff";
import { parseApplicationManifest } from "@engine/tooling/application-manifest-format";
import {
  checkGenerated,
  inspectGenerated,
  pinGenerated,
  renderGenerated,
} from "@engine/tooling/generated-artifacts";
import { applicationManifest, renderApplicationManifest } from "@engine/tooling/manifest";
import { describeError } from "@engine/utils/redaction";
import { loadGeneratedApplication } from "./generated-config.ts";

const HELP = new Set([undefined, "help", "--help", "-h"]);
const ACTIONS = new Set([
  "check",
  "pin",
  "pin-spec",
  "pin-wire",
  "manifest",
  "diff",
  "spec",
  "wire",
]);

const usage = `sync-engine artifacts <command> [arguments]
  check      Verify the assembled read-back and wire contract against the assembly.
  pin        Regenerate the assembled read-back and wire contract.
  pin-spec   Regenerate only the assembled read-back.
  pin-wire   Regenerate only the wire contract.
  manifest   Print the canonical application manifest as JSON.
  diff <old-manifest> [--config path]
             Compare a saved application manifest with the configured application.
  spec       Print assembly counts and the assembled read-back.
  wire       Print the wire contract.

The configuration path defaults to generated.config.ts.`;

function configPathFor(options: readonly string[]): string {
  if (
    options.length !== 0 &&
    (options.length !== 2 || options[0] !== "--config" || options[1].startsWith("-"))
  ) {
    throw new Error(usage);
  }
  return options.length === 0 ? "generated.config.ts" : options[1]!;
}

function diffOptions(options: readonly string[]): { oldManifestPath: string; configPath: string } {
  const [oldManifestPath, ...config] = options;
  if (
    oldManifestPath === undefined ||
    oldManifestPath.startsWith("-") ||
    (config.length !== 0 &&
      (config.length !== 2 || config[0] !== "--config" || config[1]?.startsWith("-")))
  ) {
    throw new Error(usage);
  }
  return {
    oldManifestPath,
    configPath: config.length === 0 ? "generated.config.ts" : config[1]!,
  };
}

async function oldManifest(path: string) {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `artifacts diff: cannot read old manifest ${JSON.stringify(path)}: ${describeError(error)}`,
    );
  }
  try {
    return parseApplicationManifest(source);
  } catch (error) {
    throw new Error(
      `artifacts diff: cannot decode old manifest ${JSON.stringify(path)}: ${describeError(error)}`,
    );
  }
}

function renderedValue(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function renderedChange(change: ApplicationManifestChange): string {
  switch (change.kind) {
    case "endpoint-added":
      return `endpoint added: ${JSON.stringify(change.endpoint.name)} at ${JSON.stringify(change.endpoint.path)}`;
    case "endpoint-removed":
      return `endpoint removed: ${JSON.stringify(change.endpoint.name)} at ${JSON.stringify(change.endpoint.path)}`;
    case "input-required-added":
      return `input contract ${JSON.stringify(change.path)}: required key added ${JSON.stringify(change.key)}`;
    case "input-required-removed":
      return `input contract ${JSON.stringify(change.path)}: required key removed ${JSON.stringify(change.key)}`;
    case "input-default-added":
      return `input contract ${JSON.stringify(change.path)}: default added for ${JSON.stringify(change.key)} = ${renderedValue(change.value)}`;
    case "input-default-removed":
      return `input contract ${JSON.stringify(change.path)}: default removed for ${JSON.stringify(change.key)} = ${renderedValue(change.value)}`;
    case "input-default-changed":
      return `input contract ${JSON.stringify(change.path)}: default changed for ${JSON.stringify(change.key)} from ${renderedValue(change.before)} to ${renderedValue(change.after)}`;
    case "refusal-code-added":
      return `refusal code added: ${JSON.stringify(change.refusal.code)} on ${JSON.stringify(`${change.refusal.concept}.${change.refusal.action}`)}`;
    case "refusal-code-removed":
      return `refusal code removed: ${JSON.stringify(change.refusal.code)} on ${JSON.stringify(`${change.refusal.concept}.${change.refusal.action}`)}`;
    case "owned-type-added":
      return `owned type added: ${JSON.stringify(change.ownedType.type)} on ${JSON.stringify(change.ownedType.definition)}`;
    case "owned-type-removed":
      return `owned type removed: ${JSON.stringify(change.ownedType.type)} on ${JSON.stringify(change.ownedType.definition)}`;
  }
}

function printChanges(label: string, changes: readonly ApplicationManifestChange[]): void {
  console.log(`  ${label}:`);
  if (changes.length === 0) {
    console.log("    none");
    return;
  }
  for (const change of changes) console.log(`    - ${renderedChange(change)}`);
}

function printDiffReport(report: ApplicationManifestDiffReport): void {
  console.log(`Application manifest diff: ${report.status}`);
  console.log(`  old manifest digest: ${report.old.digest}`);
  console.log(`  current manifest digest: ${report.current.digest}`);
  printChanges("breaking changes", report.breaking);
  printChanges("non-breaking changes", report.nonBreaking);
  if (report.status === "changed" && report.breaking.length + report.nonBreaking.length === 0) {
    console.log(
      "  note: the manifest digest changed outside the tracked compatibility inventories.",
    );
  }
}

export async function artifactsCommand(
  args: readonly string[],
): Promise<ApplicationManifestDiffReport | undefined> {
  const [action, ...options] = args;
  if (HELP.has(action)) {
    if (options.length > 0) throw new Error(usage);
    console.log(usage);
    return undefined;
  }

  if (!ACTIONS.has(action)) throw new Error(usage);
  if (action === "diff") {
    const { oldManifestPath, configPath } = diffOptions(options);
    const previous = await oldManifest(oldManifestPath);
    const application = await loadGeneratedApplication(configPath, process.cwd());
    const current = await inspectGenerated(application, (assembled) =>
      applicationManifest(assembled),
    );
    const report = diffApplicationManifests(previous, current);
    printDiffReport(report);
    return report;
  }

  const application = await loadGeneratedApplication(configPathFor(options), process.cwd());
  switch (action) {
    case "check":
      await checkGenerated(application);
      return undefined;
    case "pin":
      await pinGenerated(application);
      return undefined;
    case "pin-spec":
      await pinGenerated(application, "specification");
      return undefined;
    case "pin-wire":
      await pinGenerated(application, "wire");
      return undefined;
    case "manifest":
      process.stdout.write(
        await inspectGenerated(application, (assembled) =>
          renderApplicationManifest(applicationManifest(assembled)),
        ),
      );
      return undefined;
    case "spec": {
      const rendered = await renderGenerated(application);
      console.log("Assembly summary");
      console.log(`registered reactions: ${rendered.metrics.reactions}`);
      console.log(`registered views: ${rendered.metrics.views}`);
      console.log(`registered formers: ${rendered.metrics.formers}`);
      console.log(`named computations used in conditions: ${rendered.metrics.compute}`);
      console.log("");
      console.log(rendered.specification);
      return undefined;
    }
    case "wire":
      console.log((await renderGenerated(application)).wire);
      return undefined;
    default:
      throw new Error(usage);
  }
}
