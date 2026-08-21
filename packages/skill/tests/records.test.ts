import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  digestDesign,
  finalizeLaunch,
  prepareLaunch,
  readLaunchRecord,
  sha256,
  type FinalizeLaunchOptions,
  type FinalizedLaunchRecord,
  type RetainedSource,
} from "../skills/sync-engine/scripts/records.ts";
import type { EffectiveCapabilityGrant } from "../skills/sync-engine/scripts/roles.ts";
import { startWorkUnit } from "../skills/sync-engine/scripts/work.ts";
import { rejectedValue } from "./test-support.ts";

const temporary: string[] = [];

async function work(slug = "records"): Promise<{ root: string; path: string; slug: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-records-"));
  temporary.push(root);
  const unit = await startWorkUnit({
    applicationRoot: root,
    slug,
    briefTemplate: "# Goal\n\nExercise records.\n",
  });
  return { root, path: unit.path, slug: unit.slug };
}

const grant: EffectiveCapabilityGrant = {
  readableAreas: [],
  writableAreas: [],
  toolKinds: [],
  projectShell: "none",
  network: false,
  generatedOutput: false,
  longRunningProcesses: false,
};

const retained: readonly RetainedSource[] = [
  { inputId: "brief", displayName: "brief.md", sha256: "a".repeat(64) },
];

async function prepared(
  unit: { root: string; slug: string },
  overrides: Partial<Parameters<typeof prepareLaunch>[0]> = {},
) {
  const prompt = "# Role and objective\n\nImplement the bounded task.\n";
  return prepareLaunch({
    applicationRoot: unit.root,
    slug: unit.slug,
    role: "concept-worker",
    phase: "implementation",
    harness: "paseo",
    timeoutSeconds: 300,
    task: "# Task\n\nImplement Posting.\n",
    prompt,
    promptSha256: sha256(prompt),
    grant,
    retainedSources: retained,
    at: new Date("2026-08-19T09:06:43.000Z"),
    ...overrides,
  });
}

type CompletionOverrides = Partial<Omit<FinalizeLaunchOptions, "recordPath">>;

async function complete(
  recordPath: string,
  response: string | Uint8Array | undefined,
  overrides: CompletionOverrides = {},
) {
  if (response !== undefined) {
    const record = await readLaunchRecord(recordPath);
    await writeFile(record.response.path, response);
  }
  return finalizeLaunch({
    recordPath,
    agentId: "agent-a",
    status: "completed",
    enforcement: "harness-enforced",
    ...overrides,
  });
}

async function finalizedTarget(
  unit: { root: string; slug: string },
  overrides: Partial<Parameters<typeof prepareLaunch>[0]> = {},
): Promise<{ path: string; record: FinalizedLaunchRecord }> {
  const launch = await prepared(unit, overrides);
  const record = await complete(launch.path, "Status: complete\n", {
    agentId: "agent-original",
  });
  return { path: launch.path, record };
}

