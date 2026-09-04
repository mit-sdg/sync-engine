import { posix } from "node:path";

export const roleIds = [
  "designer",
  "critic",
  "concept-worker",
  "application-worker",
  "frontend-worker",
  "evidence-worker",
] as const;
export type RoleId = (typeof roleIds)[number];

export const rolePhases = [
  "decomposition",
  "contracts",
  "verification",
  "implementation",
  "evidence",
] as const;
export type RolePhase = (typeof rolePhases)[number];

export const roleSpecificationIds = [
  "designer/decomposition",
  "designer/contracts",
  "critic/decomposition",
  "critic/contracts",
  "critic/implementation",
  "critic/verification",
  "concept-worker/implementation",
  "application-worker/implementation",
  "frontend-worker/implementation",
  "evidence-worker/evidence",
] as const;
export type RoleSpecificationId = (typeof roleSpecificationIds)[number];

export type InputCardinality = "exactly-one" | "zero-or-one" | "one-or-more" | "zero-or-more";
export type InputDelivery = "inline" | "retained";

export type AcceptedInput = Readonly<{
  id: string;
  heading: string;
  cardinality: InputCardinality;
  /** Retained inputs bind on continuation and expand for a fresh agent or replacement. */
  delivery: InputDelivery;
}>;
export type ReturnField = Readonly<{ heading: string; required: boolean; guidance: string }>;

export type ReadableRepositoryArea = "work-unit" | "design" | "application";
export type WritableOwnershipArea =
  | "current-decomposition"
  | "assigned-design"
  | "owned-concept"
  | "owned-integration"
  | "owned-configuration"
  | "owned-frontend"
  | "owned-test"
  | "owned-scenario";
export type ToolKind = "repository-read" | "repository-write";

export const projectShellAccessLevels = ["none", "project-validation", "project-local"] as const;
export type ProjectShellAccess = (typeof projectShellAccessLevels)[number];

export const capabilityCategories = [
  "readableAreas",
  "writableAreas",
  "toolKinds",
  "projectShell",
  "network",
  "generatedOutput",
  "longRunningProcesses",
] as const;

export const neverGrantableCapabilities = [
  "git-mutation",
  "dependency-installation",
  "framework-internals",
  "workflow-management",
  "skill-cli-invocation",
  "delegation-or-handoff",
] as const;

interface CapabilitySet<Readable, Writable> {
  readonly readableAreas: readonly Readable[];
  readonly writableAreas: readonly Writable[];
  readonly toolKinds: readonly ToolKind[];
  readonly projectShell: ProjectShellAccess;
  readonly network: boolean;
  readonly generatedOutput: boolean;
  readonly longRunningProcesses: boolean;
}
export type RecommendedCapabilities = CapabilitySet<ReadableRepositoryArea, WritableOwnershipArea>;
export type ReadableAreaGrant = Readonly<{ area: ReadableRepositoryArea; path: string }>;
export type WritableAreaGrant = Readonly<{ area: WritableOwnershipArea; path: string }>;
export type EffectiveCapabilityGrant = CapabilitySet<ReadableAreaGrant, WritableAreaGrant>;

export interface RoleSpecification {
  readonly id: RoleSpecificationId;
  readonly role: RoleId;
  readonly phase: RolePhase;
  readonly templatePath: string;
  readonly guidancePaths: readonly string[];
  readonly inputs: readonly AcceptedInput[];
  readonly recommendedCapabilities: RecommendedCapabilities;
  readonly returnShape: readonly ReturnField[];
}

const readAreas = ["work-unit", "design", "application"] as const;
const writeAreas = [
  "current-decomposition",
  "assigned-design",
  "owned-concept",
  "owned-integration",
  "owned-configuration",
  "owned-frontend",
  "owned-test",
  "owned-scenario",
] as const;
const tools = ["repository-read", "repository-write"] as const;

