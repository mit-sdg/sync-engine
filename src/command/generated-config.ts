import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveApplication, type GeneratedApplication } from "@engine/tooling/generated-artifacts";

export async function loadGeneratedApplication(configPath: string, root: string) {
  const configUrl = pathToFileURL(resolve(root, configPath));
  const module = (await import(configUrl.href)) as { default?: GeneratedApplication };
  if (module.default === undefined) {
    throw new Error(`${configPath} must default-export an application artifact configuration`);
  }
  return resolveApplication(module.default, configUrl);
}
