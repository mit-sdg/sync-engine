import { scanDesignMarkdown } from "@engine/tooling/markdown-design-source";
import {
  parseSimpleStateForm,
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
    for (const collection of ["set of Person", "seq Person"]) {
      issue(
        `a set of Groups with\n  an optional members ${collection}`,
        "SSF_OPTIONAL_COLLECTION",
        "Remove `optional` from this field.",
      );
    }
    issue(
      "a set of Sessions with\n  revokedAt optional DateTime",
      "SSF_MISPLACED_OPTIONAL",
      "optional revokedAt DateTime",
    );
    issue(
      "a set of Groups with\n  optional members set of Person",
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
    issue(
      "a element Settings with\n  a retentionDays Number",
      "SSF_ARTICLE",
      "an element Settings with",
    );
    issue(
      "Completed set of Items",
      "SSF_ARTICLE",
      "Use `a Completed set of Items` or `an Completed set of Items`.",
    );
    issue(
      "Open set of Items",
      "SSF_ARTICLE",
      "Use `a Open set of Items` or `an Open set of Items`.",
    );
  });

  test("reports source positions from the Markdown fence", () => {
    expect(validate("a set of Sessions with\n  a revokedAt optional DateTime")).toMatchObject([
      {
        code: "SSF_MISPLACED_OPTIONAL",
        location: { source: "concept.md", line: 3, column: 15 },
        span: { start: { offset: 37, line: 2, column: 15 } },
      },
    ]);
  });

  test("adapts structured ownership and package-local spans without coupling the package to Markdown", () => {
    const scanned = scanDesignMarkdown(
      "# Example\n\n```state\na set of Entries with\n  an owner Person\n\nan Open set of Entries\n```\n",
      "design/example.md",
    );
    const parsed = parseSimpleStateForm(scanned.fences[0]!, { externalTypes: ["Person"] });
    expect(parsed.document.inventory).toMatchObject({
      identities: [{ name: "Entries" }],
      types: [{ name: "Entries" }, { name: "Open" }],
      external: ["Person"],
    });
    expect(parsed.document.declarations[0]).toMatchObject({
      name: { referenceKind: "owned" },
      fields: [{ value: { reference: { referenceKind: "external" } } }],
    });
  });

  test.each([
    ["canonical declarations", "a set of Items with\n  an optional dueAt DateTime"],
    ["canonical article-less optional", "a set of Items with\n  optional dueAt DateTime"],
    ["canonical sequence", "a seq of Items with\n  a members set of Person"],
    ["canonical subset", "an Open set of Items"],
    ["either subset article", "a Hour set of Items\nan Hour set of Items"],
    ["invariant prose", "a set of Items with\n  a title String\n\nat most one Item has each title"],
    ["opaque no-state prose", "no durable state"],
    ["opaque function state", "a read function\n  read () -> DateTime"],
    ["unrecognized colon dialect", "comments: set Comment\n  author: Person"],
  ])("ignores or accepts %s", (_name, body) => {
    expect(validate(body)).toEqual([]);
  });

  test("reports malformed article-less fields that start with structural keywords", () => {
    expect(
      validate("a set of Groups with\n  optional owner\n  optional optional owner Person").map(
        ({ code }) => code,
      ),
    ).toEqual(["SSF_MALFORMED_FIELD", "SSF_MALFORMED_FIELD"]);
  });

  test("reports an empty `with` body", () => {
    issue(
      "a set of Items with",
      "SSF_MALFORMED_DECLARATION",
      "Remove `with` or add at least one indented field.",
    );
  });

  test("reports malformed structural declarations and fields without rejecting invariant prose", () => {
    expect(
      validate(
        "set Items\n\na set of Items with garbage\n\na set of Accounts with\n  a owner\n\nat most one Item has each owner",
      ).map(({ code }) => code),
    ).toEqual(["SSF_ARTICLE", "SSF_MALFORMED_DECLARATION", "SSF_MALFORMED_FIELD"]);
  });

  test("diagnoses orphan structural-looking fields while preserving indented prose", () => {
    expect(
      validate(
        "  a owner\n  owner String\n  a user may own many Items\n\na set of Records with garbage\n  an optional owner",
      ).map(({ code }) => code),
    ).toEqual([
      "SSF_MALFORMED_FIELD",
      "SSF_MALFORMED_FIELD",
      "SSF_MALFORMED_DECLARATION",
      "SSF_MALFORMED_FIELD",
    ]);
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