async function design(root: string): Promise<string> {
  const path = resolve(root, "design");
  await mkdir(resolve(path, "concepts"), { recursive: true });
  await writeFile(resolve(path, "concepts/Posting.md"), "# Posting\n", "utf8");
  await writeFile(resolve(path, "composition.md"), "# Composition\n", "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prepared and finalized records", () => {
  test("binds launch controls, retained context, artifacts, and captured response", async () => {
    const unit = await work();
    const launch = await prepared(unit, { harness: "codex", timeoutSeconds: 91 });

    expect(launch.record).toMatchObject({
      state: "prepared",
      harness: "codex",
      timeoutSeconds: 91,
      grant,
      retainedSources: retained,
      prompt: { path: launch.artifacts.promptPath },
      capabilities: { path: launch.artifacts.capabilitiesPath },
      response: { path: launch.artifacts.responsePath },
    });
    expect(launch.record.prompt.sha256).toBe(sha256(await readFile(launch.artifacts.promptPath)));
    expect(launch.record.capabilities.sha256).toBe(
      sha256(await readFile(launch.artifacts.capabilitiesPath)),
    );

    const response = "verbatim\r\nresponse without a trailing newline";
    await writeFile(launch.artifacts.responsePath, response);
    const final = await finalizeLaunch({
      recordPath: launch.path,
      agentId: "codex-thread-42",
      status: "completed",
      enforcement: "prompt-guided",
      model: "gpt-example",
      harness: "paseo",
    } as FinalizeLaunchOptions & { harness: "paseo" });

    expect(final.harness).toBe("codex");
    expect(final.response).toEqual({
      path: launch.artifacts.responsePath,
      sha256: sha256(response),
      bytes: Buffer.byteLength(response),
    });
    expect(await readFile(final.response.path, "utf8")).toBe(response);
  });

  test("verifies both prompt and capability artifact hashes", async () => {
    const unit = await work("artifact-tamper");
    const promptLaunch = await prepared(unit);
    await writeFile(promptLaunch.artifacts.promptPath, "# changed\n");
    expect(
      await rejectedValue(complete(promptLaunch.path, "partial", { status: "failed" })),
    ).toEqual({ name: "RecordError", message: "Prompt changed after preparation" });

    const capabilityLaunch = await prepared(unit, {
      at: new Date("2026-08-19T09:06:44.000Z"),
    });
    await writeFile(capabilityLaunch.artifacts.capabilitiesPath, "{}\n");
    expect(
      await rejectedValue(complete(capabilityLaunch.path, "partial", { status: "failed" })),
    ).toEqual({
      name: "RecordError",
      message: "Capability artifact changed after preparation",
    });
  });

  test("rejects a manually changed embedded grant", async () => {
    const unit = await work("grant-tamper");
    const launch = await prepared(unit);
    await writeFile(
      launch.path,
      `${JSON.stringify(
        { ...launch.record, grant: { ...launch.record.grant, network: true } },
        undefined,
        2,
      )}\n`,
    );

    expect(await rejectedValue(complete(launch.path, "partial", { status: "failed" }))).toEqual({
      name: "RecordError",
      message: "Effective grant changed after preparation",
    });
  });

  test("binds an empty captured response for terminal failure", async () => {
    const unit = await work("empty-failure");
    const launch = await prepared(unit);
    const final = await complete(launch.path, undefined, { status: "failed" });

    expect(final.response).toEqual({
      path: launch.artifacts.responsePath,
      sha256: sha256(""),
      bytes: 0,
    });
  });
});

describe("relationship identity snapshots", () => {
  test("continuation binds its harness and agent without rereading a mutable target", async () => {
    const unit = await work("continuation");
    const target = await finalizedTarget(unit, { role: "critic", phase: "contracts" });

    expect(
      await rejectedValue(
        prepared(unit, {
          role: "critic",
          phase: "verification",
          harness: "codex",
          relationship: { kind: "continuation", recordPath: target.path },
        }),
      ),
    ).toEqual({
      name: "RecordError",
      message: "Continuation must select the related launch harness",
    });

    const next = await prepared(unit, {
      role: "critic",
      phase: "verification",
      relationship: { kind: "continuation", recordPath: target.path },
      at: new Date("2026-08-19T09:12:00.000Z"),
    });
    expect(next.record.relationship).toEqual({
      kind: "continuation",
      recordPath: target.path,
      targetHarness: "paseo",
      targetAgentId: "agent-original",
    });

    await writeFile(
      target.path,
      `${JSON.stringify({ ...target.record, harness: "codex", agentId: "mutated" }, undefined, 2)}\n`,
    );
    expect(
      await rejectedValue(complete(next.path, "resolved", { agentId: "agent-other" })),
    ).toEqual({
      name: "RecordError",
      message: "Continuation must use the snapshotted harness and agent",
    });
    const final = await complete(next.path, undefined, { agentId: "agent-original" });
    expect(final.agentId).toBe("agent-original");
  });

  test("replacement remains explicit and requires a fresh identity", async () => {
    const unit = await work("replacement");
    const target = await finalizedTarget(unit);
    const replacement = await prepared(unit, {
      relationship: { kind: "replacement", recordPath: target.path },
      at: new Date("2026-08-19T09:12:00.000Z"),
    });
    expect(
      await rejectedValue(complete(replacement.path, "replacement", { agentId: "agent-original" })),
    ).toEqual({ name: "RecordError", message: "Replacement must use a new agent identity" });
    const final = await complete(replacement.path, undefined, { agentId: "agent-replacement" });
    expect(final.relationship?.kind).toBe("replacement");
  });
});

describe("design lifecycle", () => {
  test("contract designer binds an absent first design and records its authored result", async () => {
    const unit = await work("first-design");
    const root = resolve(unit.root, "design");
    const empty = { digest: sha256(""), files: 0 };

    expect(await digestDesign(root)).toEqual(empty);
    await mkdir(root);
    expect(await digestDesign(root)).toEqual(empty);
    await rm(root, { recursive: true });

    const launch = await prepared(unit, {
      role: "designer",
      phase: "contracts",
      design: { root, digest: empty.digest },
    });
    await mkdir(resolve(root, "concepts"), { recursive: true });
    await writeFile(resolve(root, "concepts/Posting.md"), "# Posting\n");
    const authored = await digestDesign(root);
    const final = await complete(launch.path, "Changed: design/concepts/Posting.md\n");

    expect(authored.files).toBe(1);
    expect(final.design).toEqual({ root, before: empty.digest, after: authored.digest });
  });

  test("contract designer records before and after authored-design digests", async () => {
    const unit = await work("design-writer");
    const root = await design(unit.root);
    const before = await digestDesign(root);
    await writeFile(resolve(root, ".DS_Store"), "ignored metadata");
    await writeFile(resolve(root, "build.json"), "{}\n");
    expect((await digestDesign(root)).digest).toBe(before.digest);

    const launch = await prepared(unit, {
      role: "designer",
      phase: "contracts",
      design: { root, digest: before.digest },
    });
    await writeFile(resolve(root, "composition.md"), "# Changed composition\n");
    const after = await digestDesign(root);
    const final = await complete(launch.path, "Changed: design/composition.md\n");

    expect(final.design).toEqual({ root, before: before.digest, after: after.digest });
    const linked = resolve(root, "linked.md");
    await symlink(resolve(root, "composition.md"), linked);
    expect(await rejectedValue(digestDesign(root))).toEqual({
      name: "RecordError",
      message: `Design contains a symbolic link: ${linked}`,
    });
  });

  test("non-design-writer rejects stale authored design", async () => {
    const unit = await work("design-reader");
    const root = await design(unit.root);
    const before = await digestDesign(root);
    const launch = await prepared(unit, {
      role: "frontend-worker",
      phase: "implementation",
      design: { root, digest: before.digest },
    });
    await writeFile(resolve(root, "composition.md"), "# Changed\n");

    expect(await rejectedValue(complete(launch.path, "Status: complete\n"))).toEqual({
      name: "RecordError",
      message: "Design changed after preparation",
    });
  });
});

describe("decoder and cleanup", () => {
  test("validates supported role/phase and harness values", async () => {
    const unit = await work("malformed");
    const launch = await prepared(unit);
    await writeFile(launch.path, `${JSON.stringify({ ...launch.record, harness: "other" })}\n`);
    expect(await rejectedValue(readLaunchRecord(launch.path))).toEqual({
      name: "RecordError",
      message: "Harness is invalid",
    });

    await writeFile(
      launch.path,
      `${JSON.stringify({ ...launch.record, role: "critic", phase: "implementation" })}\n`,
    );
    expect(await rejectedValue(readLaunchRecord(launch.path))).toEqual({
      name: "RecordError",
      message: "Role and phase combination is invalid: critic/implementation",
    });
  });

  test("removes only artifacts created after reserving a failed run", async () => {
    const unit = await work("cleanup");
    const stem = "2026-08-19T09-06-43Z-concept-worker-implementation";
    const injected = resolve(unit.path, `${stem}.capabilities.json`);
    const malicious = {
      ...grant,
      toJSON() {
        writeFileSync(injected, "external\n");
        return grant;
      },
    } as EffectiveCapabilityGrant;

    expect(await rejectedValue(prepared(unit, { grant: malicious }))).toEqual({
      name: "RecordError",
      message: `Cannot prepare launch: Error: EEXIST: file already exists, open '${injected}'`,
    });
    expect((await readdir(unit.path)).sort()).toEqual([`${stem}.capabilities.json`, "brief.md"]);
    expect(await readFile(injected, "utf8")).toBe("external\n");
  });
});
