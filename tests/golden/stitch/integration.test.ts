import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { runCli, type CliResult } from "./app.ts";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  stateFile: string;
  run: (...args: string[]) => Promise<CliResult>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "stitch-golden-"));
  temporaryDirectories.push(directory);
  const stateFile = join(directory, "state.json");
  return { stateFile, run: (...args) => runCli(args, stateFile) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function record(command: string, result: CliResult): string {
  expect(result.exitCode).toBe(result.stderr ? 1 : 0);
  const output = result.stdout || `error: ${result.stderr}`;
  return `$ stitch ${command}\n${output.trimEnd()}`;
}

async function golden(name: string): Promise<string> {
  return readFile(new URL(`./golden/${name}.txt`, import.meta.url), "utf8");
}

describe("golden: stitch CLI", () => {
  test("a complete work session matches the public CLI contract", async () => {
    const { run } = await fixture();
    const transcript: string[] = [];

    transcript.push(
      record(
        "add Ship release --priority high",
        await run("add", "Ship release", "--priority", "high"),
      ),
    );
    transcript.push(record("add Write release notes", await run("add", "Write release notes")));
    transcript.push(record("start W001", await run("start", "W001")));
    transcript.push(record("start W002", await run("start", "W002")));
    transcript.push(record("list", await run("list")));
    transcript.push(record("done W002", await run("done", "W002")));
    transcript.push(record("status", await run("status")));
    transcript.push(record("list --all", await run("list", "--all")));
    transcript.push(record("log", await run("log")));

    expect(`${transcript.join("\n")}\n`).toBe(await golden("session"));
  });

  test("errors are stable and failed commands do not mutate state", async () => {
    const { stateFile, run } = await fixture();
    const transcript: string[] = [];

    transcript.push(record("add", await run("add")));
    transcript.push(
      record(
        "add Fix tests --priority urgent",
        await run("add", "Fix tests", "--priority", "urgent"),
      ),
    );
    transcript.push(record("start W404", await run("start", "W404")));
    transcript.push(record("wat", await run("wat")));
    transcript.push(record("list", await run("list")));

    expect(`${transcript.join("\n")}\n`).toBe(await golden("errors"));
    await expect(readFile(stateFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
