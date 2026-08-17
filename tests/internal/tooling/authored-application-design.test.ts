import { describe, expect, test } from "vite-plus/test";
import {
  parseApplicationDesignDocument,
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

describe("application instance and type declarations", () => {
  test("parses bare, renamed, inline, and detached forms with exact provenance", () => {
    const typesDocument = parseApplicationDesignDocument(
      `# Forum application types

Institution identities are used throughout. [refresh](reaction:Forum.Refresh)

\`\`\`types
concrete Person
  A stable identity supplied by the institution.
\`\`\`

\`\`\`instances
instantiate Posting
instantiate Commenting as PostComments with
  Target is Posting.Post
\`\`\`
Authors are institution identities.
\`\`\`bindings
PostComments.User is Person
\`\`\`

\`\`\`computations
formatName(person: Person) : String
  Formats a person's public name.
\`\`\`
`,
      "design/types.md",
    );

    expect(typesDocument.concreteTypes).toEqual([
      {
        name: "Person",
        definition: "A stable identity supplied by the institution.",
        location: { source: "design/types.md", line: 6, column: 1 },
      },
    ]);
    expect(typesDocument.instances).toEqual([
      expect.objectContaining({
        definition: "Posting",
        instance: "Posting",
        bindings: [],
        location: { source: "design/types.md", line: 11, column: 1 },
      }),
      expect.objectContaining({
        definition: "Commenting",
        instance: "PostComments",
        bindings: [
          expect.objectContaining({
            placement: "inline",
            external: "Target",
            target: { kind: "qualified", instance: "Posting", type: "Post" },
            location: { source: "design/types.md", line: 13, column: 3 },
          }),
        ],
      }),
    ]);
    expect(typesDocument.bindings).toEqual([
      expect.objectContaining({
        instance: "PostComments",
        external: "User",
        placement: "detached",
        target: { kind: "concrete", name: "Person" },
        location: { source: "design/types.md", line: 17, column: 1 },
      }),
    ]);
    expect(typesDocument.computations).toHaveLength(1);
  });

  test("combines declarations across documents and reports global duplicates", () => {
    const concrete = parseApplicationDesignDocument(
      "# Shared types\n\n```types\nconcrete Person\n  An application identity.\n```\n",
      "types.md",
    );
    const instances = parseApplicationDesignDocument(
      "# Instances\n\n```instances\ninstantiate Commenting as Comments\n```\n",
      "instances.md",
    );
    const bindings = parseApplicationDesignDocument(
      "# Identity bindings\n\n```bindings\nComments.User is Person\n```\n",
      "comments.md",
    );
    const duplicate = parseApplicationDesignDocument(
      "# Duplicate declarations\n\n```types\nconcrete Person\n  A duplicate identity.\n```\n```instances\ninstantiate Commenting as Comments\n```\n```bindings\nComments.User is Person\n```\n",
      "duplicate.md",
    );
    const selected = {
      reactions: [],
      views: [],
      formers: [],
      computations: [],
      concepts: [{ instance: "Comments", definition: "Commenting", externalTypes: ["User"] }],
    };

    expect(validateAuthoredApplicationDesign([concrete, bindings, instances], selected)).toEqual(
      [],
    );
    expect(
      validateAuthoredApplicationDesign([concrete, bindings, instances, duplicate], selected).map(
        ({ code }) => code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "DUPLICATE_CONCRETE_TYPE",
        "DUPLICATE_INSTANCE",
        "DUPLICATE_EXTERNAL_BINDING",
      ]),
    );
  });

  test("accepts an instances-only application document", () => {
    expect(
      parseApplicationDesignDocument("# Inventory\n\n```instances\ninstantiate Timing\n```\n")
        .instances,
    ).toHaveLength(1);
  });

  test("merges detached declarations without depending on document order", () => {
    const declaration = parseApplicationDesignDocument(
      "# Inventory\n\n```instances\ninstantiate Commenting as Comments\n```\n",
      "instances.md",
    );
    const binding = parseApplicationDesignDocument(
      "# Bindings\n\n```bindings\nComments.User is Person\n```\n",
      "bindings.md",
    );
    const concrete = parseApplicationDesignDocument(
      "# Types\n\n```types\nconcrete Person\n  A person.\n```\n",
      "types.md",
    );
    const selected = {
      reactions: [],
      views: [],
      formers: [],
      computations: [],
      concepts: [{ instance: "Comments", definition: "Commenting", externalTypes: ["User"] }],
    };
    expect(validateAuthoredApplicationDesign([binding, concrete, declaration], selected)).toEqual(
      [],
    );
    expect(validateAuthoredApplicationDesign([declaration, binding, concrete], selected)).toEqual(
      [],
    );
  });

  test("reports mixed placement together with independently actionable semantic gaps", () => {
    const mixed = parseApplicationDesignDocument(
      `# Mixed

\`\`\`types
concrete Person
  A person.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments with
  User is Person
\`\`\`

\`\`\`bindings
Comments.User is Person
\`\`\`
`,
      "mixed.md",
    );
    expect(
      validateAuthoredApplicationDesign([mixed], {
        reactions: [],
        views: [],
        formers: [],
        computations: [],
        concepts: [
          {
            instance: "Comments",
            definition: "Commenting",
            externalTypes: ["User", "Target"],
          },
        ],
      }).map(({ code }) => code),
    ).toEqual(["MIXED_BINDING_PLACEMENT", "MISSING_EXTERNAL_BINDING"]);
  });

  test("treats zero-external bindings as unknown without inventing a placement mode", () => {
    const document = parseApplicationDesignDocument(
      `# No external parameters

\`\`\`types
concrete Person
  A person.
\`\`\`

\`\`\`instances
instantiate Timing with
  UnknownInline is Person
\`\`\`

\`\`\`bindings
Timing.UnknownDetached is Person
\`\`\`
`,
      "zero-external.md",
    );
    expect(
      validateAuthoredApplicationDesign([document], {
        reactions: [],
        views: [],
        formers: [],
        computations: [],
        concepts: [{ instance: "Timing", definition: "Timing", externalTypes: [] }],
      }).map(({ code }) => code),
    ).toEqual(["UNKNOWN_EXTERNAL_BINDING", "UNKNOWN_EXTERNAL_BINDING"]);
  });

  test("retains unknown-binding diagnostics when invalid names also mix placement", () => {
    const document = parseApplicationDesignDocument(
      `# Unknown mixed bindings

\`\`\`types
concrete Person
  A person.
\`\`\`

\`\`\`instances
instantiate Linking with
  UnknownInline is Person
\`\`\`

\`\`\`bindings
Linking.UnknownDetached is Person
\`\`\`
`,
      "unknown-mixed.md",
    );
    expect(
      validateAuthoredApplicationDesign([document], {
        reactions: [],
        views: [],
        formers: [],
        computations: [],
        concepts: [{ instance: "Linking", definition: "Linking", externalTypes: ["Required"] }],
      }).map(({ code }) => code),
    ).toEqual([
      "MIXED_BINDING_PLACEMENT",
      "UNKNOWN_EXTERNAL_BINDING",
      "UNKNOWN_EXTERNAL_BINDING",
      "MISSING_EXTERNAL_BINDING",
    ]);
  });

  test.each([
    ["# V\n", /must cite/],
    ["# V\n```types\nconcrete Person\n```\n", /prose definition/],
    ["# V\n```types\nA.B is C\n```\n", /accepts only/],
    ["# V\n```instances\ninstantiate A with\n```\n", /empty `with`/],
    ["# V\n```instances\ninstantiate A\n  User is Person\n```\n", /without `with`/],
    ["# V\n```bindings\nA.User is B.External.More\n```\n", /accepts only/],
    [
      "# V\n```bindings\nA.User is Person\n  Explanations belong outside this fence.\n```\n",
      /declarations only/,
    ],
  ])("rejects malformed declaration forms", (markdown, message) => {
    expect(() => parseApplicationDesignDocument(markdown)).toThrow(message);
  });

  test.each([
    ["concrete name", "```types\nconcrete Person-Type\n  Invalid.\n```"],
    ["instance name", "```instances\ninstantiate Posting as Forum-Posts\n```"],
    ["qualified target instance", "```bindings\nComments.User is Forum-Posts.Post\n```"],
    ["concrete target", "```bindings\nComments.User is App-Person\n```"],
  ])("rejects a hyphenated %s", (_name, fence) => {
    expect(() => parseApplicationDesignDocument(`# Invalid\n\n${fence}\n`)).toThrow();
  });
});

