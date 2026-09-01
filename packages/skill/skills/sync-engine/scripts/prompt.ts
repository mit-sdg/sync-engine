import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  getRoleSpecification,
  neverGrantableCapabilities,
  type EffectiveCapabilityGrant,
  type RoleSpecification,
  validateCapabilityGrant,
} from "./roles.ts";

const contextDeliveries = ["fresh", "continuation", "delta", "replacement"] as const;
export type PromptContextDelivery = (typeof contextDeliveries)[number];
export type PromptInput =
  | Readonly<{ id: string; path: string; displayName?: string }>
  | Readonly<{ id: string; displayName: string; content: string }>;
export type RetainedSource = Readonly<{ inputId: string; displayName: string; sha256: string }>;
type PromptSourceKind = "role-template" | "guidance" | "input";
type PromptSourceDelivery = "inline" | "retained-binding" | "replacement-expansion";

export interface PromptSourceContribution {
  readonly kind: PromptSourceKind;
  readonly inputId?: string;
  readonly path: string;
  readonly displayName: string;
  readonly delivery: PromptSourceDelivery;
  readonly sourceBytes: number;
  readonly promptBytes: number;
  readonly sha256: string;
}

export class PromptBuildError extends Error {
  override readonly name = "PromptBuildError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface BuildPromptOptions {
  readonly role: string;
  readonly phase: string;
  readonly workUnit: string;
  readonly applicationRoot: string;
  readonly promptRoot: string;
  readonly inputs: readonly PromptInput[];
  readonly grant: unknown;
  readonly contextDelivery?: PromptContextDelivery;
  readonly knownRetained?: readonly RetainedSource[];
  readonly contextLimitBytes?: number;
}

type Source = Readonly<{ path: string; displayName: string; content: string }>;

function normalize(source: string): string {
  return `${source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n*$/, "")}\n`;
}

const byteLength = (source: string): number => Buffer.byteLength(source, "utf8");
const digest = (source: string): string => createHash("sha256").update(source).digest("hex");
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeLabel(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    hasControl(value) ||
    ["`", "<", ">", "\\"].some((character) => value.includes(character))
  ) {
    throw new PromptBuildError("unsafe-input", `Unsafe ${label}: ${String(value)}`);
  }
  return value;
}

const retainedKey = ({ inputId, displayName, sha256 }: RetainedSource): string =>
  `${inputId}\u0000${displayName}\u0000${sha256}`;

function knownRetained(sources: readonly RetainedSource[] = []): ReadonlySet<string> {
  const known = new Set<string>();
  for (const source of sources) {
    const inputId = safeLabel(source.inputId, "retained input id");
    const displayName = safeLabel(source.displayName, "retained display name");
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new PromptBuildError("unsafe-input", `Unsafe retained SHA-256: ${source.sha256}`);
    }
    known.add(retainedKey({ inputId, displayName, sha256: source.sha256 }));
  }
  return known;
}

async function promptRoot(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    throw new PromptBuildError("unreadable-input", `Cannot read prompt root ${path}`);
  }
}

async function canonicalSource(root: string, path: string, label: string): Promise<Source> {
  const target = resolve(root, path);
  if (!inside(root, target)) {
    throw new PromptBuildError("unreadable-input", `${label} escapes prompt root: ${path}`);
  }
  try {
    const real = await realpath(target);
    if (!inside(root, real)) throw new Error("escaping source");
    return {
      path: real,
      displayName: path.replaceAll("\\", "/"),
      content: normalize(await readFile(real, "utf8")),
    };
  } catch {
    throw new PromptBuildError("unreadable-input", `Cannot read ${label} ${path}`);
  }
}

