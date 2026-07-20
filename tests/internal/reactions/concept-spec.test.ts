/**
 * A concept's spec document is the one source of its purpose
 * and principle — parsed at import time, failing loudly when either section
 * is missing, so prose can never drift from the document that authored it.
 */
import { describe, expect, test } from "vite-plus/test";
import { parseSpecProse } from "@sync-engine/internal/reactions";

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
`;

describe("spec prose", () => {
  test("extracts purpose and principle, whole", () => {
    expect(parseSpecProse(SPEC)).toEqual({
      purpose: "Let a member invite someone into a shared workspace.",
      principle:
        "Priya invites Sam; a pending invitation now exists.\nSam accepts it, and it becomes accepted.",
    });
  });

  test("a missing section fails by name", () => {
    expect(() => parseSpecProse("# X\n\n## Purpose\n\nWhy.\n")).toThrow('"## Principle"');
  });

  test("an empty section fails by name", () => {
    expect(() => parseSpecProse("# X\n\n## Purpose\n\n## Principle\n\nStory.\n")).toThrow(
      '"## Purpose" section is empty',
    );
  });

  test("takes markdown text, not a path or nothing", () => {
    expect(() => parseSpecProse("")).toThrow("markdown text");
  });
});
