import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  type LaunchRecord,
  isLaunchRecord,
  nextReviewPass,
  readLaunchRecords,
  requireCompletedRole,
  requireReviewPass,
  finishedStatuses,
  registrationWrappers,
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
  const criticResponse =
    role !== "critic" || overrides.response !== undefined
      ? undefined
      : overrides.mode === "map"
        ? "- ROW `design/decomposition.md` — Tasking — accept — one owner.\n" +
          "- PLACEMENT `N1` — accept — concept Tasking owns the lifecycle.\n"
        : "- CHECK `BRIEF` — Visible successes and refusals are traced.\n" +
          "- VERDICT — No material findings.\n";
  const responsePath =
    criticResponse === undefined ? undefined : await reserveWorkspacePath("response", role, root);
  if (responsePath !== undefined) await writeFile(responsePath, criticResponse!, "utf8");
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
    ...(responsePath === undefined
      ? {}
      : {
          response: {
            path: responsePath,
            sha256: createHash("sha256").update(criticResponse!).digest("hex"),
            bytes: Buffer.byteLength(criticResponse!),
            contract: "met" as const,
          },
        }),
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
  });

  test("stops counting a record when its captured response or launch ticket changes", async () => {
    const root = await applicationRoot();
    const responsePath = await reserveWorkspacePath("response", "designer", root);
    const response = "design/decomposition.md\n";
    await writeFile(responsePath, response);
    const ticketPath = await reserveWorkspacePath("ticket", "designer", root);
    const ticket = '{"format":"sync-engine.skill.launch-ticket"}\n';
    await writeFile(ticketPath, ticket);
    await record(root, "designer", {
      harness: "codex",
      attestation: "coordinator",
      status: "settled",
      launchTicket: {
        path: ticketPath,
        sha256: createHash("sha256").update(ticket).digest("hex"),
      },
      response: {
        path: responsePath,
        sha256: createHash("sha256").update(response).digest("hex"),
        bytes: Buffer.byteLength(response),
        contract: "met",
      },
    });
    expect((await verifiedRecords("designer", root)).length).toBe(1);

    await writeFile(responsePath, "changed\n");
    expect((await verifiedRecords("designer", root)).length).toBe(0);
    await writeFile(responsePath, response);
    await writeFile(ticketPath, "changed\n");
    expect((await verifiedRecords("designer", root)).length).toBe(0);
  });

  test("records a read outside the boundary without holding it against the role", async () => {
    const nosy = await applicationRoot();
    await record(nosy, "designer", {
      readViolations: ["node_modules/@mit-sdg/sync-engine/dist/x"],
    });
    expect((await verifiedRecords("designer", nosy)).length).toBe(1);
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

  test("gates each phase on the one before it", async () => {
    const root = await applicationRoot();
    await expect(requireCompletedRole("critic", root, undefined, "map")).rejects.toThrow(
      "requires a settled designer map launch",
    );
    await expect(
      requireCompletedRole("critic", root, undefined, "map", true),
    ).resolves.toBeUndefined();
    await record(root, "designer", { mode: "map" });
    await expect(requireCompletedRole("critic", root, undefined, "map")).resolves.toBeUndefined();
    await record(root, "critic", { mode: "map" });
    await expect(
      requireCompletedRole("designer", root, undefined, "contract"),
    ).resolves.toBeUndefined();
    await record(root, "designer", { mode: "contract" });
    await expect(
      requireCompletedRole("critic", root, undefined, "contract"),
    ).resolves.toBeUndefined();
  });

  test("enforces exactly two critic passes per brief", async () => {
    const root = await applicationRoot();
    const briefSha256 = "a".repeat(64);
    expect(await nextReviewPass("map", briefSha256, root)).toBe(1);
    await record(root, "critic", { mode: "map", briefSha256, reviewPass: 1 });
    expect(await nextReviewPass("map", briefSha256, root)).toBe(2);
    await expect(requireReviewPass("map", briefSha256, 1, root)).rejects.toThrow(
      "next allowed pass is 2",
    );
    await record(root, "critic", { mode: "map", briefSha256, reviewPass: 2 });
    await expect(nextReviewPass("map", briefSha256, root)).rejects.toThrow(
      "default ceiling of two",
    );
    expect(await nextReviewPass("map", briefSha256, root, true)).toBe(3);
  });

  test("does not treat map findings as map acceptance", async () => {
    const root = await applicationRoot();
    const responsePath = await reserveWorkspacePath("response", "critic", root);
    const response = "- ROW `design/decomposition.md` — Tasking — split — separate owners.\n";
    await writeFile(responsePath, response);
    await record(root, "critic", {
      mode: "map",
      response: {
        path: responsePath,
        sha256: createHash("sha256").update(response).digest("hex"),
        bytes: Buffer.byteLength(response),
        contract: "met",
      },
    });
    await expect(requireCompletedRole("designer", root, undefined, "contract")).rejects.toThrow(
      "requires accepted concept rows and need placements",
    );
    await expect(
      requireCompletedRole("designer", root, undefined, "contract", true),
    ).resolves.toBeUndefined();
  });

  test("requires two contract passes before carrying nonblockers", async () => {
    const root = await applicationRoot();
    const response = "- `MATERIAL-NONBLOCKER` — `design/types.md` — Clarify an optional label.\n";
    for (let pass = 1; pass <= 2; pass += 1) {
      const responsePath = await reserveWorkspacePath("response", "critic", root);
      await writeFile(responsePath, response);
      await record(root, "critic", {
        mode: "contract",
        designDigest: "b".repeat(64),
        response: {
          path: responsePath,
          sha256: createHash("sha256").update(response).digest("hex"),
          bytes: Buffer.byteLength(response),
          contract: "met",
        },
      });
      const check = requireCompletedRole("concept-worker", root, "b".repeat(64));
      if (pass === 1) await expect(check).rejects.toThrow("requires a clean contract review");
      else await expect(check).resolves.toBeUndefined();
    }
  });

  test("stops counting a predecessor built against another design", async () => {
    const root = await applicationRoot();
    await record(root, "critic", { mode: "contract", designDigest: "b".repeat(64) });
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

describe("registrationWrappers", () => {
  test("accepts a registry that registers the imported concept class", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wrappers-")));
    await mkdir(join(root, "src/concepts"), { recursive: true });
    await writeFile(
      join(root, "src/concepts/Posting.registry.ts"),
      'import { PostingConcept } from "./Posting.ts";\n' +
        "export const posting = registerConcept({ class: PostingConcept, spec });\n",
      "utf8",
    );
    expect(await registrationWrappers(root)).toEqual([]);
  });

  test("reports a delegating class declared beside the registration", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wrappers-")));
    await mkdir(join(root, "src/concepts"), { recursive: true });
    await writeFile(
      join(root, "src/concepts/Authorizing.registry.ts"),
      'import { Authorizing } from "./Authorizing.ts";\n' +
        "class AuthorizingInstance {\n  private readonly inner: Authorizing;\n}\n" +
        "export const authorizing = registerConcept({ class: AuthorizingInstance, spec });\n",
      "utf8",
    );
    expect(await registrationWrappers(root)).toEqual([
      "src/concepts/Authorizing.registry.ts registers AuthorizingInstance declared beside it",
    ]);
  });

  test("stays quiet when an application has no concepts directory", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wrappers-")));
    expect(await registrationWrappers(root)).toEqual([]);
  });
});