async function materializeInputs(
  specification: RoleSpecification,
  supplied: readonly PromptInput[],
): Promise<ReadonlyMap<string, readonly Source[]>> {
  type Pending = { displayName: string; path: string | undefined; content: string | undefined };
  const accepted = new Map(specification.inputs.map((input) => [input.id, input]));
  const grouped = new Map<string, Pending[]>();
  const displays = new Set<string>();

  for (const raw of supplied) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new PromptBuildError("unsafe-input", "Prompt input must be an object");
    }
    const id = safeLabel(raw.id, "input id");
    if (!accepted.has(id)) {
      throw new PromptBuildError("unsafe-input", `${specification.id} does not accept input ${id}`);
    }
    const file = "path" in raw;
    if (file === "content" in raw) {
      throw new PromptBuildError(
        "unsafe-input",
        `Input ${id} must have exactly one path or content`,
      );
    }
    const path = file ? raw.path : undefined;
    if (path !== undefined && (typeof path !== "string" || path.length === 0 || hasControl(path))) {
      throw new PromptBuildError("unsafe-input", `Unsafe input path: ${String(path)}`);
    }
    const content = file ? undefined : raw.content;
    if (content !== undefined && typeof content !== "string") {
      throw new PromptBuildError("unsafe-input", `Inline input ${id} must contain text`);
    }
    const displayName = safeLabel(
      raw.displayName ?? (path === undefined ? undefined : basename(path)),
      "display name",
    );
    if (displays.has(displayName)) {
      throw new PromptBuildError("duplicate-input", `Duplicate input display name: ${displayName}`);
    }
    displays.add(displayName);
    const values = grouped.get(id) ?? [];
    values.push({ displayName, path, content });
    grouped.set(id, values);
  }

  for (const input of specification.inputs) {
    const count = grouped.get(input.id)?.length ?? 0;
    if (["exactly-one", "one-or-more"].includes(input.cardinality) && count === 0) {
      throw new PromptBuildError(
        "missing-required-input",
        `Missing required input ${input.id} for ${specification.id}`,
      );
    }
    if (["exactly-one", "zero-or-one"].includes(input.cardinality) && count > 1) {
      throw new PromptBuildError("duplicate-input", `Input ${input.id} accepts at most one value`);
    }
  }

  const result = new Map<string, readonly Source[]>();
  const realPaths = new Set<string>();
  for (const contract of specification.inputs) {
    const values: Source[] = [];
    for (const pending of [...(grouped.get(contract.id) ?? [])].sort((a, b) =>
      compare(a.displayName, b.displayName),
    )) {
      if (pending.content !== undefined) {
        values.push({
          ...pending,
          path: `<inline:${pending.displayName}>`,
          content: normalize(pending.content),
        });
        continue;
      }
      try {
        const path = await realpath(pending.path!);
        if (realPaths.has(path))
          throw new PromptBuildError(
            "duplicate-input",
            `Duplicate input file: ${pending.displayName}`,
          );
        realPaths.add(path);
        values.push({ ...pending, path, content: normalize(await readFile(path, "utf8")) });
      } catch (error) {
        if (error instanceof PromptBuildError) throw error;
        throw new PromptBuildError(
          "unreadable-input",
          `Cannot read input ${contract.id} ${pending.displayName}`,
        );
      }
    }
    result.set(contract.id, values);
  }
  return result;
}

const sourceBody = (source: Source): string => source.content.slice(0, -1);

function contribution(
  kind: PromptSourceKind,
  source: Source,
  delivery: PromptSourceDelivery,
  rendered: string,
  inputId?: string,
): PromptSourceContribution {
  return {
    kind,
    ...(inputId === undefined ? {} : { inputId }),
    path: source.path,
    displayName: source.displayName,
    delivery,
    sourceBytes: byteLength(source.content),
    promptBytes: byteLength(rendered),
    sha256: digest(source.content),
  };
}

type GrantedArea = Readonly<{ area: string; path: string }>;

function areaPath(applicationRoot: string, workUnit: string, granted: GrantedArea): string {
  const base =
    granted.area === "work-unit" || granted.area === "current-decomposition"
      ? resolve(applicationRoot, ".sync-engine", "work", workUnit)
      : granted.area === "design" || granted.area === "assigned-design"
        ? resolve(applicationRoot, "design")
        : applicationRoot;
  return resolve(base, granted.path);
}

function areaList(
  areas: readonly GrantedArea[],
  applicationRoot: string,
  workUnit: string,
): string {
  return areas.length === 0
    ? "none"
    : areas
        .map(
          (granted) =>
            `\`${granted.area}:${granted.path}\` (${JSON.stringify(areaPath(applicationRoot, workUnit, granted))})`,
        )
        .join(", ");
}