type Extras = "none" | "generated" | "generated-host" | "network-host";
function max(
  readableAreas: readonly ReadableRepositoryArea[],
  writableAreas: readonly WritableOwnershipArea[],
  projectShell: ProjectShellAccess = "none",
  extras: Extras = "none",
): RecommendedCapabilities {
  return {
    readableAreas,
    writableAreas,
    toolKinds: writableAreas.length === 0 ? ["repository-read"] : tools,
    projectShell,
    network: extras === "network-host",
    generatedOutput: extras.startsWith("generated"),
    longRunningProcesses: extras.endsWith("host"),
  };
}

const designRead = ["work-unit", "design"] as const;
const applicationRead = ["application"] as const;
const conceptWrite = ["owned-concept", "owned-test"] as const;
const applicationWrite = ["owned-integration", "owned-configuration", "owned-test"] as const;
const frontendWrite = ["owned-frontend", "owned-test"] as const;
const evidenceWrite = ["owned-scenario", "owned-test"] as const;
const applicationMax = max(applicationRead, applicationWrite, "project-local", "generated-host");
const frontendMax = max(applicationRead, frontendWrite, "project-local", "network-host");
export const recommendedCapabilitiesByRolePhase = {
  "designer/decomposition": max(designRead, ["current-decomposition"]),
  "designer/contracts": max(designRead, ["assigned-design"], "project-validation"),
  "critic/decomposition": max(designRead, []),
  "critic/contracts": max(designRead, []),
  "critic/implementation": max(applicationRead, [], "project-validation"),
  "critic/verification": max(designRead, []),
  "concept-worker/implementation": max(applicationRead, conceptWrite, "project-local", "generated"),
  "application-worker/implementation": applicationMax,
  "frontend-worker/implementation": frontendMax,
  "evidence-worker/evidence": max(applicationRead, evidenceWrite, "project-validation"),
} as const satisfies Readonly<Record<RoleSpecificationId, RecommendedCapabilities>>;

const inline = (
  id: string,
  heading: string,
  cardinality: InputCardinality = "exactly-one",
): AcceptedInput => ({ id, heading, cardinality, delivery: "inline" });
const retained = (
  id: string,
  heading: string,
  cardinality: InputCardinality = "exactly-one",
): AcceptedInput => ({ id, heading, cardinality, delivery: "retained" });
const task = (heading = "Task") => inline("task", heading);
const brief = (heading = "Brief") => retained("brief", heading);

const extraContext = retained("context", "Additional directed context", "zero-or-more");

const output = (heading: string, required = true, guidance = ""): ReturnField => ({
  heading,
  required,
  guidance,
});

const designerReturn = [
  output("Status", true, "First line is exactly `Complete` or `Blocked`; explanation goes below."),
  output("Changed", true, "Paths changed, or none."),
  output("Questions", true, "Material questions, or none."),
  output("Checks", false, "Command and outcome when applicable."),
];
const criticReturn = [
  output("Verdict", true, "First line is exactly `Approve`, `Revise`, or `Blocked`."),
  output(
    "Assessments",
    true,
    "Compact obligation-by-obligation semantic assessment; do not restate contracts.",
  ),
  output("Findings", true, "Stable-ID blocker or material findings, or none."),
];
const workerReturn = [
  output("Status", true, "First line is exactly `Complete` or `Blocked`; explanation goes below."),
  output("Changed", true, "Paths changed, or none."),
  output("Checks", true, "Exact command and pass/fail outcome."),
  output("Blockers", true, "Categorize as design, context, or environment."),
  output("Concerns", false, "Material non-blocking uncertainty only."),
];
const verificationFindings =
  "Stable findings or routed blockers resolved/unresolved; direct regressions or none.";

function template(role: RoleId, phase: RolePhase): string {
  if (role === "designer" || role === "critic") return `roles/${role}-${phase}.md`;
  return `roles/${role}.md`;
}

