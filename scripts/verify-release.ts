import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const gates = [
  ["install", "--frozen-lockfile"],
  ["run", "release:check"],
  ["run", "check"],
  ["run", "test"],
  ["run", "coverage"],
  ["run", "build"],
  ["run", "declarations:check"],
  ["run", "examples:check"],
  ["run", "scenario"],
  ["run", "package:check"],
  ["audit"],
] as const;

for (const args of gates) {
  console.log(`\n$ bun ${args.join(" ")}`);
  execFileSync("bun", [...args], { cwd: root, env: process.env, stdio: "inherit" });
}
