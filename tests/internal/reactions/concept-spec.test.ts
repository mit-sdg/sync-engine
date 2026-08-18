import { describe, expect, test } from "vite-plus/test";
import {
  parseSpec,
  specificationsAreCompatible,
} from "@sync-engine/internal/reactions/concepts/concept-spec";

function specification(
  overrides: Partial<
    Record<
      "name" | "purpose" | "principle" | "types" | "state" | "stateProse" | "actions" | "queries",
      string
    >
  > = {},
): string {
  const value = {
    name: "Inviting",
    purpose: "Let a member invite someone into a workspace.",
    principle: "Priya invites Sam; one pending invitation exists.",
    types:
      "external Person\n  A person who may receive an invitation.\n  Identity is supplied by the application.\n\nexternal Workspace",
    state: "a set of Invitations\n  with a workspace and guest",
    stateProse: "Invitation identities are never reused.",
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
${value.stateProse === "" ? "" : `\n${value.stateProse}\n`}
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
    expect(parseSpec(specification()).definitionName).toBe("Inviting");
    expect(() => parseSpec(specification().replace("# Inviting", "# Invitation concept"))).toThrow(
      "definition name",
    );
    expect(() => parseSpec(specification().replace("## Principle", "## Unknown"))).toThrow(
      'unknown "## Unknown"',
    );
    expect(() =>
      parseSpec(
        specification()
          .replace("## Purpose", "## Principle")
          .replace("## Principle\n\nPriya", "## Purpose\n\nPriya"),
      ),
    ).toThrow("must be ordered");
    expect(() => parseSpec(`${specification()}\n# Again\n`)).toThrow("more than one H1");
  });

  test("recognizes CommonMark structural fences indented by at most three spaces", () => {
    for (const indentation of [0, 1, 2, 3]) {
      expect(parseSpec(indentFences(specification(), indentation)).actions[0].name).toBe("invite");
    }
    expect(() => parseSpec(indentFences(specification(), 4))).toThrow(
      "must begin with a types fence",
    );
  });

  test("requires nonempty unfenced Purpose and Principle prose", () => {
    expect(() => parseSpec(specification({ purpose: "" }))).toThrow(
      '"## Purpose" section is empty',
    );
    expect(() => parseSpec(specification({ principle: "" }))).toThrow(
      '"## Principle" section is empty',
    );
    expect(() =>
      parseSpec(specification({ principle: "```text\nSupporting notation.\n```" })),
    ).toThrow('"## Principle" section allows prose but no fenced blocks');
  });

  test("rejects subsection headings and application-only Markdown", () => {
    expect(() =>
      parseSpec(specification({ principle: "A scenario.\n\n### Additional details\n\nMore." })),
    ).toThrow("subsection headings are not allowed");
    expect(() =>
      parseSpec(specification({ principle: "A [rule](reaction:Application.Rule) runs." })),
    ).toThrow("application design links are not allowed");
    expect(() =>
      parseSpec(
        specification({
          principle: "```computations\ncalculate() : Value\n  Does work.\n```",
        }),
      ),
    ).toThrow("computations fences are not allowed");
  });
});

describe("Types and State", () => {
  test("parses only external types and retains optional indented explanations", () => {
    expect(parseSpec(specification()).externalTypes).toMatchObject([
      {
        name: "Person",
        explanation:
          "A person who may receive an invitation.\nIdentity is supplied by the application.",
      },
      { name: "Workspace", explanation: "" },
    ]);
    expect(parseSpec(specification({ types: "" })).externalTypes).toEqual([]);
    expect(() => parseSpec(specification({ types: "external Person\nnot indented" }))).toThrow(
      "must be `external Name`",
    );
    expect(() => parseSpec(specification({ types: "concrete Person" }))).toThrow(
      "must be `external Name`",
    );
    expect(() => parseSpec(specification({ types: "external Person\nexternal Person" }))).toThrow(
      'external type "Person" is declared twice',
    );
  });

  test("retains State without parsing SSF and separately retains following prose", () => {
    const raw = "not SSF yet {]\n  spacing remains significant  ";
    const parsed = parseSpec(specification({ state: raw, stateProse: "A cross-row invariant." }));
    expect(parsed.state).toMatchObject({ body: raw, prose: "A cross-row invariant." });
  });

  test("allows no Markdown around strict Types, Actions, or Queries fences", () => {
    for (const section of ["Types", "Actions", "Queries"]) {
      const markdown = specification().replace(
        `## ${section}\n\n`,
        `## ${section}\n\nProse is forbidden.\n\n`,
      );
      expect(() => parseSpec(markdown)).toThrow(
        `must begin with a ${section.toLowerCase() === "types" ? "types" : section.toLowerCase()} fence`,
      );
    }
  });
});

