import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { applicationExamples } from "../examples/register.ts";
import { checkArchitecture } from "./architecture.ts";
import { workspaceCatalog } from "./workspaces.ts";
import { filesBelow } from "../src/command/files-below.ts";

const root = resolve(import.meta.dirname, "..");

function repositoryFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(root, path)))
    .sort();
}

function repositoryPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

const repository = repositoryFiles();
const inspectedTypeScript = (
  await Promise.all(
    ["src", "tests", "packages"].map((directory) =>
      existsSync(resolve(root, directory))
        ? filesBelow(resolve(root, directory), (name) => name.endsWith(".ts"))
        : [],
    ),
  )
)
  .flat()
  .map(repositoryPath);
const inspectedFiles = new Set([...repository, ...inspectedTypeScript]);
const files = new Map(
  [...inspectedFiles].map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
);
const possibleEmptyDirectories = [
  "cli",
  "gateway",
  "hosting",
  "http",
  "runtime",
  "sdk",
  "storage",
  "tests/engine",
  "tests/runtime",
  "tests/sdk",
];
const directories = new Set(
  possibleEmptyDirectories.filter((directory) => existsSync(resolve(root, directory))),
);
const projectDirectories = new Set([
  ...Object.values(applicationExamples).map(({ directory }) => `examples/${directory}/`),
  ...workspaceCatalog
    .filter((workspace) => workspace.directory !== ".")
    .map((workspace) => `${workspace.directory}/`),
  "src/command/setup/",
  "tests/packaging/application/",
  "packages/http/tests/packaging/multi-instance/",
]);
const result = checkArchitecture({
  files,
  repositoryFiles: repository,
  directories,
  projectDirectories,
});

if (result.failures.length > 0) {
  throw new Error(
    `Architecture dependency check failed:\n${result.failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`,
  );
}

console.log(
  `architecture check passed for ${repository.length} repository files; ` +
    `${result.runtimeCycles.length} runtime import SCCs`,
);
