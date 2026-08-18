import { describe, expect, test } from "vite-plus/test";
import {
  parseSpec,
  specificationsAreCompatible,
} from "@sync-engine/internal/reactions/concepts/concept-spec";

function specification(
  overrides: Partial<
    Record<"name" | "purpose" | "principle" | "types" | "state" | "actions" | "queries", string>
  > = {},
): string {
  const value = {
    name: "Inviting",
    purpose: "Let a member invite someone into a workspace.",
    principle: "Priya invites Sam; one pending invitation exists.",
    types:
      "external Person\n  A person who may receive an invitation.\n  Identity is supplied by the application.\n\nexternal Workspace",
    state:
      "a set of Invitations with\n  a workspace Workspace\n  a guest Person\n\nRule: Invitation identities are never reused.",
    actions: `invite(workspace: Workspace, guest: Person) : return (invitation: Invitation)
  where true
  then
    add a pending invitation
    return invitation

accept(invitation: Invitation) : return (invitation: Invitation, acceptedAt?: Time)
  where invitation is pending
  then
    mark invitation accepted
    return acceptedAt, invitation
  where invitation is not pending
  then
    refuse NO_LONGER_OPEN "This invitation is no longer open."`,
    queries: `_pending(workspace: Workspace) : many (invitation: Invitation, guest: Person)
  Returns pending invitations in creation order.
_get(invitation: Invitation) : optional (workspace: Workspace)`,
    ...overrides,
  };
  return `# ${value.name}

## Purpose

${value.purpose}

## Principle

${value.principle}

## Types

\`\`\`types
${value.types}
\`\`\`

## State

\`\`\`state
${value.state}
\`\`\`

## Actions

\`\`\`actions
${value.actions}
\`\`\`

## Queries

\`\`\`queries
${value.queries}
\`\`\`
`;
}

function validSpecification(markdown: string) {
  const parsed = parseSpec(markdown);
  expect(parsed.diagnostics).toEqual([]);
  return parsed.specification!;
}

function diagnosticsFor(markdown: string) {
  const parsed = parseSpec(markdown);
  expect(parsed.specification).toBeUndefined();
  return parsed.diagnostics;
}

function indentFences(markdown: string, spaces: number): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) inFence = !inFence;
      return inFence || line.startsWith("```") ? `${" ".repeat(spaces)}${line}` : line;
    })
    .join("\n");
}

