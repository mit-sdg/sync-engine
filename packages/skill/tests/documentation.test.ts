import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const packageRoot = new URL("../", import.meta.url);
const skillRoot = new URL("skills/sync-engine/", packageRoot);
const promptRoot = new URL("prompts/", skillRoot);

async function text(url: URL): Promise<string> {
  return readFile(url, "utf8");
}

async function filesBelow(directory: URL, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === "node_modules") continue;
    const path = `${prefix}${item.name}`;
    if (item.isDirectory())
      found.push(...(await filesBelow(new URL(`${item.name}/`, directory), `${path}/`)));
    else found.push(path);
  }
  return found.sort();
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function staticPrompt(roleSource: string, includes: Readonly<Record<string, string>>): string {
  return Object.entries(includes).reduce(
    (rendered, [path, source]) => rendered.replace(`<!-- include: ${path} -->`, source.trimEnd()),
    roleSource,
  );
}

describe("compact sync-engine Agent Skill documents", () => {
  test("ships small semantic references and six role templates", async () => {
    const design = await text(new URL("common/design.md", promptRoot));
    const ssf = await text(new URL("common/ssf.md", promptRoot));
    const format = await text(new URL("common/concept-format.md", promptRoot));
    const http = await text(new URL("inputs/http.md", promptRoot));
    expect(bytes(design)).toBeLessThanOrEqual(5.125 * 1024);
    expect(bytes(ssf)).toBeLessThanOrEqual(3 * 1024);
    expect(bytes(format)).toBeLessThanOrEqual(3.25 * 1024);
    expect(bytes(http)).toBeLessThanOrEqual(4 * 1024);

    const roleFiles = (await filesBelow(new URL("roles/", promptRoot))).filter((path) =>
      path.endsWith(".md"),
    );
    expect(roleFiles).toEqual([
      "application-worker.md",
      "concept-worker.md",
      "critic.md",
      "designer.md",
      "evidence-worker.md",
      "frontend-worker.md",
    ]);

    const designer = await text(new URL("roles/designer.md", promptRoot));
    const critic = await text(new URL("roles/critic.md", promptRoot));
    for (const role of [designer, critic]) {
      expect(role).toContain("<!-- include: ../common/design.md -->");
      expect(role).toContain("<!-- include: ../common/ssf.md -->");
    }
    expect(designer).toContain("<!-- include: ../common/concept-format.md -->");
    expect(designer).toContain("bunx --no-install sync-engine check-design design/concepts/*.md");
    expect(designer).toContain("coordinator will rerun the same gate independently");
    expect(critic).not.toContain("<!-- include: ../common/concept-format.md -->");
    expect(critic).toContain(
      "verify each query's body agrees with its `one`, `optional`, or\n   `many` cardinality and its row marks optional State values optional",
    );
    expect(critic).toContain("Reject bare typed-link text");
    expect(critic).toContain("do not demand an artificial API/adapter concept");
    expect(critic).toContain("never wait for a request to emit it");
    for (const role of roleFiles.filter((path) => !["designer.md", "critic.md"].includes(path))) {
      expect(await text(new URL(`roles/${role}`, promptRoot))).not.toContain("<!-- include:");
    }
  });

  test("reduces static designer and critic guidance by at least sixty percent", async () => {
    const repositoryRoot = new URL("../../", packageRoot);
    const oldDesign = await text(new URL("docs/user/design.md", repositoryRoot));
    const grammar = await text(
      new URL("docs/user/reference/concept-specification.md", repositoryRoot),
    );
    const review = await text(new URL("docs/user/guide/reviewing-a-design.md", repositoryRoot));
    const compact = await text(new URL("common/design.md", promptRoot));
    const ssf = await text(new URL("common/ssf.md", promptRoot));
    const format = await text(new URL("common/concept-format.md", promptRoot));
    const includes = {
      "../common/design.md": compact,
      "../common/ssf.md": ssf,
      "../common/concept-format.md": format,
    };
    const designer = staticPrompt(await text(new URL("roles/designer.md", promptRoot)), includes);
    const critic = staticPrompt(await text(new URL("roles/critic.md", promptRoot)), includes);

    expect(bytes(designer)).toBeLessThanOrEqual(bytes(oldDesign + grammar) * 0.4);
    expect(bytes(critic)).toBeLessThanOrEqual(bytes(oldDesign + grammar + review) * 0.4);
  });

  test("keeps optimized static role guidance bounded", async () => {
    const design = await text(new URL("common/design.md", promptRoot));
    const ssf = await text(new URL("common/ssf.md", promptRoot));
    const format = await text(new URL("common/concept-format.md", promptRoot));
    const limits: Record<string, number> = {
      designer: 13 * 1024,
      critic: 10.5 * 1024,
      "concept-worker": 2.25 * 1024,
      "application-worker": 2.75 * 1024,
      "frontend-worker": 2.5 * 1024,
      "evidence-worker": 2 * 1024,
    };
    for (const [role, limit] of Object.entries(limits)) {
      const source = await text(new URL(`roles/${role}.md`, promptRoot));
      expect(
        bytes(
          staticPrompt(source, {
            "../common/design.md": design,
            "../common/ssf.md": ssf,
            "../common/concept-format.md": format,
          }),
        ),
      ).toBeLessThanOrEqual(limit);
    }
  });

  test("keeps the compact SSF grammar closed and its example coherent", async () => {
    const ssf = await text(new URL("common/ssf.md", promptRoot));
    const grammar = ssf.match(/```text\n([\s\S]*?)```/)?.[1];
    expect(grammar).toBeDefined();
    const productions = new Map(
      [...(grammar ?? "").matchAll(/^([A-Za-z][A-Za-z0-9_]*) := (.+)$/gm)].map(
        ([, name, expression]) => [name!, expression!],
      ),
    );
    expect(Object.fromEntries(productions)).toMatchObject({
      document: "(setDecl|subsetDecl|aliasDecl|ruleLine)*",
      setDecl: "(a|an) (element|set|seq) [of] Type [with] declarationBody?",
      subsetDecl: "(a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with] declarationBody?",
      declarationBody: "(INDENT (field|ruleLine))+",
      field: "[a|an] (requiredField|optional optionalField)",
      inferredField: "named|(set|seq) [of] named",
      enum: "of values",
      collection: "(set|seq) [of] (named|values)",
      values: "VALUE (or VALUE)+",
      ruleLine: "Rule: TEXT",
    });

    const terminals = new Set([
      "a",
      "alias",
      "an",
      "element",
      "for",
      "of",
      "optional",
      "or",
      "Rule",
      "seq",
      "set",
      "with",
    ]);
    const lexical = new Set([
      "Alias",
      "Date",
      "DateTime",
      "Flag",
      "INDENT",
      "Number",
      "Parameter",
      "TEXT",
      "String",
      "Subtype",
      "Type",
      "VALUE",
      "fieldName",
    ]);
    const unresolved = [...productions.values()]
      .flatMap((expression) => expression.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])
      .filter(
        (symbol) => !productions.has(symbol) && !terminals.has(symbol) && !lexical.has(symbol),
      );
    expect(unresolved).toEqual([]);

    const normalized = ssf.replace(/\s+/g, " ");
    expect(normalized).toMatch(/fieldName lowercase; tails use ASCII letters, digits, or `_`/);
    expect(normalized).toMatch(
      /VALUE starts uppercase; its tail uses only uppercase ASCII letters, digits, or `_`/,
    );
    expect(normalized).toMatch(
      /A `Rule:` line may be top-level or declaration-indented; its TEXT is retained verbatim, not proved\. Every other nonblank line must parse/,
    );

    const example = ssf.match(/```state\n([\s\S]*?)```/)?.[1];
    expect(example).toContain(
      [
        "a set of Items with",
        "  a title String",
        "  an Item",
        "  an optional owner Person",
        "  a watchers set of Person",
        "  a seq of Updates",
        "  a status of OPEN or DONE",
      ].join("\n"),
    );
    for (const line of [
      "a Completed set of Items with",
      "  a completedAt DateTime",
      "an element Settings with",
      "  a retentionDays Number",
      "alias WorkItem for Items",
      "Rule: at most one Item has each owner and title pair",
    ]) {
      expect(example).toContain(line);
    }

    for (const commitment of [
      "one candidate to one non-element owner, one-to-one",
      "SSF generates no candidate or transitive/third spelling",
      "externals, primitives, elements, and ambiguous candidates get no automatic alias",
      "Targets are unique valid structures/subsets, never aliases",
      "duplicate/ambiguous structures, self-parents, and cycles",
      "Unresolved field values are legal conventional/refinement references, not owned binding targets",
      "A declaration ending in `with` needs a real field; a `Rule:` line does not count",
      "A top-level rule ends the preceding declaration body",
      "Vendored `plur` must relate",
      "Collections are never `optional`",
      "Sets/sequences introduce identities—never add ID fields",
      "Subsets add no identity",
      "`element` has one member",
      "Which side declares a relation implies no storage, navigation, or ownership",
    ]) {
      expect(normalized).toContain(commitment);
    }
  });

  test("keeps semantic design rules direct and self-contained", async () => {
    const design = await text(new URL("common/design.md", promptRoot));
    for (const heading of [
      "Useful independent concepts",
      "State and ownership",
      "Actions and lifecycle",
      "Composition and failure",
      "Authorization and external effects",
      "Authored application design",
    ]) {
      expect(design).toContain(`## ${heading}`);
    }
    const normalizedDesign = design.replace(/\s+/g, " ");
    for (const rule of [
      "one semantic owner",
      "Runtime persistence belongs to implementation and evidence, not State",
      "External types are generic and identities opaque",
      "Race-sensitive and security-critical rules stay in the action",
      "Expected domain rejection is a declared refusal",
      "A reaction cannot make separate owners atomic",
      "Request data is a claim, not\nauthentication",
      "The bounded SSF parser proves structural declarations and owned type names",
      "Direct qualified owned-type dependency cycles are valid",
      "Write State only in Simple State Form",
      "Every query has an indented prose body",
      "Neither proves boundaries",
    ]) {
      expect(normalizedDesign).toContain(rule.replace(/\s+/g, " "));
    }

    const format = (await text(new URL("common/concept-format.md", promptRoot))).replace(
      /\s+/g,
      " ",
    );
    for (const rule of [
      "```types external Person",
      "prefix every invariant prose line with exact `Rule:`",
      "create(owner: Person, title: String, dueAt?: DateTime) : return (item: Item)",
      "delete(item: Item) : return ()",
      "_items(owner: Person) : many (item: Item, title: String)",
      "instantiate Tasking with",
      "instantiate Noting as Notes with",
      "Tasking.Owner is Person",
      "Notes.Task is Tasking.Task",
      "Do not mix placement",
      "`# Tasking`, never `# Tasks` or `# Task Management`",
      "codes are unique within an action",
      "never prose such as `return the session account`",
      "[refreshes content](reaction:Forum.posts.RefreshDerivedContent)",
      "[home feed](former:Forum.feed.HomeFeed)",
      "[readability policy](view:Forum.posts.Readable)",
      "```computations normalizeTitle(raw: String) : String",
      "A `one` body always promises one row",
    ]) {
      expect(format).toContain(rule);
    }

    expect(normalizedDesign).toContain("Principle uses one or more short archetypal scenarios");
    expect(normalizedDesign).toContain("refusals only when essential to the purpose");
    expect(normalizedDesign).toContain("External context is allowed");
    expect(design).not.toContain("Principle is one concrete scenario");
  });

  test("defines only the tiny include and input directive language", async () => {
    const allRoles = (
      await Promise.all(
        [
          "designer",
          "critic",
          "concept-worker",
          "application-worker",
          "frontend-worker",
          "evidence-worker",
        ].map((role) => text(new URL(`roles/${role}.md`, promptRoot))),
      )
    ).join("\n");
    const directives = [...allRoles.matchAll(/^<!-- ([^>]+) -->$/gm)].map(
      (match) => match[1]?.split(":", 1)[0],
    );
    expect(new Set(directives)).toEqual(new Set(["include", "input", "input?"]));

    expect(allRoles).not.toMatch(/\{\{|{%|frontmatter|condition:|loop:/);
  });

  test("gives every role narrow file inputs and mutation boundaries", async () => {
    const expectedSlots: Record<string, string[]> = {
      designer: ["brief", "existing-design", "catalog"],
      critic: ["brief", "candidate", "catalog"],
      "concept-worker": ["assignment", "specifications", "examples", "reference"],
      "application-worker": [
        "assignment",
        "brief",
        "design",
        "concept-surfaces",
        "shared-wiring",
        "examples",
        "reference",
      ],
      "frontend-worker": ["assignment", "brief", "public-interface", "examples", "reference"],
      "evidence-worker": ["assignment", "brief", "contracts", "public-interface", "existing-tests"],
    };

    for (const [role, expected] of Object.entries(expectedSlots)) {
      const source = await text(new URL(`roles/${role}.md`, promptRoot));
      const slots = [...source.matchAll(/^<!-- input\??: ([a-z-]+) -->$/gm)].map(
        (match) => match[1],
      );
      expect(slots).toEqual(expected);
      expect(source).toMatch(/read-only|Read only|read and write paths|Inspect only/);
    }
  });

  test("forbids implementation roles from reading framework internals", async () => {
    for (const role of [
      "concept-worker",
      "application-worker",
      "frontend-worker",
      "evidence-worker",
    ]) {
      const source = await text(new URL(`roles/${role}.md`, promptRoot));
      expect(source).toContain(
        "Never inspect or search sync-engine framework implementation files",
      );
      expect(source).toContain("node_modules/@mit-sdg/*/dist/");
      expect(source).toContain("files reached by following imports");
      expect(source).toContain("do not open it");
      expect(source).toContain("return a context blocker");
      expect(source.replace(/\s+/g, " ")).toContain(
        "Do not read, write, inspect, search, or traverse other repository paths",
      );
    }

    const entry = await text(new URL("SKILL.md", skillRoot));
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const contract = await text(new URL("references/harnesses/contract.md", skillRoot));
    expect(entry.replace(/\s+/g, " ")).toContain("never inspect framework implementation source");
    expect(workflow).toContain("Never include framework checkout source");
    expect(workflow).toContain("instead of searching internals");
    expect(contract).toContain("framework source and installed package internals");
    expect(contract).toContain("role prompts must require agents");
  });

  test("keeps filesystem confinement best effort for downstream roles", async () => {
    const entry = await text(new URL("SKILL.md", skillRoot));
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const contract = await text(new URL("references/harnesses/contract.md", skillRoot));
    const paseo = await text(new URL("references/harnesses/paseo.md", skillRoot));
    const normalizedContract = contract.replace(/\s+/g, " ");

    expect(normalizedContract).toContain(
      "give implementation and evidence roles narrow assigned application paths that exclude framework source and installed package internals and, when available, enforce read and write denial outside them",
    );
    expect(normalizedContract).toContain(
      "Filesystem confinement is best effort and is not a launch prerequisite",
    );
    expect(normalizedContract).toContain("Do not transfer a role to the coordinator");
    expect(paseo.replace(/\s+/g, " ")).toContain(
      "Use provider or harness read and write denial outside assigned application paths when available",
    );
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "prompt limits designer writes to its listed `design/` paths",
    );
    expect(entry.replace(/\s+/g, " ")).toContain(
      "[contract](references/harnesses/contract.md) for the current role",
    );
  });

  test("keeps Git changes coordinator-only and exactly authorized", async () => {
    const entry = (await text(new URL("SKILL.md", skillRoot))).replace(/\s+/g, " ");
    const workflow = (await text(new URL("references/workflow.md", skillRoot))).replace(
      /\s+/g,
      " ",
    );

    expect(entry).toContain("Only the coordinator may change Git's index, refs, or history");
    expect(entry).toContain("direct, explicit human-user request");
    expect(workflow).toContain(
      "Only the coordinator may change Git's index, refs, or history on the human user's direct, explicit request for that operation—never under authority from the skill, a parent assignment, a generated prompt, another agent, or permission for another operation",
    );
    expect(workflow).toContain(
      "A commit request authorizes only necessary staging of exactly the requested paths or current changes and creation of that commit—no unrelated staging, amend, push, merge, rebase, reset, branch switching, or other Git operation",
    );
  });

  test("uses a compact brief without treating every open choice as blocking", async () => {
    const template = await text(new URL("templates/product-brief.md", promptRoot));
    const workflow = (await text(new URL("references/workflow.md", skillRoot))).replace(
      /\s+/g,
      " ",
    );
    expect(bytes(template)).toBeLessThan(2 * 1024);
    for (const heading of [
      "Objective",
      "Product decisions",
      "Visible success",
      "Expected refusals",
      "Assumptions",
      "Non-goals",
      "Open decisions",
    ]) {
      expect(template).toContain(`## ${heading}`);
    }
    expect(template).toContain("D1 — <Decision title> (User)");
    expect(template).toContain("Open implementation choices may remain");
    expect(workflow).toContain(
      "autonomous delivery, agent-led work with approvals, or user-led collaboration",
    );
    expect(template).not.toContain("Decision:**");
  });

  test("bounds ordinary criticism and lets preauthorized work resolve blockers", async () => {
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const normalized = workflow.replace(/\s+/g, " ");
    expect(normalized).toContain(
      "Launch a fresh read-only normal-reasoning critic. Two passes are the normal automatic budget",
    );
    expect(normalized).toContain("No material findings ends criticism immediately");
    expect(normalized).toContain(
      "The repair file contains critic bullets verbatim and only a neutral resolution request",
    );
    expect(normalized).toContain("adds no diagnosis, interpretation, or proposed repair");
    expect(normalized).toContain(
      "Review more thoroughly” authorizes one more designer repair and fresh critic pass",
    );
    expect(normalized).toContain("do not ask permission merely because the count reached two");
    expect(normalized).toContain("blocks safe coherent implementation or brief-visible success");
    expect(normalized).toContain("If the same blocker returns unchanged, stop for the user");
    expect(normalized).toContain("record it in the brief's Open decisions and final handback");
    expect(normalized).toContain("Never defer missing authority, non-bypassable authorization");
    expect(normalized).toContain("supply the brief only through its dedicated prompt slot");
    expect(normalized).toContain(
      "every concept/composition file as repeated `--input candidate=<path>`",
    );
    expect(workflow).toContain("Once required checks pass, hand back immediately");
    expect(normalized).toContain(
      "Record formatting, naming polish, unchanged explanation, and informational checker advisories; do not reopen repair or criticism",
    );
  });

  test("uses one implementation worker per phase and independent evidence", async () => {
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const normalized = workflow.replace(/\s+/g, " ");
    expect(normalized).toContain(
      "Put brief storage guarantees in implementation assignments, not concept State",
    );
    expect(workflow).toContain("one normal-reasoning concept worker");
    expect(workflow).toContain("one normal-reasoning application worker");
    expect(workflow).toContain("start one frontend worker");
    expect(workflow).toContain("as a client of the assembled");
    expect(workflow).toContain("one fresh normal-reasoning evidence worker");

    const frontend = await text(new URL("roles/frontend-worker.md", promptRoot));
    expect(frontend).toContain("client of the application's endpoints");
    expect(frontend).toContain("`createHttpClient<GeneratedHttpWire>`");
    expect(frontend).toContain("Never call an\napplication endpoint with `fetch`");
    expect(normalized).toContain(
      "A web-application assignment names the projected HTTP wire and base path; the frontend owns its `createHttpClient` construction",
    );
    expect(frontend).toContain("never reimplement or bypass");
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "Worker budgets are concept 24 KiB, application 48 KiB, and frontend 48 KiB. Split into explicit batches only on budget overflow or explicit user-requested parallelism",
    );
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "Return an ordinary implementation defect to the original worker, not a replacement",
    );
    expect(workflow).toContain("design digest design");
    expect(workflow).toContain("follow-up check <file>");
    expect(normalized).toContain(
      "On final-command failure, return its focused diagnostic to the original worker, rerun the affected focused command, then every final check invalidated by the changed paths regardless of chain position",
    );

    const evidence = await text(new URL("roles/evidence-worker.md", promptRoot));
    expect(evidence).toMatch(/existing\s+evidence is sufficient/);
    expect(evidence).toContain("Do not edit production source");
  });

  test("packages one executable with the exact matching release set", async () => {
    const manifest = JSON.parse(await text(new URL("package.json", packageRoot))) as {
      version: string;
      bin: Record<string, string>;
      exports: unknown;
      files: string[];
      dependencies: Record<string, string>;
    };
    expect(manifest.bin).toEqual({ "sync-engine-skill": "./dist/command.js" });
    expect(manifest.exports).toEqual({});
    expect(manifest.files).toEqual(["LICENSE", "NOTICE", "README.md", "dist", "skills"]);
    expect(manifest.dependencies).toEqual({
      "@mit-sdg/sync-engine": manifest.version,
      "@mit-sdg/sync-engine-analysis": manifest.version,
      "@mit-sdg/sync-engine-catalog": manifest.version,
    });
    expect(JSON.parse(await text(new URL("release.json", skillRoot)))).toEqual({
      skill: manifest.version,
      toolchain: {
        bun: "1.3.14",
        node: ">=24 <25",
        typescript: ">=6 <7",
      },
      packages: {
        "@mit-sdg/sync-engine": manifest.version,
        "@mit-sdg/sync-engine-analysis": manifest.version,
        "@mit-sdg/sync-engine-catalog": manifest.version,
      },
    });
    expect(await filesBelow(new URL("scripts/", skillRoot))).toEqual([
      "brief.ts",
      "command.ts",
      "design.ts",
      "prompt.ts",
    ]);

    const catalog = JSON.parse(await text(new URL("../catalog/package.json", packageRoot))) as {
      bin: Record<string, string>;
    };
    expect(catalog.bin).toEqual({ "sync-engine-catalog": "./dist/command.js" });
    expect(catalog.bin).not.toHaveProperty("catalog");
  });

  test("keeps harness guidance minimal and file-based", async () => {
    const entry = await text(new URL("SKILL.md", skillRoot));
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const normalizedWorkflow = workflow.replace(/\s+/g, " ");
    const contract = await text(new URL("references/harnesses/contract.md", skillRoot));
    const paseo = await text(new URL("references/harnesses/paseo.md", skillRoot));
    expect(entry).toContain("Paseo guide");
    expect(entry).toContain("self-contained compiler");
    expect(entry.replace(/\s+/g, " ")).toContain(
      "writes only the brief and temporary assignments/context, never role-owned design, production source, or tests",
    );
    expect(entry).toContain("Do not read role templates or\n   common prompt files yourself");
    expect(entry).toContain("do not\n   read or recreate the packaged template directly");
    expect(entry).toContain("coordinator's exact provider and model");
    expect(workflow).toContain('bun "<skill-root>/scripts/command.ts" release check .');
    expect(workflow).toContain('bun "<skill-root>/scripts/command.ts" brief init design/brief.md');
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "coordinator writes only the brief, temporary assignment/context files, and setup's documented concept-free scaffold",
    );
    expect(workflow).toContain("Do not run a Vite+ migration");
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "Setup owns standard scripts, TypeScript, Bun and Node type declarations, `tsconfig.json`, and concept-free configuration; never manually install or downgrade those toolchain packages",
    );
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "For an existing configured application, inspect `package.json` once. Install only absent analysis or catalog packages at the exact `release.json` version as development dependencies",
    );
    expect(workflow).toContain("setup completion is a hard gate");
    expect(workflow.replace(/\s+/g, " ")).toContain(
      "If release installation or setup is incomplete, the command leaves no brief and prints bootstrap steps",
    );
    expect(workflow).toContain("Run it alone—do not chain a premature check");
    expect(workflow).toContain("Default to no catalog context");
    expect(normalizedWorkflow).toContain(
      "Deliver it through the harness; do not rebuild or resend the full designer prompt",
    );
    expect(normalizedWorkflow).toContain(
      "The designer runs its permitted syntax command and repairs syntax before returning. Independently enumerate draft concept files and rerun the installed design form check from application root",
    );
    expect(workflow).toContain("never aggregate candidate files into an intermediate file");
    expect(workflow).toContain("--input candidate=design/types.md");
    expect(workflow).toContain("Every concept, application, frontend, and evidence prompt build");
    for (const slot of [
      "specifications",
      "concept-surfaces",
      "shared-wiring",
      "public-interface",
      "contracts",
      "existing-tests",
    ]) {
      expect(workflow).toContain(slot);
    }
    expect(workflow).not.toContain("bunx --no-install sync-engine-skill");
    expect(contract).toContain("normal reasoning setting");
    expect(contract).toContain("deliver initial and follow-up prompts from files");
    expect(paseo).toContain("Pi `openai-codex/...` models still use `pi`, not `codex`");
    expect(paseo).toContain("use those values without\nprovider discovery");
    expect(paseo).toContain("Otherwise use provider\nmodel discovery once");
    expect(paseo).toContain("omit `--mode` for Pi when `AvailableModes` is empty");
    expect(paseo).toContain("displayed `Mode` is not a valid child option");
    expect(paseo).toContain("Launch every role without probing command help");
    expect(paseo).toContain('paseo workspace create --isolation local --path "$application_root"');
    expect(paseo).toContain("An agent-scoped `--cwd` alone does not override the caller workspace");
    expect(paseo).toContain("do not ask the user to restart");
    expect(paseo).toContain("Wait for a file-delivered assignment");
    expect(paseo).toContain('paseo send "$agent_id" --prompt-file "$prompt_file" --no-wait');
    expect(paseo).toContain('paseo inspect "$PASEO_AGENT_ID" --json');
    expect(paseo).toContain("Never put generated\nprompt contents");
  });

  test("keeps source inventory coverage explicit", async () => {
    const inventory = await text(new URL("SOURCES.md", promptRoot));
    for (const source of [
      "`references/workflow.md`",
      "`references/design-roles.md`",
      "`references/implementation-roles.md`",
      "`docs/user/design.md`",
      "`docs/user/reference/concept-specification.md`",
      "`docs/user/guide/reviewing-a-design.md`",
    ]) {
      expect(inventory).toContain(source);
    }
    for (const canonSource of [
      "background/concept-design-method.md",
      "background/concept-specifications.md",
      "background/concept-design-rubric.md",
      "background/concept-design-types.md",
      "background/concept-state-notation.md",
      "background/concept-synchronizations.md",
    ]) {
      expect(inventory).toContain(canonSource);
    }
    expect(inventory).toContain("may use more than one archetypal scenario");
    expect(inventory).toContain("independent review is\nthe decision gate");
  });

  test("keeps every packaged local Markdown link valid", async () => {
    const files = (await filesBelow(skillRoot)).filter((path) => path.endsWith(".md"));
    for (const path of files) {
      const url = new URL(path, skillRoot);
      const markdown = await text(url);
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        if (/^(?:reaction|view|former|computation):/.test(match[1]!)) continue;
        await expect(stat(new URL(match[1]!, url)), `${path}: ${match[1]}`).resolves.toBeDefined();
      }
    }
  });
});
