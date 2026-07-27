#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkGenerated,
  pinGenerated,
  renderGenerated,
  resolveApplication,
  type GeneratedApplication,
} from "@engine/tooling/generated-artifacts";
import { scaffoldProject } from "./scaffold.ts";
import { describeError } from "@engine/utils/redaction";

const usage = `Usage: sync-engine <topic> <command>

  sync-engine new <directory>
    Write a runnable project: one concept, its composition, and its config.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

The configuration path defaults to generated.config.ts.`;

const HELP = new Set([undefined, "help", "--help", "-h"]);

async function main(): Promise<void> {
  const [topic, action, ...options] = process.argv.slice(2);
  if (HELP.has(topic) || (topic === "artifacts" && HELP.has(action))) {
    console.log(usage);
    return;
  }

  if (topic === "new") {
    if (action === undefined) throw new Error(usage);
    const written = await scaffoldProject(action);
    console.log(`Wrote ${written.length} files into ${action}:`);
    for (const path of written) console.log(`  ${path}`);
    console.log(`\nNext: cd ${action} && bun install && bun run generate && bun run start`);
    return;
  }
  if (topic !== "artifacts") throw new Error(usage);

  const configIndex = options.indexOf("--config");
  const configPath = configIndex === -1 ? "generated.config.ts" : options.at(configIndex + 1);
  if (configPath === undefined) throw new Error(usage);
  const configUrl = pathToFileURL(resolve(process.cwd(), configPath));
  const module = (await import(configUrl.href)) as { default?: GeneratedApplication };
  if (module.default === undefined) {
    throw new Error(`${configPath} must default-export an application artifact configuration`);
  }
  const application = resolveApplication(module.default, configUrl);

  switch (action) {
    case "check":
      await checkGenerated(application);
      break;
    case "pin":
      await pinGenerated(application);
      break;
    case "pin-spec":
      await pinGenerated(application, "specification");
      break;
    case "pin-wire":
      await pinGenerated(application, "wire");
      break;
    case "spec": {
      const rendered = renderGenerated(application);
      console.log("Assembly summary");
      console.log(`registered reactions: ${rendered.metrics.reactions}`);
      console.log(`registered views: ${rendered.metrics.views}`);
      console.log(`registered formers: ${rendered.metrics.formers}`);
      console.log(
        `reactions represented only by executable code: ${rendered.metrics.unlowered.length}`,
      );
      for (const item of rendered.metrics.unlowered) {
        console.log(`  - ${item.name}: ${item.reason}`);
      }
      console.log(`named computations used in conditions: ${rendered.metrics.compute}`);
      console.log("");
      console.log(rendered.specification);
      break;
    }
    case "wire":
      console.log(renderGenerated(application).wire);
      break;
    default:
      throw new Error(usage);
  }
}

try {
  await main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
