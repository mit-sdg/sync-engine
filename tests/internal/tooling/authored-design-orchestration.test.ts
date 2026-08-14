import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/language";
import {
  AuthoredDesignCheckError,
  checkAuthoredDesign,
} from "@engine/tooling/authored-design-orchestration";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

const commentingSpec = `# Commenting

## Purpose
Keep comments.

## Principle
Comments remain attributable.

## Types
\`\`\`types
external User
  The author.
\`\`\`

## State
\`\`\`state
comments: set Comment
\`\`\`

## Actions
\`\`\`actions
add(user: User) : return ()
  where true
  then
    return
\`\`\`

## Queries
\`\`\`queries
\`\`\`
`;

class Commenting {
  add({ user }: { user: string }) {
    return { user };
  }
}

const words = vocabulary({
  concepts: {
    PostComments: { class: Commenting, spec: commentingSpec },
    AnswerComments: { class: Commenting, spec: commentingSpec },
  },
  computations: {
    normalize: ({ value }: { value?: string }) => value?.trim() ?? "",
  },
});

const Publish = endpoint("/publish", () => receive().then(respond()));

function application() {
  return assemble({ vocabulary: words, composition: { Forum: { Publish } } });
}

async function fixture(design: string, vocabularyDesign?: string) {
  const directory = await mkdtemp(join(process.cwd(), ".authored-design-"));
  temporaryDirectories.push(directory);
  const designPath = join(directory, "forum.md");
  await writeFile(designPath, design);
  const vocabularyPath = join(directory, "vocabulary.md");
  if (vocabularyDesign !== undefined) await writeFile(vocabularyPath, vocabularyDesign);
  return {
    documents: [pathToFileURL(designPath)],
    ...(vocabularyDesign === undefined ? {} : { vocabulary: pathToFileURL(vocabularyPath) }),
  };
}

const vocabularyDesign = `# Vocabulary

\`\`\`types
concrete Person
  An application identity.

PostComments.User is Person
AnswerComments.User is Person
\`\`\`
`;

describe("authored design orchestration", () => {
  test("loads normalized sources and derives one exact checked assembly model", async () => {
    const design = await fixture(
      "\uFEFF# Forum\r\n\r\n" +
        "Publishing is [handled](reaction:Forum.Publish). A second [citation](reaction:Forum.Publish).\r\n\r\n" +
        "```computations\r\n" +
        "normalize(value?: String) : String\r\n" +
        "  Normalizes display text.\r\n" +
        "```\r\n",
      vocabularyDesign,
    );
    const assembly = application();
    try {
      const checked = await checkAuthoredDesign({
        assembly,
        design,
        resolveComputationInputs: ({ computations }) => {
          expect(computations).toEqual([{ name: "normalize" }]);
          return [{ name: "normalize", inputs: [{ name: "value", optional: true }] }];
        },
      });

      expect(checked.sources.documents[0]).toMatchObject({
        path: expect.stringMatching(/forum\.md$/),
        content: expect.stringMatching(/^# Forum\n/),
        digest: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
      });
      expect(checked.sources.documents[0].lines[2]).toEqual({
        number: 3,
        text: "Publishing is [handled](reaction:Forum.Publish). A second [citation](reaction:Forum.Publish).",
      });
      expect(checked.selected).toMatchObject({
        reactions: ["Forum.Publish"],
        views: [],
        formers: [],
        computations: [{ name: "normalize", inputs: [{ name: "value", optional: true }] }],
        concepts: [
          { instance: "AnswerComments", externalTypes: ["User"] },
          { instance: "PostComments", externalTypes: ["User"] },
        ],
      });
      expect(checked.sharedDefinitions).toEqual([
        expect.objectContaining({
          definition: "Commenting",
          instances: ["AnswerComments", "PostComments"],
          canonicallyEqual: true,
          specificationDigest: expect.stringMatching(/^fnv1a64-/),
        }),
      ]);
      expect(checked.coverage.find(({ kind }) => kind === "reaction")).toMatchObject({
        identity: "Forum.Publish",
        locations: [
          expect.objectContaining({ line: 3, column: 15 }),
          expect.objectContaining({ line: 3, column: 59 }),
        ],
      });
      expect(checked.computationInputValidation).toEqual([
        { name: "normalize", status: "validated" },
      ]);
    } finally {
      await assembly.beginDrain();
    }
  });

  test("does not infer computation optionality from runtime reflection", async () => {
    const design = await fixture(
      `# Forum

[Publish](reaction:Forum.Publish).

\`\`\`computations
normalize(value: String) : String
  Normalizes display text.
\`\`\`
`,
      vocabularyDesign,
    );
    const assembly = application();
    try {
      const checked = await checkAuthoredDesign({ assembly, design });
      expect(checked.selected.computations).toEqual([{ name: "normalize" }]);
      expect(checked.computationInputValidation).toEqual([
        { name: "normalize", status: "not-claimed" },
      ]);
    } finally {
      await assembly.beginDrain();
    }
  });

  test("fails with deterministic aggregate coverage, shape, and vocabulary diagnostics", async () => {
    const design = await fixture(
      `# Forum

[Wrong](reaction:Forum.Wrong).

\`\`\`computations
normalize(value: String) : String
  Normalizes display text.
\`\`\`
`,
    );
    const assembly = application();
    try {
      const failure = await checkAuthoredDesign({
        assembly,
        design,
        resolveComputationInputs: () => [
          { name: "normalize", inputs: [{ name: "value", optional: true }] },
        ],
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AuthoredDesignCheckError);
      expect((failure as AuthoredDesignCheckError).issues.map(({ code }) => code)).toEqual([
        "UNRESOLVED_LINK",
        "COMPUTATION_INPUT_MISMATCH",
        "MISSING_COVERAGE",
        "MISSING_VOCABULARY",
      ]);
      expect((failure as Error).message).toContain('selected reaction "Forum.Publish"');
      expect((failure as Error).message).toContain("4 issues");
    } finally {
      await assembly.beginDrain();
    }
  });

  test("rejects a semantically unnecessary vocabulary after inspecting the assembly", async () => {
    const emptyWords = vocabulary({ concepts: {}, computations: {} });
    const Empty = endpoint("/empty", () => receive().then(respond()));
    const assembly = assemble({ vocabulary: emptyWords, composition: { Empty } });
    const design = await fixture(
      "# Empty\n\n[Empty](reaction:Empty).\n",
      "# Empty vocabulary\n\n```types\n```\n",
    );
    try {
      await expect(checkAuthoredDesign({ assembly, design })).rejects.toThrow(
        "UNNECESSARY_VOCABULARY",
      );
    } finally {
      await assembly.beginDrain();
    }
  });
});
