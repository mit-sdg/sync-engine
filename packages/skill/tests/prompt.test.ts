import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import {
  buildPrompt,
  PromptBuildError,
  type BuildPromptOptions,
} from "../skills/sync-engine/scripts/prompt.ts";
import {
  promptContext,
  promptSections,
  rejectedValue,
  retainedContext,
  sectionRecord,
} from "./test-support.ts";

const promptRoot = fileURLToPath(new URL("./fixtures/prompts", import.meta.url));
const actualPromptRoot = fileURLToPath(new URL("../skills/sync-engine/prompts", import.meta.url));
const expectedRoot = fileURLToPath(new URL("./fixtures/expected", import.meta.url));
const applicationRoot = "/application";
const expectedForPlatform = (content: string): string =>
  content.replaceAll(/"\/application[^"]*"/g, (quotedPath) =>
    JSON.stringify(resolve(quotedPath.slice(1, -1))),
  );
const fixtureInput = (name: string): string => resolve(promptRoot, "inputs", name);
const inlineSource = (displayName: string, content: string): string =>
  `**${displayName}**\n\n${content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd()}`;

const designerGrant = {
  readableAreas: [
    { area: "design", path: "concepts/messages.md" },
    { area: "work-unit", path: "." },
  ],
  writableAreas: [{ area: "current-decomposition", path: "decomposition.md" }],
  toolKinds: ["repository-write", "repository-read"],
  projectShell: "none",
  network: false,
  generatedOutput: false,
  longRunningProcesses: false,
} as const;

const readApplicationGrant = {
  readableAreas: [{ area: "application", path: "." }],
  writableAreas: [],
  toolKinds: ["repository-read"],
  projectShell: "none",
  network: false,
  generatedOutput: false,
  longRunningProcesses: false,
} as const;

const fencedHeadings = [
  "```markdown",
  "# Tasking",
  "",
  "## Purpose",
  "A complete heading example.",
  "```",
].join("\n");

const conceptContract = [
  "# Tasking",
  "",
  "## Purpose",
  "Manage a person's tasks.",
  "",
  "## Principle",
  "Each task follows one explicit lifecycle.",
  "",
  "## Types",
  "```types",
  "external Person",
  "```",
  "",
  "## State",
  "```state",
  "Task: set",
  "  owner: Person",
  "  title: String",
  "```",
  "",
  "## Actions",
  "```actions",
  "create (owner: Person, title: String) : return (task: Task)",
  "  where true",
  "  then",
  "    create a Task with owner, title as task",
  "    return task",
  "```",
  "",
  "## Queries",
  "```queries",
  "_tasks (owner: Person) : many (task: Task, title: String)",
  "  answers the owner's tasks with their titles",
  "  answers no rows when the owner has none",
  "  orders rows by Task identity",
  "```",
].join("\n");

function designerOptions(overrides: Partial<BuildPromptOptions> = {}): BuildPromptOptions {
  return {
    role: "designer",
    phase: "decomposition",
    workUnit: "message-board-search",
    applicationRoot,
    promptRoot,
    grant: designerGrant,
    inputs: [
      { id: "brief", path: fixtureInput("brief.md") },
      { id: "task", path: fixtureInput("task.md") },
    ],
    ...overrides,
  };
}

