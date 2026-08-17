import { registerHooks } from "node:module";
import { parentPort } from "node:worker_threads";

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly limit?: string;
  readonly maximum?: number;
  readonly attempted?: number;
}

function serializedError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  const detail = error as Error & {
    readonly code?: unknown;
    readonly limit?: unknown;
    readonly maximum?: unknown;
    readonly attempted?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(typeof detail.code === "string" ? { code: detail.code } : {}),
    ...(typeof detail.limit === "string" ? { limit: detail.limit } : {}),
    ...(typeof detail.maximum === "number" ? { maximum: detail.maximum } : {}),
    ...(typeof detail.attempted === "number" ? { attempted: detail.attempted } : {}),
  };
}

if (parentPort === null) throw new Error("application project worker requires a parent port");
const port = parentPort;

const sourceWorker = new URL(import.meta.url).pathname.endsWith(".ts");
if (sourceWorker) {
  const coreRoot = new URL("../../../../", import.meta.url);
  const enginePrefix = ["@engine", "/"].join("");
  const rootPrefix = ["@root", "/"].join("");
  const ssfSpecifier = ["@", "ssf"].join("");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@mit-sdg/sync-engine/tooling") {
        return { url: new URL("src/tooling/index.ts", coreRoot).href, shortCircuit: true };
      }
      if (specifier === ssfSpecifier) {
        return {
          url: new URL("packages/ssf/src/index.ts", coreRoot).href,
          shortCircuit: true,
        };
      }
      if (specifier.startsWith(enginePrefix)) {
        return {
          url: new URL(`src/engine/${specifier.slice(enginePrefix.length)}.ts`, coreRoot).href,
          shortCircuit: true,
        };
      }
      if (specifier.startsWith(rootPrefix)) {
        return {
          url: new URL(specifier.slice(rootPrefix.length), coreRoot).href,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });
}

const implementation = await import(
  sourceWorker ? "./application-project.ts" : "./application-project.js"
);

port.once("message", async (options: unknown) => {
  try {
    const analysis = implementation.loadApplicationProject(options as never);
    port.postMessage({ type: "success", analysis });
  } catch (error) {
    port.postMessage({ type: "error", error: serializedError(error) });
  } finally {
    port.close();
  }
});
