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
    expect(parsed).toEqual(parseSpec(withoutState));
    expect(Object.keys(parsed)).toEqual(["purpose", "principle", "actions", "queries"]);
    expect(parsed).not.toHaveProperty("state");
  });
});

describe("the specification's actions", () => {
  test("reads each action's name, inputs, and refusal branches", () => {
    expect(parseSpec(SPEC).actions).toEqual([
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
    expect(() => parseSpec(prose("\n```actions\nopen () : return ()\n"))).toThrow("never closed");
  });
});

describe("the specification's queries", () => {
  test("reads each query's name, inputs, and promise", () => {
    expect(parseSpec(SPEC).queries).toEqual([
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

  test("a query with a body fails", () => {
    expect(() =>
      parseSpec(queries("_get (room: Room) : one (name: String)\n  then\n    read")),
    ).toThrow("cannot have a body");
  });
});
