import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  type LaunchRecord,
  isLaunchRecord,
  readLaunchRecords,
  requireCompletedRole,
  finishedStatuses,
  requireInsideWorkspace,
  resumableStatus,
  reserveWorkspacePath,
  stamp,
  verifiedRecords,
  workspaceDirectory,
  workspaceFileRole,
  writeLaunchRecord,
} from "../skills/sync-engine/scripts/workspace.ts";

const temporary: string[] = [];

async function applicationRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sync-engine-skill-workspace-")));
  temporary.push(root);
  await mkdir(resolve(root, workspaceDirectory), { recursive: true });
  return root;
}

async function record(
  root: string,
  role: string,
  overrides: Partial<LaunchRecord> = {},
): Promise<LaunchRecord> {
  const promptPath = await reserveWorkspacePath("prompt", role, root);
  const content = `# ${role}\n`;
  await writeFile(promptPath, content, "utf8");
  const built: LaunchRecord = {
    format: "sync-engine.skill.launch-record",
    version: 1,
    role,
    agentId: `agent-${role}`,
    provider: "test",
    model: "test-model",
    cwd: root,
    prompt: {
      path: promptPath,
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: Buffer.byteLength(content, "utf8"),
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    settledAt: "2026-01-01T00:05:00.000Z",
    status: "idle",
    ...overrides,
  };
  await writeLaunchRecord(await reserveWorkspacePath("launch", role, root), built);
  return built;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workspace paths", () => {
  test("stamps to seconds and resolves collisions", async () => {
    expect(stamp(new Date("2026-08-19T09:06:43.512Z"))).toBe("2026-08-19T09-06-43Z");

    const root = await applicationRoot();
    const at = new Date("2026-08-19T09:06:43.000Z");
    const first = await reserveWorkspacePath("followup", "designer", root, at);
    expect(basename(first)).toBe("2026-08-19T09-06-43Z-designer.followup.md");
    await writeFile(first, "", "utf8");
    const second = await reserveWorkspacePath("followup", "designer", root, at);
    expect(basename(second)).toBe("2026-08-19T09-06-43Z-designer-2.followup.md");
    expect(dirname(second)).toBe(resolve(root, workspaceDirectory));
  });

  test("reads the role back from a compiler-named file", () => {
    expect(workspaceFileRole("2026-08-19T09-06-43Z-designer.followup.md", "followup")).toBe(
      "designer",
    );
    expect(workspaceFileRole("2026-08-19T09-06-43Z-concept-worker-2.followup.md", "followup")).toBe(
      "concept-worker",
    );
    expect(workspaceFileRole("2026-08-19T09-06-43Z-critic.prompt.md", "prompt")).toBe("critic");
    expect(workspaceFileRole("repair.followup.md", "followup")).toBeUndefined();
    expect(
      workspaceFileRole("2026-08-19T09-06-43Z-designer.followup.md", "prompt"),
    ).toBeUndefined();
  });

  test("keeps generated files inside the workspace", async () => {
    const root = await applicationRoot();
    const inside = resolve(root, workspaceDirectory, "a.prompt.md");
    expect(requireInsideWorkspace(inside, root)).toBe(inside);
    expect(() => requireInsideWorkspace(resolve(root, "product/brief.md"), root)).toThrow(
      workspaceDirectory,
    );
  });
});

describe("launch records", () => {
  test("recognizes only well-formed records", () => {
    expect(isLaunchRecord(undefined)).toBe(false);
    expect(isLaunchRecord({ format: "other", version: 1 })).toBe(false);
    expect(
      isLaunchRecord({
        format: "sync-engine.skill.launch-record",
        version: 1,
        role: "designer",
        agentId: "a",
        provider: "p",
        model: "m",
        prompt: { path: "x", sha256: "y" },
      }),
    ).toBe(true);
  });

  test("refuses a record whose prompt no longer hashes to it", async () => {
    const root = await applicationRoot();
    const built = await record(root, "designer");
    expect((await verifiedRecords("designer", root)).length).toBe(1);

    await writeFile(built.prompt.path, "# changed\n", "utf8");
    expect((await verifiedRecords("designer", root)).length).toBe(0);
  });

  test("refuses a role that never settled, broke its contract, or read out of bounds", async () => {
    const unsettled = await applicationRoot();
    await record(unsettled, "designer", { status: "running" });
    expect((await verifiedRecords("designer", unsettled)).length).toBe(0);

    const rude = await applicationRoot();
    await record(rude, "designer", {
      response: { path: "r.md", sha256: "s", bytes: 4, contract: "violated" },
    });
    expect((await verifiedRecords("designer", rude)).length).toBe(0);

    const nosy = await applicationRoot();
    await record(nosy, "designer", {
      readViolations: ["node_modules/@mit-sdg/sync-engine/dist/x"],
    });
    expect((await verifiedRecords("designer", nosy)).length).toBe(0);
  });

  test("treats a dead role as finished but not settled", async () => {
    expect(finishedStatuses).toContain("idle");
    for (const dead of ["error", "failed", "closed"]) {
      expect(finishedStatuses).toContain(dead);
      const root = await applicationRoot();
      await record(root, "designer", { status: dead });
      expect((await verifiedRecords("designer", root)).length).toBe(0);
    }
  });

  test("keeps a resumed role countable and records the attempts", async () => {
    expect(finishedStatuses).toContain(resumableStatus);
    const root = await applicationRoot();
    await record(root, "designer", { resumes: 2 });
    expect((await verifiedRecords("designer", root)).length).toBe(1);
  });

  test("still counts a role whose harness hid its tool arguments", async () => {
    const root = await applicationRoot();
    await record(root, "designer", { readAudit: "unavailable" });
    expect((await verifiedRecords("designer", root)).length).toBe(1);
  });

  test("gates each role on the one before it", async () => {
    const root = await applicationRoot();
    await expect(requireCompletedRole("critic", root)).rejects.toThrow(
      "requires a settled designer launch",
    );
    await record(root, "designer");
    await expect(requireCompletedRole("critic", root)).resolves.toBeUndefined();
    await expect(requireCompletedRole("designer", root)).resolves.toBeUndefined();
  });

  test("stops counting a predecessor built against another design", async () => {
    const root = await applicationRoot();
    await record(root, "critic", { designDigest: "b".repeat(64) });
    await expect(
      requireCompletedRole("concept-worker", root, "b".repeat(64)),
    ).resolves.toBeUndefined();
    await expect(requireCompletedRole("concept-worker", root, "c".repeat(64))).rejects.toThrow(
      "Design reopened after that role ran",
    );
  });

  test("rejects a workspace holding an unreadable record", async () => {
    const root = await applicationRoot();
    await writeFile(
      resolve(root, workspaceDirectory, "2026-01-01T00-00-00Z-designer.launch.json"),
      "{",
      "utf8",
    );
    await expect(readLaunchRecords(root)).rejects.toThrow("not readable JSON");
  });
});