describe("authored application design validation", () => {
  test("checks exact coverage, computation shapes, and application-type invariants", () => {
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
    const typesDocument = parseApplicationDesignDocument(
      `# Vocabulary

\`\`\`types
concrete Person
  An institution identity.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments with
  User is Person
  Target is Posting.Post
instantiate Posting
\`\`\`
`,
      "design/types.md",
    );

    expect(
      validateAuthoredApplicationDesign([document, typesDocument], {
        reactions: ["Forum.Refresh"],
        views: ["Forum.Feed"],
        formers: ["Forum.FormFeed"],
        computations: [{ name: "formatName", inputs: [{ name: "person", optional: false }] }],
        concepts: [
          { instance: "Comments", definition: "Commenting", externalTypes: ["User", "Target"] },
          { instance: "Posting", definition: "Posting", externalTypes: [] },
        ],
      }),
    ).toEqual([]);
  });

  test("returns independent resolution, coverage, computation, and application-type issues", () => {
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
    const typesDocument = parseApplicationDesignDocument(
      `# Vocabulary

\`\`\`types
concrete Unused
  A defined but unused type.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments with
  User is Other.External
instantiate Other
\`\`\`
`,
      "types.md",
    );
    const codes = validateAuthoredApplicationDesign([document, typesDocument], {
      reactions: ["Forum.Expected"],
      views: [],
      formers: [],
      computations: [{ name: "extra", inputs: [{ name: "value", optional: false }] }],
      concepts: [
        { instance: "Comments", definition: "Commenting", externalTypes: ["User", "Target"] },
        { instance: "Other", definition: "Other", externalTypes: ["External"] },
      ],
    }).map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_LINK",
        "MISSING_COVERAGE",
        "COMPUTATION_INPUT_MISMATCH",
        "EXTERNAL_BINDING_TARGET",
        "MISSING_EXTERNAL_BINDING",
        "UNUSED_CONCRETE_TYPE",
      ]),
    );
  });

  test("compares authored definitions and instances exactly without mismatch cascades", () => {
    const document = parseApplicationDesignDocument(
      `# Inventory

\`\`\`instances
instantiate Categorizing as TaskLists with
  Item is MissingType
instantiate Timing as Extra
\`\`\`
`,
      "inventory.md",
    );
    const issues = validateAuthoredApplicationDesign([document], {
      reactions: [],
      views: [],
      formers: [],
      computations: [],
      concepts: [
        {
          instance: "TaskLists",
          definition: "Tagging",
          externalTypes: ["Member"],
        },
        { instance: "SelectedOnly", definition: "Timing", externalTypes: [] },
      ],
    });
    expect(issues.map(({ code }) => code)).toEqual([
      "INSTANCE_DEFINITION_MISMATCH",
      "UNSELECTED_INSTANCE",
      "UNDECLARED_SELECTED_INSTANCE",
    ]);
    expect(issues.some(({ code }) => code === "UNRESOLVED_BINDING_TARGET")).toBe(false);
    expect(issues.some(({ code }) => code === "MISSING_EXTERNAL_BINDING")).toBe(false);
  });

  test("accepts direct owned-target cycles and uses the optional SSF owned-name seam", () => {
    const document = parseApplicationDesignDocument(
      `# Cyclic inventory

\`\`\`instances
instantiate Alpha with
  Peer is Beta.BetaIdentity
instantiate Beta with
  Peer is Alpha.AlphaIdentity
\`\`\`
`,
      "cycles.md",
    );
    const selected = {
      reactions: [],
      views: [],
      formers: [],
      computations: [],
      concepts: [
        {
          instance: "Alpha",
          definition: "Alpha",
          externalTypes: ["Peer"],
          ownedTypes: ["AlphaIdentity"],
        },
        {
          instance: "Beta",
          definition: "Beta",
          externalTypes: ["Peer"],
          ownedTypes: ["BetaIdentity"],
        },
      ],
    };
    expect(validateAuthoredApplicationDesign([document], selected)).toEqual([]);
    const typo = parseApplicationDesignDocument(
      `# Typo

\`\`\`instances
instantiate Alpha with
  Peer is Beta.BetaIdentitx
instantiate Beta with
  Peer is Alpha.AlphaIdentity
\`\`\`
`,
      "typo.md",
    );
    expect(validateAuthoredApplicationDesign([typo], selected)).toEqual([
      expect.objectContaining({ code: "UNRESOLVED_BINDING_TARGET" }),
    ]);
    const withoutSsf = {
      ...selected,
      concepts: selected.concepts.map(({ ownedTypes: _ownedTypes, ...concept }) => concept),
    };
    expect(validateAuthoredApplicationDesign([typo], withoutSsf)).toEqual([]);
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
    const typesDocument = parseApplicationDesignDocument(
      `# Vocabulary

\`\`\`types
concrete Person
  A person.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments with
  Missing is Person
  User is MissingType
  Target is Absent.Value
\`\`\`

\`\`\`bindings
Unknown.User is Person
\`\`\`
`,
      "types.md",
    );

    const codes = validateAuthoredApplicationDesign([first, second, typesDocument], {
      reactions: ["Forum.Run"],
      views: [],
      formers: [],
      computations: [{ name: "selected" }],
      concepts: [
        {
          instance: "Comments",
          definition: "Commenting",
          externalTypes: ["User", "Target", "Unbound"],
        },
      ],
    }).map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_COMPUTATION",
        "UNREGISTERED_COMPUTATION",
        "MISSING_COVERAGE",
        "UNDECLARED_BINDING_INSTANCE",
        "UNKNOWN_EXTERNAL_BINDING",
        "UNRESOLVED_BINDING_TARGET",
        "MISSING_EXTERNAL_BINDING",
      ]),
    );
  });
});
