import { describe, expect, test } from "vite-plus/test";
import { conceptSet, registerConcept } from "@sync-engine/assembly";

class FirstCommenting {
  add({ target: _target }: { target: string }): Record<string, never> {
    return {};
  }
}

class OtherCommenting extends FirstCommenting {}

function commenting(state = "a set of Comments"): string {
  return `# Commenting

## Purpose

Attach comments to a target.

## Principle

Adding a comment makes it visible.

## Types

\`\`\`types
external Target
  The object receiving the comment.
\`\`\`

## State

\`\`\`state
${state}
\`\`\`

## Actions

\`\`\`actions
add(target: Target) : return ()
  where true
  then
    add a comment
    return
\`\`\`

## Queries

\`\`\`queries
\`\`\`
`;
}

describe("concept definition identity in a selected concept set", () => {
  test("one canonical definition may be instantiated under several vocabulary keys", () => {
    const first = registerConcept({ class: FirstCommenting, spec: commenting() });
    const second = registerConcept({
      class: OtherCommenting,
      spec: `\n\n${commenting()}`,
    });
    const set = conceptSet({ PostComments: first, AnswerComments: second });

    expect(set.concepts).toBeDefined();
    expect(first.specification.definitionName).toBe("Commenting");
    expect(second.specification.definitionName).toBe("Commenting");
  });

  test("rejects incompatible contracts claiming one definition name", () => {
    const first = registerConcept({ class: FirstCommenting, spec: commenting() });
    const incompatible = registerConcept({
      class: OtherCommenting,
      spec: commenting("Rule: a map of Comments by Target"),
    });

    expect(() => conceptSet({ PostComments: first, AnswerComments: incompatible })).toThrow(
      'instances "PostComments" and "AnswerComments" use incompatible specifications for definition "Commenting"',
    );
  });
});
