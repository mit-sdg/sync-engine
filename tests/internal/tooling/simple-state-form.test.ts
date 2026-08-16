import { scanDesignMarkdown } from "@engine/tooling/markdown-design-source";
import {
  validateSimpleStateForm,
  type SimpleStateFormIssueCode,
} from "@engine/tooling/simple-state-form";
import { describe, expect, test } from "vite-plus/test";

function validate(body: string) {
  const scanned = scanDesignMarkdown(`\`\`\`state\n${body}\n\`\`\`\n`, "concept.md");
  const fence = scanned.fences[0];
  if (fence === undefined) throw new Error("test fixture has no state fence");
  return validateSimpleStateForm(fence);
}

function issue(body: string, code: SimpleStateFormIssueCode, suggestion: string): void {
  expect(validate(body)).toMatchObject([{ code, suggestion }]);
}

describe("limited Simple State Form validation", () => {
  test("reports deterministic repairs for recognized SSF mistakes", () => {
    issue(
      "a set of Sessions with\n  a revokedAt optional DateTime",
      "SSF_MISPLACED_OPTIONAL",
      "an optional revokedAt DateTime",
    );
    issue(
      "a set of Groups with\n  an optional members set of Person",
      "SSF_OPTIONAL_COLLECTION",
      "Remove `optional` from this field.",
    );
    issue(
      "a set of Sessions with\n  a optional revokedAt DateTime",
      "SSF_ARTICLE",
      "an optional revokedAt DateTime",
    );
    issue(
      "a sequence of Observations with\n  an operation Operation",
      "SSF_NEAR_MISS_KEYWORD",
      "a seq of Observations with",
    );
    issue(
      "a set of Sessions\n  an expiresAt DateTime",
      "SSF_MISSING_WITH",
      "a set of Sessions with",
    );
    issue("a element Settings with", "SSF_ARTICLE", "an element Settings with");
  });

  test("reports source positions from the Markdown fence", () => {
    expect(validate("a set of Sessions with\n  a revokedAt optional DateTime")).toMatchObject([
      {
        code: "SSF_MISPLACED_OPTIONAL",
        location: { source: "concept.md", line: 3, column: 15 },
      },
    ]);
  });

  test.each([
    ["canonical declarations", "a set of Items with\n  an optional dueAt DateTime"],
    ["canonical sequence", "a seq of Items with\n  a members set of Person"],
    ["canonical subset", "an Open set of Items"],
    ["invariant prose", "a set of Items with\n  a title String\n\nat most one Item has each title"],
    ["opaque no-state prose", "no durable state"],
    ["opaque function state", "a read function\n  read () -> DateTime"],
    ["inline fields", "a set of Notes with an author Person and text String"],
    ["nontrivial article", "a set of Entries with\n  a unique name String"],
    ["unrecognized colon dialect", "comments: set Comment\n  author: Person"],
  ])("ignores or accepts %s", (_name, body) => {
    expect(validate(body)).toEqual([]);
  });

  test("batches independent issues in source order", () => {
    expect(
      validate(
        "a sequence of Sessions\n  a revokedAt optional DateTime\n\na set of Groups with\n  an optional members seq of Person",
      ).map(({ code }) => code),
    ).toEqual([
      "SSF_NEAR_MISS_KEYWORD",
      "SSF_MISSING_WITH",
      "SSF_MISPLACED_OPTIONAL",
      "SSF_OPTIONAL_COLLECTION",
    ]);
  });
});
