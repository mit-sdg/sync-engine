/**
 * The parser extracts only the machine-readable registration contract: purpose,
 * principle, actions and refusal branches, and query promises. State notation
 * remains outside that value.
 */
import { describe, expect, test } from "vite-plus/test";
import { parseSpec } from "@sync-engine/internal/reactions/concepts/concept-spec";

const SPEC = `# Inviting

## Purpose

Let a member invite someone into a shared workspace.

## Principle

Priya invites Sam; a pending invitation now exists.
Sam accepts it, and it becomes accepted.

## State

\`\`\`state
a set of Invitations
\`\`\`

## Actions

\`\`\`actions
invite (workspace: Workspace, guest: Person) : return (invitation: Invitation)
  then
    add a new invitation with workspace and guest
    return invitation

accept (invitation: Invitation) : return (invitation: Invitation)
  where invitation not in pending
  then
    refuse NO_LONGER_OPEN "This invitation is no longer open."
  where invitation in pending
  then
    move invitation to accepted
    return invitation
\`\`\`

## Queries

\`\`\`queries
_pending (workspace: Workspace) : many (invitation: Invitation, guest: Person)
_get (invitation: Invitation) : optional (workspace: Workspace)
\`\`\`
`;

const prose = (body: string): string =>
  `# X\n\n## Purpose\n\nWhy.\n\n## Principle\n\nHow.\n${body}`;
const actions = (body: string): string => prose(`\n## Actions\n\n\`\`\`actions\n${body}\n\`\`\`\n`);
const queries = (body: string): string => prose(`\n## Queries\n\n\`\`\`queries\n${body}\n\`\`\`\n`);
const registrationData = (markdown: string) => {
  const spec = parseSpec(markdown);
  return {
    purpose: spec.purpose,
    principle: spec.principle,
    actions: spec.actions.map(({ name, inputs, refusals }) => ({
      name,
      inputs,
      refusals: refusals.map(({ code, message }) => ({ code, message })),
    })),
    queries: spec.queries.map(({ name, inputs, promise }) => ({ name, inputs, promise })),
  };
};

describe("the specification's prose", () => {
  test("extracts purpose and principle, whole", () => {
    const spec = parseSpec(SPEC);
    expect(spec.purpose).toBe("Let a member invite someone into a shared workspace.");
    expect(spec.principle).toBe(
      "Priya invites Sam; a pending invitation now exists.\nSam accepts it, and it becomes accepted.",
    );
  });

  test("a missing section fails by name", () => {
    expect(() => parseSpec("# X\n\n## Purpose\n\nWhy.\n")).toThrow('"## Principle"');
  });

  test("an empty section fails by name", () => {
    expect(() => parseSpec("# X\n\n## Purpose\n\n## Principle\n\nStory.\n")).toThrow(
      '"## Purpose" section is empty',
    );
  });

  test("an indented heading terminates the preceding section consistently", () => {
    const spec = parseSpec("# X\n\n  ## Purpose\n\nWhy.\n\n  ## Principle\n\nStory.\n");
    expect(spec).toMatchObject({ purpose: "Why.", principle: "Story." });
  });

  test("takes markdown text, not a path or nothing", () => {
    expect(() => parseSpec("")).toThrow("markdown text");
  });

  test("an optional State section is arbitrary notation and never enters ConceptSpec", () => {
    const stateSection = `
## State

\`\`\`state
a set of Invitations
\`\`\`
`;
    const withoutState = SPEC.replace(stateSection, "");
    const contradictoryState = SPEC.replace(
      "a set of Invitations",
      [
        "this is not a machine grammar {]",
        "there are no invitations and accept is not an action",
        "the class has a field that must equal a PostgreSQL table",
      ].join("\n"),
    );

    const parsed = parseSpec(contradictoryState);
    expect(registrationData(contradictoryState)).toEqual(registrationData(withoutState));
    expect(Object.keys(parsed)).toEqual(["purpose", "principle", "actions", "queries"]);
    expect(parsed).not.toHaveProperty("state");
  });
});