function specification(
  id: RoleSpecificationId,
  guidance: readonly string[],
  inputs: readonly AcceptedInput[],
  returnShape: readonly ReturnField[],
): RoleSpecification {
  const [role, phase] = id.split("/") as [RoleId, RolePhase];
  return {
    id,
    role,
    phase,
    templatePath: template(role, phase),
    guidancePaths: guidance.map((path) => `guidance/${path}.md`),
    inputs,
    recommendedCapabilities: recommendedCapabilitiesByRolePhase[id],
    returnShape,
  };
}

export const roleSpecifications = {
  "designer/decomposition": specification(
    "designer/decomposition",
    ["catalog", "design/decomposition"],
    [
      task(),
      brief(),
      inline("current-decomposition", "Current decomposition", "zero-or-one"),
      retained("affected-design", "Affected existing design", "zero-or-more"),
      extraContext,
    ],
    designerReturn,
  ),
  "designer/contracts": specification(
    "designer/contracts",
    ["design/contracts", "design/authored-format", "design/ssf", "design/boundary"],
    [
      task(),
      brief(),
      retained("accepted-decomposition", "Accepted decomposition", "zero-or-one"),
      retained("resolved-findings", "Resolved decomposition findings", "zero-or-one"),
      retained("affected-contracts", "Affected existing contracts", "zero-or-more"),
      retained("catalog-contracts", "Relevant unchanged catalog contracts", "zero-or-more"),
      inline("candidate-contracts", "Current candidate contracts", "zero-or-more"),
      retained("public-references", "Selected format and API references", "zero-or-more"),
      extraContext,
    ],
    designerReturn,
  ),
  "critic/decomposition": specification(
    "critic/decomposition",
    ["catalog", "design/decomposition"],
    [
      task("Review task"),
      brief(),
      inline("candidate-decomposition", "Candidate decomposition"),
      retained("affected-design", "Affected existing design", "zero-or-more"),
      extraContext,
    ],
    [
      criticReturn[0]!,
      output(
        "Assessments",
        true,
        "One overloaded, minimal, or fragmented verdict per concept; adverse assessments keyed to rows.",
      ),
      criticReturn[2]!,
    ],
  ),
  "critic/contracts": specification(
    "critic/contracts",
    ["design/contracts", "design/ssf-reading", "design/boundary"],
    [
      task("Review task"),
      brief(),
      retained("accepted-decomposition", "Accepted decomposition", "zero-or-one"),
      inline("changed-contracts", "Changed candidate contracts", "one-or-more"),
      retained("affected-contracts", "Affected existing contracts", "zero-or-more"),
      retained("public-references", "Selected review references", "zero-or-more"),
      extraContext,
    ],
    criticReturn,
  ),
  "critic/implementation": specification(
    "critic/implementation",
    ["implementation/framework-safety", "design/ssf-reading", "design/boundary", "api/composition"],
    [
      task("Review task"),
      brief(),
      retained("contracts", "Relevant contracts", "one-or-more"),
      retained("accepted-decomposition", "Accepted decomposition", "zero-or-one"),
      inline("changed-source-and-tests", "Changed source and tests", "one-or-more"),
      retained("public-references", "Selected public references", "zero-or-more"),
      extraContext,
    ],
    [
      criticReturn[0]!,
      output(
        "Assessments",
        true,
        "Compact contract-by-contract or obligation-by-obligation conformance assessment.",
      ),
      criticReturn[2]!,
    ],
  ),
  "critic/verification": specification(
    "critic/verification",
    [],
    [
      task("Verification task"),
      brief(),
      inline("original-findings", "Original finding or routed blocker IDs"),
      inline("revised-candidate", "Revised candidate context", "one-or-more"),
      retained("affected-design", "Retained affected design", "zero-or-more"),
      retained("review-guidance", "Retained review guidance", "one-or-more"),
      extraContext,
    ],
    [criticReturn[0]!, output("Findings", true, verificationFindings)],
  ),
  "concept-worker/implementation": specification(
    "concept-worker/implementation",
    ["implementation/framework-safety", "implementation/concepts"],
    [
      task(),
      brief(),
      retained("specifications", "Concept specifications", "one-or-more"),
      retained("public-references", "Additional public framework references", "zero-or-more"),
      retained("examples", "Relevant examples", "zero-or-more"),
      inline("starting-paths", "Exact starting paths"),
      extraContext,
    ],
    workerReturn,
  ),
  "application-worker/implementation": specification(
    "application-worker/implementation",
    ["implementation/framework-safety", "implementation/application", "api/composition"],
    [
      task(),
      brief(),
      retained("types", "Authored types", "one-or-more"),
      retained("compositions", "Compositions", "one-or-more"),
      retained("obligations", "Cross-concept obligations", "zero-or-more"),
      retained("concept-specifications", "Concept specifications", "one-or-more"),
      retained("concept-public-surfaces", "Concept public surfaces", "one-or-more"),
      retained("existing-wiring", "Existing wiring and configuration", "zero-or-more"),
      retained("public-references", "Additional public framework references", "zero-or-more"),
      retained("examples", "Relevant examples", "zero-or-more"),
      inline("starting-paths", "Exact starting paths"),
      extraContext,
    ],
    workerReturn,
  ),
  "frontend-worker/implementation": specification(
    "frontend-worker/implementation",
    ["implementation/framework-safety", "implementation/frontend"],
    [
      task(),
      brief(),
      retained("public-interface", "Assembled public interface", "one-or-more"),
      inline("frontend-paths", "Frontend starting paths"),
      retained("public-references", "Additional public framework references", "zero-or-more"),
      retained("examples", "Relevant examples", "zero-or-more"),
      extraContext,
    ],
    workerReturn,
  ),
  "evidence-worker/evidence": specification(
    "evidence-worker/evidence",
    ["implementation/framework-safety", "implementation/evidence"],
    [
      task(),
      brief("Relevant brief outcomes"),
      retained("contracts", "Relevant contracts", "one-or-more"),
      retained("public-interface", "Assembled public interface", "one-or-more"),
      retained("frontend-surface", "Frontend surface", "zero-or-more"),
      retained("relevant-tests", "Existing relevant tests", "zero-or-more"),
      retained("public-references", "Additional public framework references", "zero-or-more"),
      retained("examples", "Relevant examples", "zero-or-more"),
      extraContext,
    ],
    [
      ...workerReturn,
      output("Coverage", true, "Each relevant brief outcome linked to evidence and result."),
    ],
  ),
} as const satisfies Readonly<Record<RoleSpecificationId, RoleSpecification>>;

