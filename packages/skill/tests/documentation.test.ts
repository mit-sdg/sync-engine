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
  test("ships three small semantic references and five role templates", async () => {
    const design = await text(new URL("common/design.md", promptRoot));
    const ssf = await text(new URL("common/ssf.md", promptRoot));
    const format = await text(new URL("common/concept-format.md", promptRoot));
    expect(bytes(design)).toBeLessThanOrEqual(5 * 1024);
    expect(bytes(ssf)).toBeLessThanOrEqual(1.5 * 1024);
    expect(bytes(format)).toBeLessThanOrEqual(2.25 * 1024);

    const roleFiles = (await filesBelow(new URL("roles/", promptRoot))).filter((path) =>
      path.endsWith(".md"),
    );
    expect(roleFiles).toEqual([
      "application-worker.md",
      "concept-worker.md",
      "critic.md",
      "designer.md",
      "evidence-worker.md",
    ]);

    const designer = await text(new URL("roles/designer.md", promptRoot));
    const critic = await text(new URL("roles/critic.md", promptRoot));
    for (const role of [designer, critic]) {
      expect(role).toContain("<!-- include: ../common/design.md -->");
      expect(role).toContain("<!-- include: ../common/ssf.md -->");
    }
    expect(designer).toContain("<!-- include: ../common/concept-format.md -->");
    expect(critic).not.toContain("<!-- include: ../common/concept-format.md -->");
    expect(critic).toContain("check query cardinality/body agreement");
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
      designer: 10 * 1024,
      critic: 8.25 * 1024,
      "concept-worker": 2.25 * 1024,
      "application-worker": 2.75 * 1024,
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
      "State is unparsed in version 1",
      "Write State only in Simple State Form",
      "Every query has an indented prose body",
      "Neither proves boundaries",
    ]) {
      expect(normalizedDesign).toContain(rule.replace(/\s+/g, " "));
    }

    const ssf = (await text(new URL("common/ssf.md", promptRoot))).replace(/\s+/g, " ");
    for (const rule of [
      "Sets introduce identities—never add ID fields",
      "Subsets classify existing parent members",
      "Collections are never `optional`",
      "No nested collections or unions",
      "Declaration direction implies no storage, navigation, or ownership",
    ]) {
      expect(ssf).toContain(rule);
    }
    const format = (await text(new URL("common/concept-format.md", promptRoot))).replace(
      /\s+/g,
      " ",
    );
    for (const rule of [
      "```types external Person",
      "create(owner: Person, title: String, dueAt?: DateTime) : return (item: Item)",
      "delete(item: Item) : return ()",
      "_items(owner: Person) : many (item: Item, title: String)",
      "Tasking.Owner is Person",
      "Notes.Task is Tasking.Task",
      "codes are unique within an action",
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
        ["designer", "critic", "concept-worker", "application-worker", "evidence-worker"].map(
          (role) => text(new URL(`roles/${role}.md`, promptRoot)),
        ),
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
    for (const role of ["concept-worker", "application-worker", "evidence-worker"]) {
      const source = await text(new URL(`roles/${role}.md`, promptRoot));
      expect(source).toContain(
        "Never inspect or search sync-engine framework implementation files",
      );
      expect(source).toContain("node_modules/@mit-sdg/*/dist/");
      expect(source).toContain("files reached by following imports");
      expect(source).toContain("do not open it");
      expect(source).toContain("return a context blocker");
    }

    const entry = await text(new URL("SKILL.md", skillRoot));
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const contract = await text(new URL("references/harnesses/contract.md", skillRoot));
    expect(entry).toContain("never inspect framework implementation source");
    expect(workflow).toContain("Never include framework checkout source");
    expect(workflow).toContain("instead of searching internals");
    expect(contract).toContain("framework source and installed package internals");
    expect(contract).toContain("assignment prose, a working directory");
  });

  test("uses a compact brief without treating every open choice as blocking", async () => {
    const template = await text(new URL("templates/product-brief.md", promptRoot));
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
    expect(template).not.toContain("Decision:**");
  });

  test("bounds ordinary criticism and lets preauthorized work resolve blockers", async () => {
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    const normalized = workflow.replace(/\s+/g, " ");
    expect(normalized).toContain("Two critic passes are the normal automatic budget");
    expect(normalized).toContain("No material findings ends criticism immediately");
    expect(normalized).toContain("critic bullets verbatim plus only a neutral request");
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
    expect(workflow).toContain("do not open another repair or criticism cycle");
  });

  test("uses one implementation worker per phase and independent evidence", async () => {
    const workflow = await text(new URL("references/workflow.md", skillRoot));
    expect(workflow).toContain(
      "brief storage guarantees in\nimplementation assignments, not concept State",
    );
    expect(workflow).toContain("one normal-reasoning concept worker");
    expect(workflow).toContain("one normal-reasoning application worker");
    expect(workflow).toContain("one fresh normal-reasoning evidence worker");
    expect(workflow).toContain("split only for overflow or explicit parallelism");
    expect(workflow).toContain("Do not create a replacement agent");
    expect(workflow).toContain("design digest design");
    expect(workflow).toContain("follow-up check <file>");
    expect(workflow).toContain("every final check invalidated by the changed paths");

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
    const contract = await text(new URL("references/harnesses/contract.md", skillRoot));
    const paseo = await text(new URL("references/harnesses/paseo.md", skillRoot));
    expect(entry).toContain("Paseo guide");
    expect(entry).toContain("self-contained compiler");
    expect(entry).toContain("never substitutes for a role");
    expect(entry).toContain("Do not read role templates or\n   common prompt files yourself");
    expect(entry).toContain("do not\n   read or recreate the packaged template directly");
    expect(entry).toContain("coordinator's exact provider and model");
    expect(workflow).toContain('bun "<skill-root>/scripts/command.ts" release check .');
    expect(workflow).toContain('bun "<skill-root>/scripts/command.ts" brief init design/brief.md');
    expect(workflow).toContain("It never authors or\nrepairs concept/composition/type design");
    expect(workflow).toContain("Do not run a Vite+ migration");
    expect(workflow).toContain("Do not install or downgrade those toolchain packages manually");
    expect(workflow).toContain("setup completion is a hard gate");
    expect(workflow).toContain("Run this command alone—do not chain a premature check");
    expect(workflow).toContain("Default to no catalog context");
    expect(workflow).toContain("do not rebuild or resend the full designer prompt");
    expect(workflow).toContain("never aggregate candidate files into an intermediate file");
    expect(workflow).toContain("--input candidate=design/types.md");
    expect(workflow).not.toContain("bunx --no-install sync-engine-skill");
    expect(contract).toContain("normal reasoning setting");
    expect(contract).toContain("deliver initial and follow-up prompts from files");
    expect(paseo).toContain("Pi `openai-codex/...` models still use `pi`, not `codex`");
    expect(paseo).toContain("use those values without\nprovider discovery");
    expect(paseo).toContain("Otherwise use provider\nmodel discovery once");
    expect(paseo).toContain("omit `--mode` for Pi when `AvailableModes` is empty");
    expect(paseo).toContain("displayed `Mode` is not a valid child option");
    expect(paseo).toContain("Launch every role without probing command help");
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
        await expect(stat(new URL(match[1]!, url)), `${path}: ${match[1]}`).resolves.toBeDefined();
      }
    }
  });
});