describe("concept specification document structure", () => {
  test("retains the definition identity and requires the exact H1/H2 skeleton", () => {
    expect(validSpecification(specification()).definitionName).toBe("Inviting");
    expect(diagnosticsFor(specification().replace("# Inviting", "# Invitation concept"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
          message: expect.stringContaining("definition name"),
          location: { line: 1, column: 1 },
        }),
      ]),
    );
    expect(diagnosticsFor(specification().replace("## Principle", "## Unknown"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
          message: expect.stringContaining('unknown "## Unknown"'),
        }),
      ]),
    );
    expect(
      diagnosticsFor(
        specification()
          .replace("## Purpose", "## Principle")
          .replace("## Principle\n\nPriya", "## Purpose\n\nPriya"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must be ordered") }),
      ]),
    );
    expect(diagnosticsFor(`${specification()}\n# Again\n`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("more than one H1") }),
      ]),
    );
  });

  test("accumulates coded, positioned diagnostics from one concept", () => {
    const markdown = specification({
      purpose: "",
      principle: "",
      actions: "invite() : return ()",
    });
    const lines = markdown.split("\n");
    const lineOf = (text: string): number => {
      const index = lines.indexOf(text);
      if (index < 0) throw new Error(`Fixture does not contain ${JSON.stringify(text)}.`);
      return index + 1;
    };
    const diagnostics = diagnosticsFor(markdown);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "CONCEPT_SPEC_PROSE_SECTION",
        message: expect.stringContaining('"## Purpose" section is empty'),
        location: { line: lineOf("## Purpose"), column: 1 },
      }),
      expect.objectContaining({
        code: "CONCEPT_SPEC_PROSE_SECTION",
        message: expect.stringContaining('"## Principle" section is empty'),
        location: { line: lineOf("## Principle"), column: 1 },
      }),
      expect.objectContaining({
        code: "CONCEPT_SPEC_ACTION_BRANCH",
        message: expect.stringContaining("explicit where/then branch"),
        location: { line: lineOf("invite() : return ()"), column: 1 },
      }),
    ]);
  });

  test("rejects empty input with a located invalid-input diagnostic", () => {
    expect(diagnosticsFor("")).toEqual([
      expect.objectContaining({
        code: "CONCEPT_SPEC_INVALID_INPUT",
        message: expect.stringContaining("markdown text"),
        location: { line: 1, column: 1 },
      }),
    ]);
  });

  test("recognizes CommonMark structural fences indented by at most three spaces", () => {
    for (const indentation of [0, 1, 2, 3]) {
      expect(validSpecification(indentFences(specification(), indentation)).actions[0].name).toBe(
        "invite",
      );
    }
    expect(diagnosticsFor(indentFences(specification(), 4))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("must begin with a types fence"),
        }),
      ]),
    );
  });

  test("requires nonempty unfenced Purpose and Principle prose", () => {
    expect(diagnosticsFor(specification({ purpose: "" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('"## Purpose" section is empty'),
        }),
      ]),
    );
    expect(diagnosticsFor(specification({ principle: "" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('"## Principle" section is empty'),
        }),
      ]),
    );
    expect(
      diagnosticsFor(specification({ principle: "```text\nSupporting notation.\n```" })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            '"## Principle" section allows prose but no fenced blocks',
          ),
        }),
      ]),
    );
  });

  test("rejects subsection headings and application-only Markdown", () => {
    expect(
      diagnosticsFor(
        specification({ principle: "A scenario.\n\n### Additional details\n\nMore." }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("subsection headings are not allowed"),
        }),
      ]),
    );
    expect(
      diagnosticsFor(specification({ principle: "A [rule](reaction:Application.Rule) runs." })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_APPLICATION_CONSTRUCT",
          message: expect.stringContaining("application design links are not allowed"),
        }),
      ]),
    );
    expect(
      diagnosticsFor(
        specification({
          principle: "```computations\ncalculate() : Value\n  Does work.\n```",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_APPLICATION_CONSTRUCT",
          message: expect.stringContaining("computations fences are not allowed"),
        }),
      ]),
    );
  });
});

describe("Types and State", () => {
  test("parses only external types and retains optional indented explanations", () => {
    expect(validSpecification(specification()).externalTypes).toMatchObject([
      {
        name: "Person",
        explanation:
          "A person who may receive an invitation.\nIdentity is supplied by the application.",
      },
      { name: "Workspace", explanation: "" },
    ]);
    expect(validSpecification(specification({ types: "" })).externalTypes).toEqual([]);
    expect(diagnosticsFor(specification({ types: "external Person\nnot indented" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must be `external Name`") }),
      ]),
    );
    expect(diagnosticsFor(specification({ types: "concrete Person" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must be `external Name`") }),
      ]),
    );
    expect(diagnosticsFor(specification({ types: "external Person\nexternal Person" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_DUPLICATE_DECLARATION",
          message: expect.stringContaining('external type "Person" is declared twice'),
        }),
      ]),
    );
  });

  test("retains exact marked State text without a separate prose field", () => {
    const raw = "Rule: not structural State {]\nRule: spacing remains significant  ";
    const parsed = validSpecification(specification({ state: raw }));
    expect(parsed.state.body).toBe(raw);
    expect(Object.hasOwn(parsed.state, "prose")).toBe(false);
  });

  test("rejects prose after the State fence with a positioned diagnostic", () => {
    const prose = "A cross-row invariant.";
    const markdown = specification().replace(
      "\n```\n\n## Actions",
      `\n\`\`\`\n\n${prose}\n\n## Actions`,
    );
    const line = markdown.split("\n").findIndex((source) => source === prose) + 1;

    expect(diagnosticsFor(markdown)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONCEPT_SPEC_FENCE",
          message:
            "prose after the state fence is not allowed; move this text inside the fence as a `Rule:` line.",
          location: { line, column: 1 },
        }),
      ]),
    );
  });

  test("records the exact normalized State body origin after leading blank fence lines", () => {
    const markdown = specification({ state: "\n\na set of Invitations" });
    const expectedLine =
      markdown.split("\n").findIndex((line) => line === "a set of Invitations") + 1;
    expect(validSpecification(markdown).state.location).toEqual({ line: expectedLine, column: 1 });

    const indented = indentFences(markdown, 3);
    expect(validSpecification(indented).state.location).toEqual({ line: expectedLine, column: 4 });
  });

  test("allows no Markdown around strict Types, Actions, or Queries fences", () => {
    for (const section of ["Types", "Actions", "Queries"]) {
      const markdown = specification().replace(
        `## ${section}\n\n`,
        `## ${section}\n\nProse is forbidden.\n\n`,
      );
      expect(diagnosticsFor(markdown)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(
              `must begin with a ${section.toLowerCase() === "types" ? "types" : section.toLowerCase()} fence`,
            ),
          }),
        ]),
      );
    }
  });
});