describe("deterministic prompt rendering", () => {
  test("renders the five sections in order and preserves plain Markdown literally", async () => {
    const options = designerOptions({
      inputs: [
        { id: "affected-design", path: fixtureInput("z-design.md") },
        { id: "brief", path: fixtureInput("brief.md") },
        {
          id: "current-decomposition",
          displayName: "candidate.md",
          content: "Literal <!-- bind: old-context --> text.\r\n",
        },
        { id: "task", path: fixtureInput("task.md") },
        { id: "affected-design", path: fixtureInput("a-design.md") },
      ],
    });

    const first = await buildPrompt(options);
    const second = await buildPrompt(options);

    const expected = await readFile(
      resolve(expectedRoot, "designer-decomposition.prompt.md"),
      "utf8",
    );
    expect(Buffer.from(first.content)).toEqual(Buffer.from(expectedForPlatform(expected)));
    expect(promptSections(first.content).map(({ heading }) => heading)).toEqual([
      "Role and objective",
      "Capabilities",
      "Guidance",
      "Context",
      "Return shape",
    ]);

    expect(second.content).toBe(first.content);
    expect(second.sha256).toBe(first.sha256);
    expect(first.sha256).toBe(createHash("sha256").update(first.content).digest("hex"));
    expect(first.bytes).toBe(Buffer.byteLength(first.content, "utf8"));
  });

  test("builds complete contract assignments without an accepted decomposition", async () => {
    await buildPrompt({
      role: "designer",
      phase: "contracts",
      workUnit: "contract-repair",
      applicationRoot,
      promptRoot: actualPromptRoot,
      grant: {
        readableAreas: [
          { area: "work-unit", path: "." },
          { area: "design", path: "." },
        ],
        writableAreas: [{ area: "assigned-design", path: "concepts/Tasking.md" }],
        toolKinds: ["repository-read", "repository-write"],
        projectShell: "project-validation",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      },
      inputs: [
        { id: "task", displayName: "task.md", content: "Repair the complete affected set." },
        { id: "brief", displayName: "brief.md", content: "Preserve approved boundaries." },
        {
          id: "affected-contracts",
          displayName: "Tasking.md",
          content: conceptContract,
        },
      ],
    });

    await buildPrompt({
      role: "critic",
      phase: "contracts",
      workUnit: "contract-repair",
      applicationRoot,
      promptRoot: actualPromptRoot,
      grant: {
        readableAreas: [
          { area: "work-unit", path: "." },
          { area: "design", path: "." },
        ],
        writableAreas: [],
        toolKinds: ["repository-read"],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      },
      inputs: [
        { id: "task", displayName: "review.md", content: "Review the complete changed set." },
        { id: "brief", displayName: "brief.md", content: "Preserve approved boundaries." },
        { id: "changed-contracts", displayName: "Tasking.md", content: conceptContract },
      ],
    });
  });

  test("preserves fenced headings and a complete concept contract byte-for-byte", async () => {
    const result = await buildPrompt({
      role: "concept-worker",
      phase: "implementation",
      workUnit: "tasking",
      applicationRoot,
      promptRoot,
      grant: readApplicationGrant,
      inputs: [
        { id: "task", displayName: "task.md", content: "Implement Tasking." },
        { id: "brief", displayName: "brief.md", content: "Tasking is in scope." },
        { id: "specifications", displayName: "Tasking.md", content: conceptContract },
        { id: "public-references", displayName: "authored-format.md", content: fencedHeadings },
        { id: "starting-paths", displayName: "paths.md", content: "src/concepts/tasking" },
      ],
    });

    expect(
      promptContext(result.content, [
        "Task",
        "Brief",
        "Concept specifications",
        "Additional public framework references",
        "Examples",
        "Exact starting paths",
      ]),
    ).toEqual({
      Task: inlineSource("task.md", "Implement Tasking."),
      Brief: inlineSource("brief.md", "Tasking is in scope."),
      "Concept specifications": inlineSource("Tasking.md", conceptContract),
      "Additional public framework references": inlineSource("authored-format.md", fencedHeadings),
      "Exact starting paths": inlineSource("paths.md", "src/concepts/tasking"),
    });
    expect(sectionRecord(promptSections(result.content)).Capabilities).toBe(
      expectedForPlatform(
        await readFile(resolve(expectedRoot, "read-application.capabilities.md"), "utf8"),
      ).trimEnd(),
    );
    expect(result.sources.find(({ inputId }) => inputId === "specifications")?.promptBytes).toBe(
      Buffer.byteLength(conceptContract),
    );
  });

  test("reports every source contribution in stable render order", async () => {
    const result = await buildPrompt(
      designerOptions({
        inputs: [
          { id: "affected-design", path: fixtureInput("z-design.md") },
          { id: "task", path: fixtureInput("task.md") },
          { id: "affected-design", path: fixtureInput("a-design.md") },
          { id: "brief", path: fixtureInput("brief.md") },
        ],
      }),
    );

    expect(result.sources.map(({ kind, displayName }) => [kind, displayName])).toEqual([
      ["role-template", "roles/designer-decomposition.md"],
      ["guidance", "guidance/catalog.md"],
      ["guidance", "guidance/design/decomposition.md"],
      ["input", "task.md"],
      ["input", "brief.md"],
      ["input", "a-design.md"],
      ["input", "z-design.md"],
    ]);
    expect(
      result.sources.filter(({ kind }) => kind === "input").map(({ inputId }) => inputId),
    ).toEqual(["task", "brief", "affected-design", "affected-design"]);
    for (const source of result.sources) {
      expect(source.sourceBytes).toBeGreaterThan(0);
      expect(source.promptBytes).toBeGreaterThan(0);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("binds only proven retained bytes and expands them for a replacement", async () => {
    const inputs = [
      { id: "task", path: fixtureInput("task.md") },
      { id: "brief", path: fixtureInput("brief.md") },
      { id: "affected-design", path: fixtureInput("a-design.md") },
    ] as const;
    const fresh = await buildPrompt(designerOptions({ inputs }));
    expect(fresh.retainedSources.map(({ inputId }) => inputId)).toEqual([
      "brief",
      "affected-design",
    ]);

    const continuation = await buildPrompt(
      designerOptions({
        contextDelivery: "continuation",
        knownRetained: fresh.retainedSources,
        inputs,
      }),
    );
    const retainedBrief = continuation.retainedSources.find(({ inputId }) => inputId === "brief");
    const retainedDesign = continuation.retainedSources.find(
      ({ inputId }) => inputId === "affected-design",
    );
    if (retainedBrief === undefined || retainedDesign === undefined) {
      throw new Error("Continuation omitted retained fixture sources");
    }
    expect(
      promptContext(continuation.content, [
        "Task",
        "Brief",
        "Current decomposition",
        "Affected existing design",
      ]),
    ).toEqual({
      Task: inlineSource("task.md", await readFile(fixtureInput("task.md"), "utf8")),
      Brief: retainedContext(
        "brief.md",
        retainedBrief.sha256,
        continuation.sources.find(({ inputId }) => inputId === "brief")!.sourceBytes,
      ),
      "Affected existing design": retainedContext(
        "a-design.md",
        retainedDesign.sha256,
        Buffer.byteLength(await readFile(fixtureInput("a-design.md"))),
      ),
    });
    expect(
      continuation.sources.filter(({ delivery }) => delivery === "retained-binding"),
    ).toHaveLength(2);

    const replacement = await buildPrompt(
      designerOptions({
        contextDelivery: "replacement",
        knownRetained: fresh.retainedSources,
        inputs,
      }),
    );
    expect(
      promptContext(replacement.content, [
        "Task",
        "Brief",
        "Current decomposition",
        "Affected existing design",
      ]),
    ).toEqual({
      Task: inlineSource("task.md", await readFile(fixtureInput("task.md"), "utf8")),
      Brief: inlineSource("brief.md", await readFile(fixtureInput("brief.md"), "utf8")),
      "Affected existing design": inlineSource(
        "a-design.md",
        await readFile(fixtureInput("a-design.md"), "utf8"),
      ),
    });
    expect(
      replacement.sources.filter(({ delivery }) => delivery === "replacement-expansion"),
    ).toHaveLength(2);
  });

  test("renders same-phase continuation as a compact delta", async () => {
    const inputs = [
      { id: "task", path: fixtureInput("task.md") },
      { id: "brief", path: fixtureInput("brief.md") },
      { id: "affected-design", path: fixtureInput("a-design.md") },
    ] as const;
    const fresh = await buildPrompt(designerOptions({ inputs }));
    const delta = await buildPrompt(
      designerOptions({
        contextDelivery: "delta",
        knownRetained: fresh.retainedSources,
        inputs,
      }),
    );

    expect(delta.bytes).toBeLessThan(fresh.bytes / 2);
    expect(sectionRecord(promptSections(delta.content))).toMatchObject({
      "Role and objective": expect.stringContaining("prior same-phase role contract"),
      Capabilities: expect.stringContaining("Current effective grant:"),
      Guidance: expect.stringContaining("Unchanged from the prior same-agent context"),
      "Return shape": expect.stringContaining("`## Status`, `## Changed`, `## Questions`"),
    });
    expect(
      delta.sources
        .filter(({ kind, delivery }) => kind !== "input" && delivery === "retained-binding")
        .map(({ kind }) => kind),
    ).toEqual(["role-template", "guidance", "guidance"]);
    expect(delta.sources.find(({ inputId }) => inputId === "brief")?.delivery).toBe(
      "retained-binding",
    );
  });

  test("inlines retained input when the display is known but its bytes changed", async () => {
    const fresh = await buildPrompt(designerOptions());
    const changedBrief = "# Brief fixture\n\nChanged bytes must be sent.";
    const continuation = await buildPrompt(
      designerOptions({
        contextDelivery: "continuation",
        knownRetained: fresh.retainedSources,
        inputs: [
          { id: "task", path: fixtureInput("task.md") },
          { id: "brief", displayName: "brief.md", content: changedBrief },
        ],
      }),
    );

    expect(
      promptContext(continuation.content, [
        "Task",
        "Brief",
        "Current decomposition",
        "Affected existing design",
      ]).Brief,
    ).toBe(inlineSource("brief.md", changedBrief));
    expect(continuation.sources.find(({ inputId }) => inputId === "brief")?.delivery).toBe(
      "inline",
    );
    expect(continuation.retainedSources[0]?.sha256).not.toBe(fresh.retainedSources[0]?.sha256);
  });

  test("inlines a cross-phase retained slot not present in known context", async () => {
    const brief = "# Brief\n\nCritique this bounded change.";
    const review = "# Review context\n\nUse this exact bounded rubric.";
    const initial = await buildPrompt({
      role: "critic",
      phase: "decomposition",
      workUnit: "tasking",
      applicationRoot,
      promptRoot,
      grant: { ...readApplicationGrant, readableAreas: [] },
      inputs: [
        { id: "task", displayName: "review-task.md", content: "Review the map." },
        { id: "brief", displayName: "brief.md", content: brief },
        {
          id: "candidate-decomposition",
          displayName: "decomposition.md",
          content: "# Decomposition\n\nCandidate map.",
        },
        { id: "affected-design", displayName: "review.md", content: review },
      ],
    });

    const verification = await buildPrompt({
      role: "critic",
      phase: "verification",
      workUnit: "tasking",
      applicationRoot,
      promptRoot,
      grant: { ...readApplicationGrant, readableAreas: [] },
      contextDelivery: "continuation",
      knownRetained: initial.retainedSources,
      inputs: [
        { id: "task", displayName: "verify-task.md", content: "Verify F-1." },
        { id: "brief", displayName: "brief.md", content: brief },
        { id: "original-findings", displayName: "findings.md", content: "F-1" },
        { id: "revised-candidate", displayName: "revision.md", content: "# Revision\n\nFixed." },
        { id: "review-guidance", displayName: "review.md", content: review },
      ],
    });

    const retainedBrief = verification.retainedSources.find(({ inputId }) => inputId === "brief");
    if (retainedBrief === undefined) throw new Error("Verification omitted retained brief");
    expect(
      promptContext(verification.content, [
        "Verification task",
        "Brief",
        "Original finding or routed blocker IDs",
        "Revised candidate context",
        "Retained affected design",
        "Retained review guidance",
      ]),
    ).toEqual({
      "Verification task": inlineSource("verify-task.md", "Verify F-1."),
      Brief: retainedContext("brief.md", retainedBrief.sha256, Buffer.byteLength(`${brief}\n`)),
      "Original finding or routed blocker IDs": inlineSource("findings.md", "F-1"),
      "Revised candidate context": inlineSource("revision.md", "# Revision\n\nFixed."),
      "Retained review guidance": inlineSource("review.md", review),
    });
    expect(verification.sources.find(({ inputId }) => inputId === "brief")?.delivery).toBe(
      "retained-binding",
    );
    expect(
      verification.sources.find(({ inputId }) => inputId === "review-guidance")?.delivery,
    ).toBe("inline");
  });

  test("has no role byte ceiling and enforces only a supplied real context limit", async () => {
    const large = "x".repeat(70 * 1024);
    const options = designerOptions({
      inputs: [
        { id: "task", path: fixtureInput("task.md") },
        { id: "brief", path: fixtureInput("brief.md") },
        { id: "affected-design", displayName: "large-context.md", content: large },
      ],
    });
    const unconstrained = await buildPrompt(options);
    expect(unconstrained.bytes).toBeGreaterThan(70 * 1024);

    const exactlyFits = await buildPrompt({
      ...options,
      contextLimitBytes: unconstrained.bytes,
    });
    expect(exactlyFits.bytes).toBe(unconstrained.bytes);

    await expect(
      buildPrompt({ ...options, contextLimitBytes: unconstrained.bytes - 1 }),
    ).rejects.toMatchObject({
      name: "PromptBuildError",
      code: "context-limit-overflow",
    });
  });
});

describe("prompt build errors", () => {
  test("rejects only an unknown role/phase specification before reading sources", async () => {
    expect(
      await rejectedValue(
        buildPrompt({ ...designerOptions(), phase: "accepted", promptRoot: "missing-root" }),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "unknown-specification",
      message:
        "Error: Unknown role specification designer/accepted; expected designer/decomposition, designer/contracts, critic/decomposition, critic/contracts, critic/verification, concept-worker/implementation, application-worker/implementation, frontend-worker/implementation, evidence-worker/evidence",
    });
  });

  test("reports missing required and unreadable inputs distinctly", async () => {
    expect(await rejectedValue(buildPrompt(designerOptions({ inputs: [] })))).toEqual({
      name: "PromptBuildError",
      code: "missing-required-input",
      message: "Missing required input task for designer/decomposition",
    });

    expect(
      await rejectedValue(
        buildPrompt(
          designerOptions({
            inputs: [
              { id: "task", path: fixtureInput("task.md") },
              { id: "brief", path: fixtureInput("does-not-exist.md") },
            ],
          }),
        ),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "unreadable-input",
      message: "Cannot read input brief does-not-exist.md",
    });
  });

  test("rejects duplicate and unsafe input identities without interpreting content", async () => {
    expect(
      await rejectedValue(
        buildPrompt(
          designerOptions({
            inputs: [
              { id: "task", path: fixtureInput("task.md") },
              { id: "brief", path: fixtureInput("task.md") },
            ],
          }),
        ),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "duplicate-input",
      message: "Duplicate input display name: task.md",
    });

    expect(
      await rejectedValue(
        buildPrompt(
          designerOptions({
            inputs: [
              { id: "task", path: fixtureInput("task.md") },
              { id: "brief", displayName: "unsafe`name.md", content: "Brief" },
            ],
          }),
        ),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "unsafe-input",
      message: "Unsafe display name: unsafe`name.md",
    });

    expect(
      await rejectedValue(
        buildPrompt(
          designerOptions({
            inputs: [
              { id: "task", path: fixtureInput("task.md") },
              { id: "brief", path: fixtureInput("brief.md") },
              { id: "acceptance", displayName: "acceptance.md", content: "Accepted" },
            ],
          }),
        ),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "unsafe-input",
      message: "designer/decomposition does not accept input acceptance",
    });
  });

  test("wraps an effective grant that exceeds the role maximum", async () => {
    expect(
      await rejectedValue(
        buildPrompt(
          designerOptions({
            grant: { ...designerGrant, network: true },
          }),
        ),
      ),
    ).toEqual({
      name: "PromptBuildError",
      code: "invalid-grant",
      message:
        "Error: Invalid capability grant for designer/decomposition: network exceeds the role maximum",
    });
  });

  test("does not require predecessor records or review acceptance", async () => {
    const result = await buildPrompt(designerOptions());
    expect(result).not.toBeInstanceOf(PromptBuildError);
    expect(result.specification.id).toBe("designer/decomposition");
  });
});