describe("the specification's actions", () => {
  test("reads each action's name, inputs, and refusal branches", () => {
    expect(parseSpec(SPEC).actions).toMatchObject([
      { name: "invite", inputs: ["workspace", "guest"], refusals: [] },
      {
        name: "accept",
        inputs: ["invitation"],
        refusals: [{ code: "NO_LONGER_OPEN", message: "This invitation is no longer open." }],
      },
    ]);
  });

  test("a document with no actions fence declares none", () => {
    expect(parseSpec(prose("")).actions).toEqual([]);
  });

  test("an action taking nothing has no inputs", () => {
    expect(parseSpec(actions("reset () : return ()")).actions[0].inputs).toEqual([]);
  });

  test("one code may refuse from several actions", () => {
    const spec = parseSpec(
      actions(
        [
          "respond (discussion: Discussion) : return (response: Response)",
          "  then",
          '    refuse NOT_OPEN "This discussion is not open."',
          "",
          "close (discussion: Discussion) : return ()",
          "  then",
          '    refuse NOT_OPEN "This discussion is not open."',
        ].join("\n"),
      ),
    );
    expect(spec.actions.map(({ name, refusals }) => [name, refusals.map((r) => r.code)])).toEqual([
      ["respond", ["NOT_OPEN"]],
      ["close", ["NOT_OPEN"]],
    ]);
  });

  test("a query name in the actions fence fails", () => {
    expect(() => parseSpec(actions("_get (room: Room) : return ()"))).toThrow(
      "is not an action name",
    );
  });

  test("an action resolving with anything but return fails", () => {
    expect(() => parseSpec(actions("open (name: String) : answer (room: Room)"))).toThrow(
      "resolves with `: return",
    );
  });

  test("a repeated action fails by name", () => {
    expect(() =>
      parseSpec(actions("open (name: String) : return ()\nopen (name: String) : return ()")),
    ).toThrow('the action "open" is declared twice');
  });

  test("one action refusing a code twice fails", () => {
    expect(() =>
      parseSpec(
        actions(
          [
            "open (name: String) : return ()",
            "  then",
            '    refuse TAKEN "One."',
            '    refuse TAKEN "Two."',
          ].join("\n"),
        ),
      ),
    ).toThrow('open refuses "TAKEN" twice');
  });

  test("a refusal with an empty sentence fails", () => {
    expect(() =>
      parseSpec(
        actions(["open (name: String) : return ()", "  then", '    refuse TAKEN ""'].join("\n")),
      ),
    ).toThrow("needs a sentence");
  });

  test("a body preceding any signature fails", () => {
    expect(() => parseSpec(actions("  then\n    return room"))).toThrow(
      "a declaration body precedes its signature",
    );
  });

  test("an unclosed fence fails", () => {
    expect(() => parseSpec(prose("\n## Actions\n\n```actions\nopen () : return ()\n"))).toThrow(
      "never closed",
    );
  });
});

describe("the specification's queries", () => {
  test("reads each query's name, inputs, and promise", () => {
    expect(parseSpec(SPEC).queries).toMatchObject([
      { name: "_pending", inputs: ["workspace"], promise: "many" },
      { name: "_get", inputs: ["invitation"], promise: "optional" },
    ]);
  });

  test("a query promising anything else fails", () => {
    expect(() => parseSpec(queries("_get (room: Room) : some (name: String)"))).toThrow(
      'a query promises "one", "optional", or "many", not "some"',
    );
  });

  test("an action name in the queries fence fails", () => {
    expect(() => parseSpec(queries("get (room: Room) : one (name: String)"))).toThrow(
      "is not a query name",
    );
  });

  test("query bodies are reader-facing prose and do not change metadata", () => {
    const withBodies = queries(
      [
        "_items (catalog: Catalog) : many (item: Item, position: Number)",
        "  answers no rows for an unknown Catalog",
        "  orders rows by ascending position",
        "_owner (catalog: Catalog) : one (owner: Person)",
        "_selected () : optional (catalog: Catalog)",
        "  returns no row until a Catalog is selected",
      ].join("\n"),
    );
    const withoutBodies = queries(
      [
        "_items (catalog: Catalog) : many (item: Item, position: Number)",
        "_owner (catalog: Catalog) : one (owner: Person)",
        "_selected () : optional (catalog: Catalog)",
      ].join("\n"),
    );

    expect(registrationData(withBodies).queries).toEqual(registrationData(withoutBodies).queries);
    expect(parseSpec(withBodies).queries.map(({ body }) => body)).toEqual([
      "answers no rows for an unknown Catalog\norders rows by ascending position",
      "",
      "returns no row until a Catalog is selected",
    ]);
  });

  test("a query body preceding any signature fails", () => {
    expect(() => parseSpec(queries("  answers no rows"))).toThrow(
      "a declaration body precedes its signature",
    );
  });
});

