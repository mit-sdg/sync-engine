import { describe, expect, test } from "vite-plus/test";
import { BriefCheckError, checkBrief } from "../skills/sync-engine/scripts/brief.ts";

function brief(decisions = "- **D1 — Scope (Assumption):** Use one workspace.", open = "None.") {
  return `# Product

## Objective

Build the requested product.

## Product decisions

${decisions}

## Visible success

- A user completes the primary task.

## Expected refusals

None.

## Assumptions

None.

## Non-goals

None.

## Open decisions

${open}
`;
}

describe("product brief validation", () => {
  test("accepts compact decisions and non-material open choices", () => {
    expect(checkBrief(brief(undefined, "- Visual presentation remains unspecified."))).toEqual({
      bytes: Buffer.byteLength(brief(undefined, "- Visual presentation remains unspecified.")),
      decisions: 1,
      openDecisions: true,
    });
  });

  test("accepts a brief with no explicit decisions", () => {
    expect(checkBrief(brief("None."))).toMatchObject({ decisions: 0, openDecisions: false });
  });

  test.each([
    ["YAML frontmatter", `---\ntitle: Product\n---\n${brief()}`, "YAML frontmatter"],
    ["missing heading", brief().replace("## Assumptions\n\nNone.\n\n", ""), "H2 sections"],
    ["reordered headings", brief().replace("## Assumptions", "## Zssumptions"), "H2 sections"],
    ["empty section", brief().replace("Build the requested product.", ""), "section is empty"],
    [
      "duplicate decision",
      brief("- **D1 — First (User):** One.\n- **D1 — Second (Assumption):** Two."),
      "Duplicate product decision",
    ],
    ["unknown authority", brief("- **D1 — Scope (System):** One."), "Malformed product decision"],
    [
      "multiline decision",
      brief("- **D1 — Scope (User):** One.\n  More."),
      "Malformed product decision",
    ],
  ])("rejects %s", (_name, source, message) => {
    expect(() => checkBrief(source)).toThrow(message);
  });

  test("enforces the eight KiB limit", () => {
    const oversized = brief().replace("Build the requested product.", "x".repeat(8 * 1024));
    expect(() => checkBrief(oversized)).toThrow(BriefCheckError);
    expect(() => checkBrief(oversized)).toThrow("maximum is 8192");
  });
});
