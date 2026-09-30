import { parseSpec } from "@engine/reactions/concepts/concept-spec";
import { specificationOwnedTypeNames } from "@engine/tooling/application-manifest-format";
import { validateSpecificationSignatureTypes } from "@engine/tooling/specification-signature-types";
import { specificationTypeNameEvidence } from "@engine/tooling/specification-type-evidence";
import { parseSimpleStateForm } from "@ssf";
import { describe, expect, test } from "vite-plus/test";

const INVITATIONS = `a set of Invitations with
  an invitee Person
  a status Status`;

function concept(actions: string, queries = "", state = INVITATIONS): string {
  return `# Inviting

## Purpose

Issue invitations.

## Principle

A person receives an invitation.

## Types

\`\`\`types
external Person
Status is PENDING or ACCEPTED
opaque Secret
\`\`\`

## State

\`\`\`state
${state}
\`\`\`

## Actions

\`\`\`actions
${actions}
\`\`\`

## Queries

\`\`\`queries
${queries}
\`\`\`
`;
}

function checked(markdown: string) {
  const parsed = parseSpec(markdown);
  expect(parsed.diagnostics).toEqual([]);
  const specification = parsed.specification!;
  const state = parseSimpleStateForm(specification.state.body, {
    externalTypes: specification.externalTypes.map(({ name }) => name),
    localTypes: specification.localTypes.map((type) => ({
      name: type.name,
      ...(type.kind === "enumeration" ? { values: type.values } : {}),
    })),
    evidenceTypeNames: specificationTypeNameEvidence(specification),
  });
  expect(state.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  return { specification, document: state.document };
}

const body = `
  where true
  then
    returns value`;

describe("specification signature type validation", () => {
  test("reports every undeclared parameter, result, query input, and row type at its name", () => {
    const markdown = concept(
      `start(flavour: Blancmange) : returns (value: Custard)${body}`,
      `_get(attempt: Trifle) : optional (note: Flapjack)`,
    );
    const { specification, document } = checked(markdown);

    expect(validateSpecificationSignatureTypes(specification, document)).toEqual(
      ["Blancmange", "Custard", "Trifle", "Flapjack"].map((name) => {
        const offset = markdown.indexOf(name);
        const before = markdown.slice(0, offset);
        return {
          severity: "error",
          code: "SSF_UNDECLARED_TYPE",
          message: `Type ${JSON.stringify(name)} is not owned, external, concept-local, or an SSF primitive.`,
          suggestion: `Declare it in the Types fence as \`external ${name}\`, \`${name} is VALUE_A or VALUE_B\`, or \`opaque ${name}\`.`,
          location: {
            line: before.split("\n").length,
            column: offset - before.lastIndexOf("\n"),
          },
        };
      }),
    );
  });

  test("walks nested named type arguments", () => {
    const { specification, document } = checked(
      concept(`start(value: Secret<Flapjack | null | undefined>) : returns ()
  where true
  then
    returns`),
    );
    expect(validateSpecificationSignatureTypes(specification, document)).toMatchObject([
      { code: "SSF_UNDECLARED_TYPE", location: { column: 21 } },
    ]);
  });

  test("accepts joined ownership, externals, local types, and every primitive", () => {
    const { specification, document } = checked(
      concept(`start(invitation: Invitation, person: Person, status: Status, secret: Secret, number: Number, text: String, flag: Flag, date: Date, time: DateTime) : returns (invitation: Invitation)
  where true
  then
    returns invitation`),
    );
    expect(validateSpecificationSignatureTypes(specification, document)).toEqual([]);
    expect(specificationOwnedTypeNames(specification)).toEqual(["Invitation", "Invitations"]);
  });

  test("accepts a set of an external type's spelling but keeps subsets out of signatures", () => {
    const markdown = concept(
      `invite(invitee: Person, among: People) : returns (invitation: Invitation)
  where invitee is in People
  then
    returns invitation

decline(invitation: DeclinedInvitation) : returns ()
  where invitation is not in Declined Invitations
  then
    returns`,
      "",
      `${INVITATIONS}

a set of People

a set of Declined Invitations

a set of Reminders with
  a Declined Invitation`,
    );
    const { specification, document } = checked(markdown);
    expect(document.inventory).toMatchObject({
      ownedTypeNames: ["Invitation", "Invitations", "Reminders"],
      externalSpellings: ["People"],
      subsets: [
        {
          name: "Declined Invitations",
          identifiers: ["DeclinedInvitation", "DeclinedInvitations"],
          rootType: "Invitation",
        },
      ],
    });
    expect(validateSpecificationSignatureTypes(specification, document)).toMatchObject([
      {
        code: "SSF_SUBSET_SIGNATURE_TYPE",
        message:
          'Type "DeclinedInvitation" is the subset "Declined Invitations", which only State fields may use.',
        suggestion:
          "Use the type of the set it qualifies, Invitation, and state membership in a condition, such as `where it is in Declined Invitations`.",
      },
    ]);
  });

  test.each([
    ["an argument type", "Declined Invitation"],
    ["a type argument", "Secret<Declined Invitation>"],
    ["a grouped type", "(Declined Invitation)"],
    ["a union member", "String | Declined Invitation"],
    ["a tab-separated phrase", "Declined\tInvitation"],
    ["a phrase with a non-breaking space", "Declined\u00a0Invitation"],
  ])("explains a subset phrase written as %s", (_, type) => {
    expect(
      parseSpec(
        concept(`decline(invitation: ${type}) : returns ()
  where true
  then
    returns`),
      ).diagnostics,
    ).toMatchObject([
      {
        code: "CONCEPT_SPEC_SIGNATURE",
        message: expect.stringContaining(
          '"Declined Invitation" names a subset; a signature takes the type of the set it qualifies, "Invitation"',
        ),
      },
    ]);
  });

  test("recognizes a subset identifier through an irregular plural", () => {
    const { specification, document } = checked(
      concept(
        `release(subject: LabMouse) : returns ()
  where subject is in Lab Mice
  then
    returns`,
        "",
        "a set of Mice\n\na set of Lab Mice",
      ),
    );
    expect(validateSpecificationSignatureTypes(specification, document)).toMatchObject([
      { code: "SSF_SUBSET_SIGNATURE_TYPE", message: expect.stringContaining('"Lab Mice"') },
    ]);
  });

  test("recognizes a subset identifier in the number no State line spells", () => {
    const { specification, document } = checked(
      concept(
        `decline(target: DeclinedInvitation) : returns ()
  where target is in Declined Invitations
  then
    returns`,
        "",
        "a set of Invitations\n\na set of Declined Invitations",
      ),
    );
    expect(document.inventory.subsets).toMatchObject([
      { name: "Declined Invitations", identifiers: ["DeclinedInvitations"] },
    ]);
    expect(validateSpecificationSignatureTypes(specification, document)).toMatchObject([
      {
        code: "SSF_SUBSET_SIGNATURE_TYPE",
        message: expect.stringContaining('"DeclinedInvitation"'),
      },
    ]);
  });

  test("makes manifest-owned-name resolution reject signature types", () => {
    const { specification } = checked(
      concept(`start(value: Blancmange) : returns ()
  where true
  then
    returns`),
    );
    expect(() => specificationOwnedTypeNames(specification)).toThrow(
      /invalid action\/query signature types:.*\[SSF_UNDECLARED_TYPE\] Type "Blancmange".*suggestion:/s,
    );
  });
});
