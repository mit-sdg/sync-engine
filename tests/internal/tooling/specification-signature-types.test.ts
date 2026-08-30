import { parseSpec } from "@engine/reactions/concepts/concept-spec";
import { specificationOwnedTypeNames } from "@engine/tooling/application-manifest-format";
import { validateSpecificationSignatureTypes } from "@engine/tooling/specification-signature-types";
import { specificationTypeNameEvidence } from "@engine/tooling/specification-type-evidence";
import { parseSimpleStateForm } from "@ssf";
import { describe, expect, test } from "vite-plus/test";

function concept(actions: string, queries = ""): string {
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
a set of Invitations with
  an invitee Person
  a status Status
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
    return value`;

describe("specification signature type validation", () => {
  test("reports every undeclared parameter, result, query input, and row type at its name", () => {
    const markdown = concept(
      `start(flavour: Blancmange) : return (value: Custard)${body}`,
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
      concept(`start(value: Secret<Flapjack | null | undefined>) : return ()
  where true
  then
    return`),
    );
    expect(validateSpecificationSignatureTypes(specification, document)).toMatchObject([
      { code: "SSF_UNDECLARED_TYPE", location: { column: 21 } },
    ]);
  });

  test("accepts joined ownership, externals, local types, and every primitive", () => {
    const { specification, document } = checked(
      concept(`start(invitation: Invitation, person: Person, status: Status, secret: Secret, number: Number, text: String, flag: Flag, date: Date, time: DateTime) : return (invitation: Invitation)
  where true
  then
    return invitation`),
    );
    expect(validateSpecificationSignatureTypes(specification, document)).toEqual([]);
    expect(specificationOwnedTypeNames(specification)).toEqual(["Invitation", "Invitations"]);
  });

  test("makes manifest-owned-name resolution reject signature types", () => {
    const { specification } = checked(
      concept(`start(value: Blancmange) : return ()
  where true
  then
    return`),
    );
    expect(() => specificationOwnedTypeNames(specification)).toThrow(
      /invalid action\/query signature types:.*\[SSF_UNDECLARED_TYPE\] Type "Blancmange".*suggestion:/s,
    );
  });
});