function capabilities(
  grant: EffectiveCapabilityGrant,
  applicationRoot: string,
  workUnit: string,
): string {
  const never = neverGrantableCapabilities.map((value) => `\`${value}\``).join(", ");
  return `# Access

Root: ${JSON.stringify(applicationRoot)}. The short native message explicitly authorizes reading this prompt file; all assignment context is inline below.

- Read: ${areaList(grant.readableAreas, applicationRoot, workUnit)}.
- Write: ${areaList(grant.writableAreas, applicationRoot, workUnit)}.
- Tools: ${grant.toolKinds.length === 0 ? "none" : grant.toolKinds.map((tool) => `\`${tool}\``).join(", ")}.
- Shell: \`${grant.projectShell}\`; network: ${grant.network ? "yes" : "no"}; generated output: ${grant.generatedOutput ? "yes" : "no"}; long-running processes: ${grant.longRunningProcesses ? "yes" : "no"}.

Inspect only listed files or directories. In coordinator simulation, this grant binds the coordinator itself; broader coordinator access and prior discovery are unavailable to the assignment. Project checks may transitively read other project files, but do not inspect them yourself. Never open \`node_modules\`, package \`dist\` files, or framework internals, including declarations; required public excerpts must be supplied inline. Exclude \`.git\`, \`.sync-engine\` except this prompt, harness/skill configuration, agent traces, parent directories, and unrelated generated output. Ask for context instead of searching outside the grant. Generated files come only from granted commands. Never grantable: ${never}.`;
}

function deltaCapabilities(grant: EffectiveCapabilityGrant): string {
  return `# Access

This grant replaces prior access; other rules remain.

Current grant:

\`\`\`json
${JSON.stringify(grant)}
\`\`\``;
}

function returnShape(specification: RoleSpecification, compact = false): string {
  if (compact) {
    const headings = specification.returnShape
      .map(({ heading, required }) => `\`## ${heading}\`${required ? "" : " (optional)"}`)
      .join(", ");
    return `# Result\n\nUnless the task requests another format, use these prior fields: ${headings}.`;
  }
  const fields = specification.returnShape
    .map((field) => {
      const guidance = field.guidance === "" ? "" : ` ${field.guidance}`;
      return `- \`## ${field.heading}\` — ${field.required ? "required" : "optional"}.${guidance}`;
    })
    .join("\n");
  return `# Result

Unless the task requests another format, return these headings in order. Omit progress narration.

${fields}`;
}

function retained(_source: Source): string {
  return "Unchanged from the prior same-agent context.";
}