describe("Actions", () => {
  test("requires at least one action with explicit branches and matching named returns", () => {
    const parsed = validSpecification(specification());
    expect(parsed.actions).toMatchObject([
      {
        name: "invite",
        inputs: ["workspace", "guest"],
        result: { kind: "fields", fields: [{ name: "invitation" }] },
      },
      {
        name: "accept",
        refusals: [{ code: "NO_LONGER_OPEN", message: "This invitation is no longer open." }],
      },
    ]);
    expect(diagnosticsFor(specification({ actions: "" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("at least one action") }),
      ]),
    );
    expect(diagnosticsFor(specification({ actions: "invite() : return ()" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("explicit where/then branch") }),
      ]),
    );
    expect(
      diagnosticsFor(specification({ actions: "invite() : return ()\n  then\n    return" })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("must begin with `where CONDITION`"),
        }),
      ]),
    );
  });

  test("rejects bare result types and nonterminal or incomplete outcomes", () => {
    expect(
      diagnosticsFor(
        specification({
          actions: "invite() : return Invitation\n  where true\n  then\n    return invitation",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("parenthesized named fields") }),
      ]),
    );
    expect(
      diagnosticsFor(
        specification({
          actions:
            "invite() : return (invitation: Invitation)\n  where true\n  then\n    return invitation\n    audit it",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must terminate") }),
      ]),
    );
    expect(
      diagnosticsFor(
        specification({
          actions: "invite() : return (invitation: Invitation)\n  where true\n  then\n    return",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("must return exactly invitation"),
        }),
      ]),
    );
  });

  test("empty successful results use a plain terminal return", () => {
    expect(
      validSpecification(
        specification({
          actions: "reset() : return ()\n  where true\n  then\n    clear everything\n    return",
        }),
      ).actions[0].result.fields,
    ).toEqual([]);
    expect(
      diagnosticsFor(
        specification({ actions: "reset() : return ()\n  where true\n  then\n    return value" }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must return exactly ()") }),
      ]),
    );
  });
});

describe("Queries and canonical compatibility", () => {
  test("allows empty Queries and arbitrary optional indented bodies", () => {
    expect(validSpecification(specification({ queries: "" })).queries).toEqual([]);
    expect(validSpecification(specification()).queries.map(({ body }) => body)).toEqual([
      "Returns pending invitations in creation order.",
      "",
    ]);
    expect(diagnosticsFor(specification({ queries: "_get() : optional Invitation" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("parenthesized named fields") }),
      ]),
    );
  });

  test("canonical compatibility ignores source locations but not authored contracts", () => {
    const compact = validSpecification(specification());
    const shifted = validSpecification(`\n\n${specification()}`);
    const changed = validSpecification(
      specification({ state: "Rule: a changed, still unparsed state notation" }),
    );
    expect(specificationsAreCompatible(compact, shifted)).toBe(true);
    expect(specificationsAreCompatible(compact, changed)).toBe(false);
  });
});