export function getRoleSpecification(role: string, phase: string): RoleSpecification {
  const id = `${role}/${phase}` as RoleSpecificationId;
  if (!roleSpecificationIds.includes(id)) {
    throw new Error(
      `Unknown role specification ${id}; expected ${roleSpecificationIds.join(", ")}`,
    );
  }
  return roleSpecifications[id];
}

function fail(spec: RoleSpecification, detail: string): never {
  throw new Error(`Invalid capability grant for ${spec.id}: ${detail}`);
}

function shape(
  spec: RoleSpecification,
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(spec, `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record)
    .filter((key) => !keys.includes(key))
    .sort();
  const missing = keys.filter((key) => !(key in record));
  if (extra.length) fail(spec, `${label} has unknown fields: ${extra.join(", ")}`);
  if (missing.length) fail(spec, `${label} is missing fields: ${missing.join(", ")}`);
  return record;
}

function safePath(spec: RoleSpecification, value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(spec, `${label} path is empty`);
  let control = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) control = true;
  }
  const segments = value.split("/");
  const unsafe = ["`", "\\", "*", "?", "[", "]", "{", "}"].some((char) => value.includes(char));
  const escaping =
    value !== "." &&
    (posix.isAbsolute(value) ||
      /^[A-Za-z]:\//.test(value) ||
      posix.normalize(value) !== value ||
      segments.some((part) => part === "" || part === "." || part === ".."));
  if (control || unsafe || escaping) {
    fail(spec, `${label} path must be a canonical relative POSIX path: ${value}`);
  }
  return value;
}

function areaGrants<A extends string>(
  spec: RoleSpecification,
  value: unknown,
  field: "readableAreas" | "writableAreas",
  known: readonly A[],
  write = false,
): Array<{ area: A; path: string }> {
  if (!Array.isArray(value)) fail(spec, `${field} must be an array`);
  const result: Array<{ area: A; path: string }> = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const at = `${field}[${index}]`;
    const entry = shape(spec, raw, at, ["area", "path"]);
    if (typeof entry.area !== "string" || !known.includes(entry.area as A)) {
      fail(spec, `${at} has unknown area ${String(entry.area)}`);
    }
    const area = entry.area as A;
    const path = safePath(spec, entry.path, at);
    if (write && path === ".") {
      fail(spec, `write area ${area} must name a concrete path family`);
    }
    const repeatedRoot =
      (area === "work-unit" && path.split("/")[0] === ".sync-engine") ||
      ((area === "design" || area === "assigned-design") && path.split("/")[0] === "design");
    if (repeatedRoot) {
      fail(spec, `${at} path is already relative to ${area} and cannot repeat its root: ${path}`);
    }
    if (area === "current-decomposition" && path !== "decomposition.md") {
      fail(spec, "current-decomposition can grant only decomposition.md");
    }
    const application = write ? area.startsWith("owned-") : area === "application";
    const blocked = write
      ? [
          ".git",
          ".sync-engine",
          ".cursor",
          ".claude",
          ".pi",
          ".codex",
          ".agents",
          "node_modules",
          "design",
        ]
      : [".git", ".sync-engine", ".cursor", ".claude", ".pi", ".codex", ".agents", "node_modules"];
    if (application && path !== "." && blocked.includes(path.split("/")[0]!)) {
      fail(spec, `${at} cannot grant ${path}`);
    }
    const identity = `${area}\u0000${path}`;
    if (seen.has(identity))
      fail(spec, `duplicate ${write ? "write" : "read"} area ${area}:${path}`);
    seen.add(identity);
    result.push({ area, path });
  }
  return result.sort(
    (a, b) => known.indexOf(a.area) - known.indexOf(b.area) || compare(a.path, b.path),
  );
}

