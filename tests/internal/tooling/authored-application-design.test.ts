import { describe, expect, test } from "vite-plus/test";
import {
  parseApplicationDesignDocument,
  parseApplicationVocabularyDocument,
  validateAuthoredApplicationDesign,
} from "@engine/tooling/authored-application-design";
import {
  designContentDigest,
  normalizeDesignContent,
} from "@engine/tooling/markdown-design-source";

describe("authored application design documents", () => {
  test("parses exact inline and citation links with occurrence locations", () => {
    const document = parseApplicationDesignDocument(
      [
        "# Forum decisions",
        "",
        "Editing [refreshes content](reaction:Forum.posts.RefreshDerivedContent).",
        "The home feed is stable.[feed] It uses [a former][form].",
        "",
        '[feed]: view:Forum.feed.HomeFeed "selected view"',
        "[form]: <former:Forum.feed.FormHome>",
      ].join("\r\n"),
      "design/forum.md",
    );

    expect(document.title).toBe("Forum decisions");
    expect(document.links).toEqual([
      expect.objectContaining({
        kind: "reaction",
        target: "Forum.posts.RefreshDerivedContent",
        location: { source: "design/forum.md", line: 3, column: 9 },
      }),
      expect.objectContaining({
        kind: "view",
        target: "Forum.feed.HomeFeed",
        location: { source: "design/forum.md", line: 4, column: 25 },
      }),
      expect.objectContaining({
        kind: "former",
        target: "Forum.feed.FormHome",
        location: { source: "design/forum.md", line: 4, column: 40 },
      }),
    ]);
    expect(document.content).toContain("\n");
    expect(document.digest).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  test("parses multiline, nested, escaped, and reference links with CommonMark semantics", () => {
    const document = parseApplicationDesignDocument(
      `# Design

A [multi
line with *nested \\] text*][Coverage] and
[escaped \\[label\\]](
  <former:Forum.Form>
  "title"
).

[Coverage]:
  reaction:Forum.Refresh
  "first"
[COVERAGE]: view:Forged.Duplicate
`,
      "design/commonmark.md",
    );

    expect(document.links).toEqual([
      expect.objectContaining({
        kind: "reaction",
        target: "Forum.Refresh",
        text: "multi line with nested ] text",
        location: { source: "design/commonmark.md", line: 3, column: 3 },
      }),
      expect.objectContaining({
        kind: "former",
        target: "Forum.Form",
        text: "escaped [label]",
        location: { source: "design/commonmark.md", line: 5, column: 1 },
      }),
    ]);
  });

  test("finds computation fences anywhere and retains signatures and required bodies", () => {
    const document = parseApplicationDesignDocument(
      `Computation design
==================

Ordinary prose before the declaration.

~~~computations
invitationMailText(invitation: String, credential?: String) : String
  Produces the invitation.
  Includes the public URL.

score(values: List<Number>) : Number
  Produces one score.
~~~
`,
      "design/computations.md",
    );

    expect(document.computations).toEqual([
      {
        name: "invitationMailText",
        inputs: [
          expect.objectContaining({ name: "invitation", optional: false, type: "String" }),
          expect.objectContaining({ name: "credential", optional: true, type: "String" }),
        ],
        result: "String",
        body: "Produces the invitation.\nIncludes the public URL.",
        location: { source: "design/computations.md", line: 7, column: 1 },
      },
      expect.objectContaining({ name: "score", body: "Produces one score." }),
    ]);
  });

  test.each([
    ["# One\n# Two\n[x](reaction:A.B)\n", /exactly one H1/],
    ["# One\n[x](reaction:A.*)\n", /exact non-wildcard/],
    ["# One\n```computations\nf(x: String) : String\n```\n", /indented prose body/],
    ["# One\n```computations\nnot a signature\n  Explains it.\n```\n", /needs `name/],
    [
      "# One\n```computations\nf(value String) : String\n  Explains it.\n```\n",
      /invalid computation input/,
    ],
    [
      "# One\n```computations\nf(value: Map<String) : String\n  Explains it.\n```\n",
      /unbalanced delimiters/,
    ],
    [
      "# One\n```computations\nf(value: String, value: Number) : String\n  Explains it.\n```\n",
      /declared twice/,
    ],
    ["# One\nBackground only.\n", /must cite/],
  ])("rejects malformed registered documents", (markdown, message) => {
    expect(() => parseApplicationDesignDocument(markdown, "bad.md")).toThrow(message);
  });

  test("uses CommonMark text alternatives for richly labeled links", () => {
    const document = parseApplicationDesignDocument(
      `# Rich labels

[\`Refresh\` ![posts](posts.png)\\
now](reaction:Forum.Refresh)
`,
    );

    expect(document.links).toEqual([
      expect.objectContaining({
        kind: "reaction",
        target: "Forum.Refresh",
        text: "Refresh posts now",
      }),
    ]);
  });

  test("does not parse declarations, links, or headings from code", () => {
    const document = parseApplicationDesignDocument(
      `# Real title

\`\`\`text
# Not a title
[fake](reaction:Not.Selected)
\`\`\`

Neither \`[inline](reaction:Not.Inline)\` nor <!-- [comment](view:Not.Comment) --> is a link.
[real](view:Forum.Real)
`,
    );
    expect(document.links.map(({ target }) => target)).toEqual(["Forum.Real"]);
  });

  test("cannot forge coverage with comments, code, HTML blocks, or images", () => {
    const document = parseApplicationDesignDocument(
      `# Real title

<!--
[comment forgery](reaction:Forged.*)
-->

    [indented forgery](view:Forged.*)

<div>
[HTML forgery](former:Forged.*)
</div>

![image forgery](reaction:Forged.*)
A \`[code forgery](view:Forged.*)\` is inert.

[real](view:Forum.Real)
`,
      "design/adversarial.md",
    );

    expect(document.links).toEqual([
      expect.objectContaining({
        kind: "view",
        target: "Forum.Real",
        location: { source: "design/adversarial.md", line: 16, column: 1 },
      }),
    ]);
  });

  test("normalizes platform newlines and a final newline before digesting full prose", () => {
    const unix = "# Design\n[x](view:Forum.X)\n";
    const windows = "\uFEFF# Design\r\n[x](view:Forum.X)\r\n";
    expect(normalizeDesignContent(windows)).toBe(unix);
    expect(designContentDigest(windows)).toBe(designContentDigest(unix));
    expect(designContentDigest(`${unix}More prose.\n`)).not.toBe(designContentDigest(unix));
  });
});

describe("application vocabulary design", () => {
  test("parses concrete declarations, direct bindings, optional explanations, prose, and computations", () => {
    const vocabulary = parseApplicationVocabularyDocument(
      `# Forum vocabulary

Institution identities are used throughout. [refresh](reaction:Forum.Refresh)

\`\`\`types
concrete Person
  A stable identity supplied by the institution.

PostComments.User is Person
  Authors are institution identities.

PostComments.Target is Posting.Post
\`\`\`

\`\`\`computations
formatName(person: Person) : String
  Formats a person's public name.
\`\`\`
`,
      "design/vocabulary.md",
    );

    expect(vocabulary.concreteTypes).toEqual([
      {
        name: "Person",
        definition: "A stable identity supplied by the institution.",
        location: { source: "design/vocabulary.md", line: 6, column: 1 },
      },
    ]);
    expect(vocabulary.bindings).toEqual([
      expect.objectContaining({
        instance: "PostComments",
        external: "User",
        target: { kind: "concrete", name: "Person" },
        explanation: "Authors are institution identities.",
      }),
      expect.objectContaining({
        instance: "PostComments",
        external: "Target",
        target: { kind: "qualified", instance: "Posting", type: "Post" },
      }),
    ]);
    expect(vocabulary.computations).toHaveLength(1);
  });

  test.each([
    ["# V\n", /exactly one `types` fence/],
    ["# V\n```types\nconcrete Person\n```\n", /prose definition/],
    ["# V\n```types\nA.B becomes C\n```\n", /accepts only/],
    ["# V\n```types\nA.B is C\nA.B is D\n```\n", /bound twice/],
    [
      "# V\n```types\nconcrete Person\n  A person.\nconcrete Person\n  Again.\n```\n",
      /declared twice/,
    ],
  ])("rejects malformed vocabulary", (markdown, message) => {
    expect(() => parseApplicationVocabularyDocument(markdown)).toThrow(message);
  });
});

describe("authored application design validation", () => {
  test("checks exact coverage, computation shapes, and vocabulary invariants", () => {
    const document = parseApplicationDesignDocument(
      `# Forum

[refresh](reaction:Forum.Refresh) uses [the feed](view:Forum.Feed),
[its former](former:Forum.FormFeed), and [formatting](computation:formatName).

\`\`\`computations
formatName(person: Person) : String
  Formats a person's name.
\`\`\`
`,
      "design/forum.md",
    );
    const vocabulary = parseApplicationVocabularyDocument(
      `# Vocabulary

\`\`\`types
concrete Person
  An institution identity.

Comments.User is Person
Comments.Target is Posting.Post
\`\`\`
`,
      "design/vocabulary.md",
    );

    expect(
      validateAuthoredApplicationDesign([document], vocabulary, {
        reactions: ["Forum.Refresh"],
        views: ["Forum.Feed"],
        formers: ["Forum.FormFeed"],
        computations: [{ name: "formatName", inputs: [{ name: "person", optional: false }] }],
        concepts: [
          { instance: "Comments", externalTypes: ["User", "Target"] },
          { instance: "Posting", externalTypes: [] },
        ],
      }),
    ).toEqual([]);
  });

  test("returns independent resolution, coverage, computation, and vocabulary issues", () => {
    const document = parseApplicationDesignDocument(
      `# Design

[wrong](reaction:Forum.Wrong) and [missing computation](computation:missing).

\`\`\`computations
extra(value?: String) : String
  Returns a value.
\`\`\`
`,
      "design.md",
    );
    const vocabulary = parseApplicationVocabularyDocument(
      `# Vocabulary

\`\`\`types
concrete Unused
  A defined but unused type.

Comments.User is Other.External
\`\`\`
`,
      "vocabulary.md",
    );
    const codes = validateAuthoredApplicationDesign([document], vocabulary, {
      reactions: ["Forum.Expected"],
      views: [],
      formers: [],
      computations: [{ name: "extra", inputs: [{ name: "value", optional: false }] }],
      concepts: [
        { instance: "Comments", externalTypes: ["User", "Target"] },
        { instance: "Other", externalTypes: ["External"] },
      ],
    }).map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_LINK",
        "MISSING_COVERAGE",
        "COMPUTATION_INPUT_MISMATCH",
        "EXTERNAL_TARGET",
        "MISSING_BINDING",
        "UNUSED_CONCRETE",
      ]),
    );
  });

  test("reports duplicate and unselected computations and every invalid binding category", () => {
    const first = parseApplicationDesignDocument(
      `# First

[run](reaction:Forum.Run).

\`\`\`computations
extra() : String
  Produces extra text.
duplicate() : String
  First definition.
\`\`\`
`,
      "first.md",
    );
    const second = parseApplicationDesignDocument(
      `# Second

[run](reaction:Forum.Run).

\`\`\`computations
duplicate() : String
  Second definition.
\`\`\`
`,
      "second.md",
    );
    const vocabulary = parseApplicationVocabularyDocument(
      `# Vocabulary

\`\`\`types
concrete Person
  A person.
Unknown.User is Person
Comments.Missing is Person
Comments.User is MissingType
Comments.Target is Absent.Value
\`\`\`
`,
      "vocabulary.md",
    );

    const codes = validateAuthoredApplicationDesign([first, second], vocabulary, {
      reactions: ["Forum.Run"],
      views: [],
      formers: [],
      computations: [{ name: "selected" }],
      concepts: [{ instance: "Comments", externalTypes: ["User", "Target", "Unbound"] }],
    }).map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_COMPUTATION",
        "UNREGISTERED_COMPUTATION",
        "MISSING_COVERAGE",
        "UNKNOWN_EXTERNAL",
        "UNRESOLVED_TYPE_TARGET",
        "MISSING_BINDING",
      ]),
    );
  });
});