export async function buildPrompt(options: BuildPromptOptions) {
  let specification: RoleSpecification;
  try {
    specification = getRoleSpecification(options.role, options.phase);
  } catch (error) {
    throw new PromptBuildError("unknown-specification", String(error));
  }
  let effectiveCapabilities: EffectiveCapabilityGrant;
  try {
    effectiveCapabilities = validateCapabilityGrant(specification, options.grant);
  } catch (error) {
    throw new PromptBuildError("invalid-grant", String(error));
  }

  const workUnit = safeLabel(options.workUnit, "work unit");
  if (
    typeof options.applicationRoot !== "string" ||
    options.applicationRoot.trim() === "" ||
    hasControl(options.applicationRoot)
  ) {
    throw new PromptBuildError("unsafe-input", "Application root cannot be empty or unsafe");
  }
  const applicationRoot = resolve(options.applicationRoot);
  const contextDelivery = options.contextDelivery ?? "fresh";
  if (!contextDeliveries.includes(contextDelivery)) {
    throw new PromptBuildError(
      "unsafe-input",
      `Unknown context delivery ${String(contextDelivery)}`,
    );
  }
  if (
    options.contextLimitBytes !== undefined &&
    (!Number.isSafeInteger(options.contextLimitBytes) || options.contextLimitBytes <= 0)
  ) {
    throw new PromptBuildError("unsafe-input", "Context limit must be a positive safe integer");
  }
  const known = knownRetained(options.knownRetained);
  const samePhaseContinuation = contextDelivery === "delta";

  const root = await promptRoot(options.promptRoot);
  const role = await canonicalSource(root, specification.templatePath, "role template");
  const guidance = await Promise.all(
    specification.guidancePaths.map((path) => canonicalSource(root, path, "guidance")),
  );
  const inputs = await materializeInputs(specification, options.inputs);
  const sources: PromptSourceContribution[] = [];
  const retainedSources: RetainedSource[] = [];

  const renderedRole = samePhaseContinuation ? "" : sourceBody(role);
  sources.push(
    contribution(
      "role-template",
      role,
      samePhaseContinuation ? "retained-binding" : "inline",
      renderedRole,
    ),
  );
  const roleSection = samePhaseContinuation
    ? `# Role and objective

Continue work unit \`${workUnit}\`; role \`${specification.role}\`; phase \`${specification.phase}\`. The prior same-phase role contract remains authoritative.`
    : `# Role and objective

Work unit \`${workUnit}\`; role \`${specification.role}\`; phase \`${specification.phase}\`.

${renderedRole}`;

  const renderedGuidance = guidance.map((source) => {
    const rendered = samePhaseContinuation ? "" : sourceBody(source);
    sources.push(
      contribution(
        "guidance",
        source,
        samePhaseContinuation ? "retained-binding" : "inline",
        rendered,
      ),
    );
    return rendered;
  });
  const guidanceSection = samePhaseContinuation
    ? "# Guidance\n\nUnchanged from the prior same-agent context. Apply it to the task and changed context below."
    : `# Guidance

${renderedGuidance.length === 0 ? "No additional guidance for this phase." : renderedGuidance.join("\n\n---\n\n")}`;

  const contextGroups: string[] = [];
  for (const contract of specification.inputs) {
    const values = inputs.get(contract.id) ?? [];
    if (values.length === 0) continue;
    const renderedValues = values.map((source) => {
      const identity: RetainedSource = {
        inputId: contract.id,
        displayName: source.displayName,
        sha256: digest(source.content),
      };
      const retain = contract.delivery === "retained";
      if (retain) retainedSources.push(identity);
      const binding =
        (contextDelivery === "continuation" || contextDelivery === "delta") &&
        retain &&
        known.has(retainedKey(identity));
      const rendered = binding ? retained(source) : sourceBody(source);
      const delivery: PromptSourceDelivery = binding
        ? "retained-binding"
        : contextDelivery === "replacement" && retain
          ? "replacement-expansion"
          : "inline";
      sources.push(contribution("input", source, delivery, rendered, contract.id));
      return `**${source.displayName}**\n\n${rendered}`;
    });
    contextGroups.push(`## ${contract.heading}\n\n${renderedValues.join("\n\n")}`);
  }
  const contextSection = `# Context\n\n${contextGroups.join("\n\n")}`;

  const capabilitySection = samePhaseContinuation
    ? deltaCapabilities(effectiveCapabilities)
    : capabilities(effectiveCapabilities, applicationRoot, workUnit);
  const content = normalize(
    [
      roleSection,
      capabilitySection,
      guidanceSection,
      contextSection,
      returnShape(specification, samePhaseContinuation),
    ].join("\n\n"),
  );
  const totalBytes = byteLength(content);
  if (options.contextLimitBytes !== undefined && totalBytes > options.contextLimitBytes) {
    const report = sources
      .map(
        (source) =>
          `${source.displayName}: ${source.promptBytes} prompt bytes (${source.sourceBytes} source bytes)`,
      )
      .join("; ");
    throw new PromptBuildError(
      "context-limit-overflow",
      `Prompt is ${totalBytes} bytes, exceeding the actual ${options.contextLimitBytes}-byte context limit. Sources: ${report}`,
    );
  }

  return {
    specification,
    effectiveCapabilities,
    contextDelivery,
    content,
    bytes: totalBytes,
    sha256: digest(content),
    sources,
    retainedSources,
  };
}

export type BuiltPrompt = Awaited<ReturnType<typeof buildPrompt>>;