function toolGrant(spec: RoleSpecification, value: unknown): ToolKind[] {
  if (!Array.isArray(value)) fail(spec, "toolKinds must be an array");
  const result: ToolKind[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !tools.includes(candidate as ToolKind)) {
      fail(spec, `unknown tool kind ${String(candidate)}`);
    }
    const tool = candidate as ToolKind;
    if (result.includes(tool)) fail(spec, `duplicate tool kind ${tool}`);
    result.push(tool);
  }
  return result.sort((a, b) => tools.indexOf(a) - tools.indexOf(b));
}

function flag(
  spec: RoleSpecification,
  grant: Record<string, unknown>,
  key: "network" | "generatedOutput" | "longRunningProcesses",
): boolean {
  const value = grant[key];
  if (typeof value !== "boolean") fail(spec, `${key} must be boolean`);
  return value;
}

export function capabilityRecommendationIssues(
  spec: RoleSpecification,
  grant: EffectiveCapabilityGrant,
): readonly string[] {
  const recommended = spec.recommendedCapabilities;
  const issues = [
    ...grant.readableAreas
      .filter(({ area }) => !recommended.readableAreas.includes(area))
      .map(({ area }) => `read area ${area}`),
    ...grant.readableAreas
      .filter(({ area, path }) => area === "application" && path === ".")
      .map(() => `read path application:. is unbounded`),
    ...grant.writableAreas
      .filter(({ area }) => !recommended.writableAreas.includes(area))
      .map(({ area }) => `write area ${area}`),
    ...grant.toolKinds
      .filter((tool) => !recommended.toolKinds.includes(tool))
      .map((tool) => `tool kind ${tool}`),
  ];
  if (spec.id === "application-worker/implementation") {
    for (const { area, path } of grant.writableAreas) {
      const parts = path.split("/");
      const overlapsConcepts =
        (area === "owned-integration" && (path === "src" || parts.includes("concepts"))) ||
        (area === "owned-test" &&
          (path === "test" || path === "tests" || parts.includes("concepts")));
      if (overlapsConcepts) issues.push(`write path ${area}:${path} overlaps concept ownership`);
    }
  }
  if (
    projectShellAccessLevels.indexOf(grant.projectShell) >
    projectShellAccessLevels.indexOf(recommended.projectShell)
  ) {
    issues.push(`projectShell ${grant.projectShell}`);
  }
  for (const key of ["network", "generatedOutput", "longRunningProcesses"] as const) {
    if (grant[key] && !recommended[key]) issues.push(key);
  }
  return issues;
}