describe("Actions", () => {
  test("requires at least one action with explicit branches and matching named returns", () => {
    const parsed = parseSpec(specification());
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
    expect(() => parseSpec(specification({ actions: "" }))).toThrow("at least one action");
    expect(() => parseSpec(specification({ actions: "invite() : return ()" }))).toThrow(
      "explicit where/then branch",
    );
    expect(() =>
      parseSpec(specification({ actions: "invite() : return ()\n  then\n    return" })),
    ).toThrow("must begin with `where CONDITION`");
  });

  test("rejects bare result types and nonterminal or incomplete outcomes", () => {
    expect(() =>
      parseSpec(
        specification({
          actions: "invite() : return Invitation\n  where true\n  then\n    return invitation",
        }),
      ),
    ).toThrow("parenthesized named fields");
    expect(() =>
      parseSpec(
        specification({
          actions:
            "invite() : return (invitation: Invitation)\n  where true\n  then\n    return invitation\n    audit it",
        }),
      ),
    ).toThrow("must terminate");
    expect(() =>
      parseSpec(
        specification({
          actions: "invite() : return (invitation: Invitation)\n  where true\n  then\n    return",
        }),
      ),
    ).toThrow("must return exactly invitation");
  });

  test("empty successful results use a plain terminal return", () => {
    expect(
      parseSpec(
        specification({
          actions: "reset() : return ()\n  where true\n  then\n    clear everything\n    return",
        }),
      ).actions[0].result.fields,
    ).toEqual([]);
    expect(() =>
      parseSpec(
        specification({ actions: "reset() : return ()\n  where true\n  then\n    return value" }),
      ),
    ).toThrow("must return exactly ()");
  });
});

describe("Queries and canonical compatibility", () => {
  test("allows empty Queries and arbitrary optional indented bodies", () => {
    expect(parseSpec(specification({ queries: "" })).queries).toEqual([]);
    expect(parseSpec(specification()).queries.map(({ body }) => body)).toEqual([
      "Returns pending invitations in creation order.",
      "",
    ]);
    expect(() => parseSpec(specification({ queries: "_get() : optional Invitation" }))).toThrow(
      "parenthesized named fields",
    );
  });

  test("lets a many query promise stable row identity from required result fields", () => {
    const query = parseSpec(
      specification({
        queries:
          "_pending(workspace: Workspace) : many identified by (invitation) (invitation: Invitation, guest: Person)",
      }),
    ).queries[0];
    expect(query).toMatchObject({
      name: "_pending",
      promise: "many",
      identity: ["invitation"],
    });

    expect(() =>
      parseSpec(
        specification({
          queries:
            "_get(invitation: Invitation) : optional identified by (invitation) (invitation: Invitation)",
        }),
      ),
    ).toThrow("only a `many` query");
    expect(() =>
      parseSpec(
        specification({
          queries: "_pending() : many identified by (missing) (invitation: Invitation)",
        }),
      ),
    ).toThrow('identity field "missing" is not one of its result fields');
    expect(() =>
      parseSpec(
        specification({
          queries: "_pending() : many identified by (invitation) (invitation?: Invitation)",
        }),
      ),
    ).toThrow('identity field "invitation" cannot be optional');
  });

  test("canonical compatibility ignores source locations but not authored contracts", () => {
    const compact = parseSpec(specification());
    const shifted = parseSpec(`\n\n${specification()}`);
    const changed = parseSpec(specification({ state: "a changed, still unparsed state notation" }));
    expect(specificationsAreCompatible(compact, shifted)).toBe(true);
    expect(specificationsAreCompatible(compact, changed)).toBe(false);
  });
});
