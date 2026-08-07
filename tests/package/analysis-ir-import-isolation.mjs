import { registerHooks } from "node:module";

const resolved = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    resolved.push({ specifier, url: result.url });
    return result;
  },
});

const ir = await import("@mit-sdg/sync-engine-analysis/ir");
if (
  typeof ir.indexApplication !== "function" ||
  typeof ir.createApplicationAnalysis !== "function"
) {
  throw new Error("packed /ir entrypoint omitted its consumer primitives");
}

const forbidden = resolved.filter(
  ({ specifier, url }) =>
    specifier === "typescript" ||
    specifier === "fs" ||
    specifier === "fs/promises" ||
    specifier === "node:fs" ||
    specifier === "node:fs/promises" ||
    specifier === "worker_threads" ||
    specifier === "node:worker_threads" ||
    url.includes("/node_modules/typescript/") ||
    url.includes("/@mit-sdg/sync-engine-analysis/dist/project/") ||
    url.includes("/application-project-worker.") ||
    specifier === "@mit-sdg/sync-engine-analysis/project",
);
if (forbidden.length > 0) {
  throw new Error(`packed /ir import loaded forbidden modules: ${JSON.stringify(forbidden)}`);
}

console.log("packed /ir import remained compiler and project-loader free");