function validateRoleOwnership(
  spec: RoleSpecification,
  writableAreas: readonly WritableAreaGrant[],
): void {
  for (const { area, path } of writableAreas) {
    if (area === "current-decomposition" && spec.id !== "designer/decomposition") {
      fail(spec, `${area}:${path} is owned only by designer/decomposition`);
    }
    if (area === "assigned-design") {
      if (spec.id !== "designer/contracts") {
        fail(spec, `${area}:${path} is owned only by designer/contracts`);
      }
      if (!isCanonicalAuthoredDesignPath(path)) {
        fail(
          spec,
          `${area}:${path} must be types.md, concepts/<Name>.md, or compositions/<Name>.md`,
        );
      }
    }
  }
}

export function isCanonicalAuthoredDesignPath(path: string): boolean {
  return path === "types.md" || /^(?:concepts|compositions)\/[A-Z][A-Za-z0-9]*\.md$/.test(path);
}

export function initialCapabilityGrant(
  spec: RoleSpecification,
  readableAreas: readonly ReadableAreaGrant[],
  writableAreas: readonly WritableAreaGrant[],
  overrides: Partial<
    Pick<
      EffectiveCapabilityGrant,
      "projectShell" | "network" | "generatedOutput" | "longRunningProcesses"
    >
  > = {},
): EffectiveCapabilityGrant {
  const writes =
    spec.id === "designer/decomposition" && writableAreas.length === 0
      ? [{ area: "current-decomposition" as const, path: "decomposition.md" }]
      : [...writableAreas];
  const grant = {
    readableAreas,
    writableAreas: writes,
    toolKinds: [
      ...(readableAreas.length > 0 || writes.length > 0 ? (["repository-read"] as const) : []),
      ...(writes.length > 0 ? (["repository-write"] as const) : []),
    ],
    projectShell: overrides.projectShell ?? spec.recommendedCapabilities.projectShell,
    network: overrides.network ?? false,
    generatedOutput: overrides.generatedOutput ?? false,
    longRunningProcesses: overrides.longRunningProcesses ?? false,
  };
  return validateCapabilityGrant(spec, grant);
}

export function validateCapabilityGrant(
  spec: RoleSpecification,
  value: unknown,
): EffectiveCapabilityGrant {
  const grant = shape(spec, value, "grant", capabilityCategories);
  const readableAreas = areaGrants(spec, grant.readableAreas, "readableAreas", readAreas);
  const writableAreas = areaGrants(spec, grant.writableAreas, "writableAreas", writeAreas, true);
  validateRoleOwnership(spec, writableAreas);
  const toolKinds = toolGrant(spec, grant.toolKinds);
  if (
    typeof grant.projectShell !== "string" ||
    !projectShellAccessLevels.includes(grant.projectShell as ProjectShellAccess)
  ) {
    fail(spec, `unknown projectShell level ${String(grant.projectShell)}`);
  }
  const projectShell = grant.projectShell as ProjectShellAccess;
  return {
    readableAreas,
    writableAreas,
    toolKinds,
    projectShell,
    network: flag(spec, grant, "network"),
    generatedOutput: flag(spec, grant, "generatedOutput"),
    longRunningProcesses: flag(spec, grant, "longRunningProcesses"),
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
