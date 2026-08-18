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
      "  an optional revokedAt DateTime",
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
      "  optional revokedAt DateTime",
    );
    issue(
      "a set of Groups with\n  optional members set of Person",
      "SSF_OPTIONAL_COLLECTION",
      "Remove `optional` from this field.",
    );
    issue(
      "a set of Sessions with\n  a optional revokedAt DateTime",
      "SSF_ARTICLE",
      "  an optional revokedAt DateTime",
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
      "a set of Items\n\nCompleted set of Items",
      "SSF_ARTICLE",
      "Use `a Completed set of Items` or `an Completed set of Items`.",
    );
    issue(
      "a set of Items\n\nOpen set of Items",
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

  test.each([
    ["person", "SSF_INVALID_EXTERNAL_NAME"],
    ["String", "SSF_NAME_COLLISION"],
  ] as const)("maps the external diagnostic for %s through its Types location", (name, code) => {
    const scanned = scanDesignMarkdown(
      "# Example\n\n```state\na set of Entries\n```\n",
      "design/example.md",
    );
    const issues = validateSimpleStateForm(scanned.fences[0]!, {
      externalTypes: [{ name, explanation: "", location: { line: 19, column: 10 } }],
    });
    expect(issues).toMatchObject([
      {
        severity: "error",
        code,
        externalType: name,
        location: { source: "design/example.md", line: 19, column: 10 },
      },
    ]);
    expect(issues[0]).not.toHaveProperty("span");
  });

  test("adapts structured ownership and package-local spans without coupling the package to Markdown", () => {
    const scanned = scanDesignMarkdown(
      "# Example\n\n```state\na set of Entries with\n  an owner Person\n\nan Open set of Entries\n```\n",
      "design/example.md",
    );
    const parsed = parseSimpleStateForm(scanned.fences[0]!, {
      externalTypes: [{ name: "Person", explanation: "", location: { line: 1, column: 1 } }],
    });
    expect(parsed.document.inventory).toMatchObject({
      ownedTypeNames: ["Entries", "Open"],
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
    ["canonical subset", "a set of Items\n\nan Open set of Items"],
    ["either subset article", "a set of Items\n\na Hour set of Items\nan Honest set of Items"],
    [
      "marked invariant prose",
      "a set of Items with\n  a title String\n\nRule: at most one Item has each title",
    ],
    ["marked no-state prose", "Rule: no durable state"],
    ["marked function state", "Rule: a read function\nRule: read () -> DateTime"],
  ])("accepts %s", (_name, body) => {
    expect(validate(body)).toEqual([]);
  });

  test("rejects an unmarked colon dialect", () => {
    expect(validate("comments: set Comment\n  author: Person")).toMatchObject([
      {
        code: "SSF_MALFORMED_DECLARATION",
        suggestion:
          "Use a complete declaration or alias, or prefix prose with the exact `Rule:` marker.",
      },
      {
        code: "SSF_MALFORMED_FIELD",
        suggestion: "Use a complete field, or prefix prose with the exact `Rule:` marker.",
      },
    ]);
  });

  test("reports malformed article-less fields that start with structural keywords", () => {
    expect(
      validate(
        "a set of Groups with\n  a name String\n  optional owner\n  optional optional owner Person",
      ).map(({ code }) => code),
    ).toEqual(["SSF_MALFORMED_FIELD", "SSF_MALFORMED_FIELD"]);
  });

  test("reports an empty `with` body", () => {
    issue(
      "a set of Items with",
      "SSF_MALFORMED_DECLARATION",
      "Remove `with` or add at least one indented field.",
    );
  });

  test("reports malformed structural declarations and fields while accepting a rule", () => {
    expect(
      validate(
        "set Items\n\na set of Items with garbage\n\na set of Accounts with\n  an account String\n  a owner\n\nRule: at most one Item has each owner",
      ).map(({ code }) => code),
    ).toEqual(["SSF_ARTICLE", "SSF_MALFORMED_DECLARATION", "SSF_MALFORMED_FIELD"]);
  });

  test("distinguishes orphan fields from malformed body lines", () => {
    expect(
      validate(
        "  a owner\n  owner String\nRule: a user may own many Items\n\na set of Records with garbage\n  an optional owner",
      ).map(({ code }) => code),
    ).toEqual([
      "SSF_MALFORMED_FIELD",
      "SSF_ORPHANED_LINE",
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
