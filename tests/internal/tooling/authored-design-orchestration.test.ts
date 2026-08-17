import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import {
  AuthoredDesignCheckError,
  checkAuthoredDesign,
} from "@engine/tooling/authored-design-orchestration";
import { validateApplicationManifest } from "@engine/tooling/application-manifest-format";
import { applicationManifest } from "@engine/tooling/manifest";

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

const Publish = endpoint("/publish", () => receive().then(respond()), { input: {} });

function application() {
  return assemble({ vocabulary: words, composition: { Forum: { Publish } } });
}

async function fixture(design: string, typesDesign?: string) {
  const directory = await mkdtemp(join(process.cwd(), ".authored-design-"));
  temporaryDirectories.push(directory);
  const designPath = join(directory, "forum.md");
  await writeFile(designPath, design);
  const typesPath = join(directory, "types.md");
  if (typesDesign !== undefined) await writeFile(typesPath, typesDesign);
  const conceptPath = join(directory, "Commenting.md");
  await writeFile(conceptPath, commentingSpec);
  return {
    documents: [
      pathToFileURL(designPath),
      ...(typesDesign === undefined ? [] : [pathToFileURL(typesPath)]),
    ],
    concept: pathToFileURL(conceptPath),
  };
}

const typesDesign = `# Application types

\`\`\`types
concrete Person
  An application identity.
\`\`\`

\`\`\`instances
instantiate Commenting as PostComments
instantiate Commenting as AnswerComments
\`\`\`

\`\`\`bindings
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
      typesDesign,
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
        conceptSources: ["PostComments", "AnswerComments"].map((instance) => ({
          instance,
          url: design.concept,
          content: commentingSpec,
        })),
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
          { instance: "AnswerComments", definition: "Commenting", externalTypes: ["User"] },
          { instance: "PostComments", definition: "Commenting", externalTypes: ["User"] },
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

      const manifest = applicationManifest(assembly, {
        checked,
        paths: { relativePath: (path) => basename(path) },
      });
      expect(() => validateApplicationManifest(manifest)).not.toThrow();
      expect(manifest.design).toMatchObject({
        checked: true,
        sources: expect.arrayContaining([
          expect.objectContaining({ kind: "concept", path: "Commenting.md" }),
        ]),
        concepts: [
          expect.objectContaining({
            definition: "Commenting",
            instances: [
              expect.objectContaining({
                name: "AnswerComments",
                declaration: expect.objectContaining({ line: 10 }),
                bindings: [
                  expect.objectContaining({
                    external: "User",
                    location: { source: "document-2", line: 15, column: 1 },
                  }),
                ],
              }),
              expect.objectContaining({
                name: "PostComments",
                declaration: expect.objectContaining({ line: 9 }),
              }),
            ],
          }),
        ],
        types: { concreteTypes: [expect.objectContaining({ name: "Person" })] },
        computations: [expect.objectContaining({ inputValidation: "validated" })],
      });
      expect((manifest.design.types as Record<string, unknown>).bindings).toBeUndefined();

      const oldBetaShape = structuredClone(manifest) as unknown as {
        design: { types: Record<string, unknown> };
      };
      oldBetaShape.design.types.bindings = [];
      expect(() => validateApplicationManifest(oldBetaShape)).toThrow("$.design.types.bindings");

      const missingDeclaration = structuredClone(manifest);
      delete (
        missingDeclaration.design.concepts[0].instances[0] as unknown as Record<string, unknown>
      ).declaration;
      expect(() => validateApplicationManifest(missingDeclaration)).toThrow(
        "$.design.concepts[0].instances[0].declaration",
      );

      const incomplete = structuredClone(manifest);
      incomplete.design.concepts[0].instances[0].bindings = [];
      expect(() => validateApplicationManifest(incomplete)).toThrow(/omits external parameter/);
    } finally {
      await assembly.beginDrain();
    }
  });

  test("rejects traced concept text that only differs in source placement", async () => {
    const design = await fixture("# Forum\n\n[Publish](reaction:Forum.Publish).\n", typesDesign);
    const assembly = application();
    try {
      const shifted = commentingSpec.replace("## Purpose", "\n## Purpose");
      await expect(
        checkAuthoredDesign({
          assembly,
          design,
          conceptSources: ["PostComments", "AnswerComments"].map((instance) => ({
            instance,
            url: design.concept,
            content: shifted,
          })),
        }),
      ).rejects.toThrow(
        'traced concept source for "AnswerComments" does not exactly match its registered spec text',
      );
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
      typesDesign,
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

  test("fails with deterministic aggregate coverage, shape, and type-binding diagnostics", async () => {
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
        "UNDECLARED_SELECTED_INSTANCE",
        "UNDECLARED_SELECTED_INSTANCE",
      ]);
      expect((failure as Error).message).toContain('selected reaction "Forum.Publish"');
      expect((failure as Error).message).toContain("5 issues");
    } finally {
      await assembly.beginDrain();
    }
  });

  test("needs no application type declaration when the assembly has no external types", async () => {
    const emptyWords = vocabulary({ concepts: {}, computations: {} });
    const Empty = endpoint("/empty", () => receive().then(respond()));
    const assembly = assemble({ vocabulary: emptyWords, composition: { Empty } });
    const design = await fixture("# Empty\n\n[Empty](reaction:Empty).\n");
    try {
      await expect(checkAuthoredDesign({ assembly, design })).resolves.toBeDefined();
    } finally {
      await assembly.beginDrain();
    }
  });
});