describe("structured signatures", () => {
  test("retains optional fields, nested generic types, unions, and results", () => {
    const [action] = parseSpec(
      actions(
        "configure (values: Map<Text, Value | undefined>, source?: Box<(Source | null)>) " +
          ": return (configuration: Configuration, warning?: Text | null)",
      ),
    ).actions;

    expect(action.inputs).toEqual(["values", "source"]);
    expect(action.parameters).toMatchObject([
      {
        name: "values",
        optional: false,
        type: {
          kind: "named",
          name: "Map",
          arguments: [
            { kind: "named", name: "Text" },
            {
              kind: "union",
              members: [{ kind: "named", name: "Value" }, { kind: "undefined" }],
            },
          ],
        },
      },
      {
        name: "source",
        optional: true,
        type: {
          kind: "named",
          name: "Box",
          arguments: [
            {
              kind: "union",
              members: [{ kind: "named", name: "Source" }, { kind: "null" }],
            },
          ],
        },
      },
    ]);
    expect(action.result).toMatchObject({
      kind: "fields",
      fields: [
        { name: "configuration", optional: false, type: { kind: "named", name: "Configuration" } },
        {
          name: "warning",
          optional: true,
          type: {
            kind: "union",
            members: [{ kind: "named", name: "Text" }, { kind: "null" }],
          },
        },
      ],
    });
    expect(action.location).toEqual({ line: 14, column: 1 });
  });

  test("accepts a named result-row type", () => {
    const [query] = parseSpec(queries("_report (source?: Source) : one Diagnostic.Row")).queries;
    expect(query.result).toMatchObject({
      kind: "type",
      type: { kind: "named", name: "Diagnostic.Row", arguments: [] },
    });
  });

  test("an earlier reserved fence outside its section cannot replace declarations", () => {
    const markdown = prose(`

\`\`\`actions
wrong () : return ()
\`\`\`

## Actions

\`\`\`actions
right () : return ()
\`\`\`
`);
    expect(parseSpec(markdown).actions.map(({ name }) => name)).toEqual(["right"]);
  });

  test("escaped refusal quotes are decoded", () => {
    const [action] = parseSpec(
      actions('open () : return ()\n  then\n    refuse TAKEN "The name \\"atlas\\" is taken."'),
    ).actions;
    expect(action.refusals[0]).toMatchObject({
      code: "TAKEN",
      message: 'The name "atlas" is taken.',
    });
  });

  test("unsupported trailing signature text gets a migration diagnostic", () => {
    expect(() => parseSpec(actions("open () : return () ignored"))).toThrow(
      "unsupported trailing text",
    );
  });

  test("duplicate fields and incomplete results fail at their source location", () => {
    expect(() => parseSpec(actions("open (name: Text, name: Text) : return ()"))).toThrow(
      /line 14, column .*input parameters declare "name" twice/,
    );
    expect(() => parseSpec(actions("open () : return"))).toThrow(
      /line 14, column .*resolution needs a result declaration/,
    );
  });
});
