import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkGenerated,
  inspectGenerated,
  pinGenerated,
  renderGenerated,
  resolveApplication,
  type GeneratedApplication,
} from "@engine/tooling/generated-artifacts";
import { applicationManifest, renderApplicationManifest } from "@engine/tooling/manifest";

const HELP = new Set([undefined, "help", "--help", "-h"]);

const usage = `sync-engine artifacts <command> [--config path]
  check      Verify the assembled read-back and wire contract against the assembly.
  pin        Regenerate the assembled read-back and wire contract.
  pin-spec   Regenerate only the assembled read-back.
  pin-wire   Regenerate only the wire contract.
  manifest   Print the canonical application manifest as JSON.
  spec       Print assembly counts and the assembled read-back.
  wire       Print the wire contract.

The configuration path defaults to generated.config.ts.`;

export async function artifactsCommand(args: readonly string[]): Promise<void> {
  const [action, ...options] = args;
  if (HELP.has(action)) {
    console.log(usage);
    return;
  }

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
    case "manifest":
      process.stdout.write(
        await inspectGenerated(application, (assembled) =>
          renderApplicationManifest(applicationManifest(assembled)),
        ),
      );
      break;
    case "spec": {
      const rendered = await renderGenerated(application);
      console.log("Assembly summary");
      console.log(`registered reactions: ${rendered.metrics.reactions}`);
      console.log(`registered views: ${rendered.metrics.views}`);
      console.log(`registered formers: ${rendered.metrics.formers}`);
      console.log(`named computations used in conditions: ${rendered.metrics.compute}`);
      console.log("");
      console.log(rendered.specification);
      break;
    }
    case "wire":
      console.log((await renderGenerated(application)).wire);
      break;
    default:
      throw new Error(usage);
  }
}
