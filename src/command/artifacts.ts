import {
  checkGenerated,
  inspectGenerated,
  pinGenerated,
  renderGenerated,
} from "@engine/tooling/generated-artifacts";
import { applicationManifest, renderApplicationManifest } from "@engine/tooling/manifest";
import { loadGeneratedApplication } from "./generated-config.ts";

const HELP = new Set([undefined, "help", "--help", "-h"]);
const ACTIONS = new Set(["check", "pin", "pin-spec", "pin-wire", "manifest", "spec", "wire"]);

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
    if (options.length > 0) throw new Error(usage);
    console.log(usage);
    return;
  }

  if (!ACTIONS.has(action)) throw new Error(usage);
  if (
    options.length !== 0 &&
    (options.length !== 2 || options[0] !== "--config" || options[1].startsWith("-"))
  ) {
    throw new Error(usage);
  }
  const configPath = options.length === 0 ? "generated.config.ts" : options[1];
  const application = await loadGeneratedApplication(configPath, process.cwd());

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
