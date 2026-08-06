import type { EndpointDeclaration } from "@engine/boundary/assembly/endpoint-portability";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import { unresolvedWireLeaves } from "@engine/boundary/wire/wire-types";
import type { WireType } from "@engine/boundary/wire/wire-types";
import { asMarker, isVarIR } from "@engine/reads/ir";
import type {
  ActionTriggerIR,
  AppIR,
  FormerIR,
  PatternIR,
  ReactionIR,
  ValueIR,
  WhereOpIR,
} from "@engine/reads/ir";
import { analyzeLocalBehavior, localDefinitionKey } from "@engine/reads/local-behavior";
import { foldFormerNode } from "@engine/reads/schema";
import { structurallyEqual } from "@engine/reads/value-equality";
import { ordinal } from "@engine/utils/ordinal";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "UNLOWERED_REACTION"
  | "UNLOWERED_ENDPOINT"
  | "OPAQUE_READ_OPERATION"
  | "OPAQUE_PATTERN"
  | "UNRESOLVED_WIRE_LEAF"
  | "ENDPOINT_PATH_OVERLAP"
  | "MISSING_ENDPOINT_FALLBACK"
  | "ORDER_SENSITIVE_FORMER";

export interface ApplicationDiagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  definition: { kind: "application" | "endpoint" | "reaction" | "view" | "former"; name: string };
  endpoint?: { name: string; path: string };
  message: string;
}

const IGNORED_REQUEST_FIELDS = new Set(["path", "requestId"]);
const ALWAYS_PRESENT_REQUEST_FIELDS = new Set(["path", "requestId", "correlationId"]);

interface AnswerPath {
  name: string;
  request: PatternIR;
  proof?: { operations: readonly WhereOpIR[]; mayDrop: boolean };
  coverage?: "linear-action";
}

function isResponse(reaction: ReactionIR): boolean {
  return reaction.then.some(
    ({ concept, action }) => concept === "RequestBoundary" && action === "respond",
  );
}

function actionTrigger(reaction: ReactionIR): ActionTriggerIR | undefined {
  if (reaction.when.length !== 1) return undefined;
  const [trigger] = reaction.when;
  return trigger.kind === "action" ? trigger : undefined;
}

function isRequestTrigger(trigger: ActionTriggerIR): boolean {
  return trigger.concept === "RequestBoundary" && trigger.action === "request";
}

function responseCorrelates(answer: ReactionIR, root: ActionTriggerIR): boolean {
  const requestId = root.input.requestId;
  if (
    !isVarIR(requestId) ||
    root.posture !== "returned" ||
    root.by !== undefined ||
    Object.keys(root.output).length !== 0
  ) {
    return false;
  }
  return answer.then.some(({ concept, action, input }) => {
    if (concept !== "RequestBoundary" || action !== "respond") return false;
    const responseId = input.requestId;
    return isVarIR(responseId) && responseId.$var === requestId.$var;
  });
}

function addVariables(value: ValueIR, into: Set<string>): void {
  if (isVarIR(value)) {
    into.add(value.$var);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addVariables(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const marker = asMarker(value);
  if (marker !== null) return;
  for (const child of Object.values(value)) addVariables(child, into);
}

function openPattern(pattern: PatternIR): boolean {
  const names: string[] = [];
  for (const [key, value] of Object.entries(pattern)) {
    if (key === "path") continue;
    if (!isVarIR(value)) return false;
    names.push(value.$var);
  }
  return new Set(names).size === names.length;
}

function operationsMayDrop(trigger: ActionTriggerIR, operations: readonly WhereOpIR[]): boolean {
  const bound = new Set<string>();
  for (const value of [...Object.values(trigger.input), ...Object.values(trigger.output)]) {
    addVariables(value, bound);
  }
  for (const operation of operations) {
    switch (operation.op) {
      case "whether":
        for (const value of Object.values(operation.out)) addVariables(value, bound);
        break;
      case "compute":
        if (bound.has(operation.out)) return true;
        bound.add(operation.out);
        break;
      case "custom":
        if (operation.out.some((name) => bound.has(name))) return true;
        for (const name of operation.out) bound.add(name);
        break;
      case "find":
      case "earlier":
      case "holds":
      case "no":
        return true;
    }
  }
  return false;
}

const STANDARD_REFUSAL_FUNNEL = {
  name: "DeliverRefusalToAsker",
  when: [
    {
      kind: "channel",
      channel: "refused",
      pattern: { message: { $var: "message" } },
      except: ["RequestBoundary"],
    },
  ],
  where: [
    {
      op: "earlier",
      when: {
        kind: "action",
        concept: "RequestBoundary",
        action: "request",
        input: { requestId: { $var: "requestId" } },
        output: {},
      },
    },
  ],
  then: [
    {
      kind: "request",
      concept: "RequestBoundary",
      action: "respond",
      input: { requestId: { $var: "requestId" }, error: { $var: "message" } },
    },
  ],
} satisfies ReactionIR;

const STANDARD_FAULT_FUNNEL = {
  name: "DeliverFaultToAsker",
  when: [
    {
      kind: "channel",
      channel: "faulted",
      pattern: {},
      except: [],
      exceptBy: ["DeliverFaultToAsker"],
    },
  ],
  where: [
    {
      op: "earlier",
      when: {
        kind: "action",
        concept: "RequestBoundary",
        action: "request",
        input: { requestId: { $var: "requestId" } },
        output: {},
      },
    },
  ],
  then: [
    {
      kind: "request",
      concept: "RequestBoundary",
      action: "respondFramework",
      input: { requestId: { $var: "requestId" }, error: "INTERNAL_ERROR" },
    },
  ],
} satisfies ReactionIR;

function standardBoundaryOutcomesAreCovered(reactions: readonly ReactionIR[]): boolean {
  const byName = new Map(reactions.map((reaction) => [reaction.name, reaction]));
  return (
    structurallyEqual(byName.get(STANDARD_REFUSAL_FUNNEL.name), STANDARD_REFUSAL_FUNNEL) &&
    structurallyEqual(byName.get(STANDARD_FAULT_FUNNEL.name), STANDARD_FAULT_FUNNEL)
  );
}

function literalChainValue(value: ValueIR, nested = false): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => literalChainValue(item, true));
  const marker = asMarker(value);
  if (marker !== null) return !nested && marker.tag === "$lit";
  return Object.values(value).every((item) => literalChainValue(item, true));
}

function chainInputIsExact(pattern: PatternIR): boolean {
  return Object.values(pattern).every((value) => isVarIR(value) || literalChainValue(value));
}

function variablesAreBound(pattern: PatternIR, bound: ReadonlySet<string>): boolean {
  const required = new Set<string>();
  for (const value of Object.values(pattern)) addVariables(value, required);
  return [...required].every((name) => bound.has(name));
}

function linearActionChainCovers(stages: readonly ReactionIR[]): boolean {
  if (stages.length < 2 || stages.some(({ deferred }) => deferred === true)) return false;
  const triggers: ActionTriggerIR[] = [];

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    const trigger = actionTrigger(stage);
    if (trigger === undefined || stage.then.length !== 1) return false;
    triggers.push(trigger);

    if (index === 0) {
      if (!isRequestTrigger(trigger) || stage.where.length !== 0) return false;
    } else {
      const predecessor = stages[index - 1];
      const asked = predecessor.then[0];
      if (
        trigger.posture !== "returned" ||
        trigger.by !== predecessor.name ||
        trigger.concept === "RequestBoundary" ||
        Object.keys(trigger.output).length !== 0 ||
        !chainInputIsExact(trigger.input) ||
        asked.concept !== trigger.concept ||
        asked.action !== trigger.action ||
        !structurallyEqual(asked.input, trigger.input)
      ) {
        return false;
      }
      if (
        !stage.where.every(
          (operation) =>
            operation.op === "earlier" &&
            triggers.slice(0, -1).some((ancestor) => structurallyEqual(operation.when, ancestor)),
        )
      ) {
        return false;
      }
    }

    const bound = new Set<string>();
    for (const value of [...Object.values(trigger.input), ...Object.values(trigger.output)]) {
      addVariables(value, bound);
    }
    for (const operation of stage.where) {
      if (operation.op !== "earlier") return false;
      for (const value of [
        ...Object.values(operation.when.input),
        ...Object.values(operation.when.output),
      ]) {
        addVariables(value, bound);
      }
    }
    if (!variablesAreBound(stage.then[0].input, bound)) return false;
  }

  const answer = stages.at(-1)?.then[0];
  return answer?.concept === "RequestBoundary" && answer.action === "respond";
}

function traceAnswer(
  answer: ReactionIR,
  reactions: ReadonlyMap<string, ReactionIR>,
  boundaryOutcomesCovered: boolean,
): AnswerPath {
  const seen = new Set<string>();
  const traced: ReactionIR[] = [];
  let current: ReactionIR | undefined = answer;
  let root: ActionTriggerIR | undefined;
  let proofEligible = true;

  while (current !== undefined) {
    if (seen.has(current.name)) {
      proofEligible = false;
      break;
    }
    seen.add(current.name);
    traced.push(current);
    const trigger = actionTrigger(current);
    if (trigger === undefined) {
      proofEligible = false;
      break;
    }
    if (isRequestTrigger(trigger)) {
      root = trigger;
      break;
    }
    proofEligible = false;
    if (trigger.by === undefined) {
      break;
    }
    const predecessor = reactions.get(trigger.by);
    if (
      predecessor === undefined ||
      !predecessor.then.some(
        ({ concept, action }) => concept === trigger.concept && action === trigger.action,
      )
    ) {
      break;
    }
    current = predecessor;
  }

  if (root === undefined || !responseCorrelates(answer, root)) proofEligible = false;
  const coverageEligible =
    root !== undefined &&
    responseCorrelates(answer, root) &&
    boundaryOutcomesCovered &&
    linearActionChainCovers([...traced].reverse());
  return {
    name: answer.name,
    request: root?.input ?? {},
    ...(proofEligible && root !== undefined
      ? { proof: { operations: answer.where, mayDrop: operationsMayDrop(root, answer.where) } }
      : {}),
    ...(coverageEligible ? { coverage: "linear-action" as const } : {}),
  };
}

function requestGuard(pattern: PatternIR): PatternIR {
  return Object.fromEntries(
    Object.entries(pattern)
      .filter(([key]) => !IGNORED_REQUEST_FIELDS.has(key))
      .map(([key, value]) => [key, value]),
  );
}

type PatternRelation = "overlaps" | "disjoint" | "unknown";

function literalValue(value: ValueIR): { known: true; value: unknown } | { known: false } {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return { known: true, value };
  }
  if (Array.isArray(value)) {
    const items = value.map(literalValue);
    return items.every((item) => item.known)
      ? { known: true, value: items.map((item) => (item as { value: unknown }).value) }
      : { known: false };
  }
  if (isVarIR(value)) return { known: false };
  if (value !== null && typeof value === "object") {
    const marker = asMarker(value);
    if (marker?.tag === "$lit") return { known: true, value: marker.payload };
    if (marker !== null) return { known: false };
    const entries = Object.entries(value).map(
      ([key, child]) => [key, literalValue(child)] as const,
    );
    return entries.every(([, item]) => item.known)
      ? {
          known: true,
          value: Object.fromEntries(
            entries.map(([key, item]) => [key, (item as { value: unknown }).value]),
          ),
        }
      : { known: false };
  }
  return { known: false };
}

function literalCandidates(value: ValueIR): unknown[] | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const marker = asMarker(value);
    if (marker?.tag === "$oneOf" && Array.isArray(marker.payload)) {
      const candidates = marker.payload.map((candidate) => literalValue(candidate as ValueIR));
      return candidates.every((candidate) => candidate.known)
        ? candidates.map((candidate) => (candidate as { value: unknown }).value)
        : undefined;
    }
  }
  const literal = literalValue(value);
  return literal.known ? [literal.value] : undefined;
}

function regexpValue(value: ValueIR): RegExp | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const marker = asMarker(value);
  if (marker?.tag !== "$regexp") return undefined;
  const payload = marker.payload as { source?: unknown; flags?: unknown };
  if (typeof payload.source !== "string" || typeof payload.flags !== "string") return undefined;
  try {
    return new RegExp(payload.source, payload.flags);
  } catch {
    return undefined;
  }
}

function regexpMatches(pattern: RegExp, candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  pattern.lastIndex = 0;
  const matches = pattern.test(candidate);
  pattern.lastIndex = 0;
  return matches;
}

function valueInhabited(value: ValueIR): "yes" | "empty" | "unknown" {
  if (isVarIR(value)) return "yes";
  const candidates = literalCandidates(value);
  if (candidates !== undefined) return candidates.length === 0 ? "empty" : "yes";
  return "unknown";
}

function valueRelation(left: ValueIR, right: ValueIR): PatternRelation {
  const leftCandidates = literalCandidates(left);
  const rightCandidates = literalCandidates(right);
  if (isVarIR(left) && isVarIR(right)) return "overlaps";
  if (isVarIR(left)) {
    return rightCandidates === undefined
      ? "unknown"
      : rightCandidates.length === 0
        ? "disjoint"
        : "overlaps";
  }
  if (isVarIR(right)) {
    return leftCandidates === undefined
      ? "unknown"
      : leftCandidates.length === 0
        ? "disjoint"
        : "overlaps";
  }
  if (leftCandidates !== undefined && rightCandidates !== undefined) {
    return leftCandidates.some((leftCandidate) =>
      rightCandidates.some((rightCandidate) => structurallyEqual(leftCandidate, rightCandidate)),
    )
      ? "overlaps"
      : "disjoint";
  }
  const leftRegexp = regexpValue(left);
  const rightRegexp = regexpValue(right);
  if (leftRegexp !== undefined && rightCandidates !== undefined) {
    return rightCandidates.some((candidate) => regexpMatches(leftRegexp, candidate))
      ? "overlaps"
      : "disjoint";
  }
  if (rightRegexp !== undefined && leftCandidates !== undefined) {
    return leftCandidates.some((candidate) => regexpMatches(rightRegexp, candidate))
      ? "overlaps"
      : "disjoint";
  }
  return "unknown";
}

function requestRelation(left: PatternIR, right: PatternIR): PatternRelation {
  let relation: PatternRelation = "overlaps";
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (IGNORED_REQUEST_FIELDS.has(key)) continue;
    const hasLeft = Object.hasOwn(left, key);
    const hasRight = Object.hasOwn(right, key);
    if (!hasLeft || !hasRight) {
      const inhabited = valueInhabited((hasLeft ? left : right)[key]);
      if (inhabited === "empty") return "disjoint";
      if (inhabited === "unknown") relation = "unknown";
      continue;
    }
    const field = valueRelation(left[key], right[key]);
    if (field === "disjoint") return "disjoint";
    if (field === "unknown") relation = "unknown";
  }
  return relation;
}

function requiredInputKeys(type: WireType): Set<string> {
  if (type.kind === "object") {
    return new Set(type.fields.filter(({ optional }) => optional !== true).map(({ key }) => key));
  }
  if (type.kind !== "union" || type.of.length === 0) return new Set();
  const [first, ...rest] = type.of.map(requiredInputKeys);
  return new Set([...first].filter((key) => rest.every((keys) => keys.has(key))));
}

function requestIsTotal(pattern: PatternIR, required: ReadonlySet<string>): boolean {
  return (
    openPattern(pattern) &&
    Object.keys(pattern).every((key) => ALWAYS_PRESENT_REQUEST_FIELDS.has(key) || required.has(key))
  );
}

function totalPath(path: AnswerPath, required: ReadonlySet<string>): boolean {
  return (
    requestIsTotal(path.request, required) &&
    (path.coverage === "linear-action" || (path.proof !== undefined && !path.proof.mayDrop))
  );
}

function analyzableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(analyzableValue);
  if (value === null || typeof value !== "object") return true;
  const marker = asMarker(value);
  if (marker !== null) {
    return (
      marker.tag === "$var" ||
      marker.tag === "$regexp" ||
      marker.tag === "$lit" ||
      (marker.tag === "$oneOf" &&
        Array.isArray(marker.payload) &&
        marker.payload.every(analyzableValue))
    );
  }
  return Object.values(value).every(analyzableValue);
}

function sameGuard(left: AnswerPath, right: AnswerPath): boolean {
  const leftProof = left.proof;
  const rightProof = right.proof;
  return (
    leftProof !== undefined &&
    rightProof !== undefined &&
    !leftProof.operations.some(({ op }) => op === "custom") &&
    !rightProof.operations.some(({ op }) => op === "custom") &&
    analyzableValue(left.request) &&
    leftProof.operations.every(analyzableValue) &&
    rightProof.operations.every(analyzableValue) &&
    structurallyEqual(requestGuard(left.request), requestGuard(right.request)) &&
    structurallyEqual(leftProof.operations, rightProof.operations)
  );
}

type FindOpIR = Extract<WhereOpIR, { op: "find" | "whether" }> & { op: "find" };

function singleFind(path: AnswerPath): FindOpIR | undefined {
  if (path.proof === undefined || path.proof.operations.length !== 1) return undefined;
  const condition = path.proof.operations[0];
  return condition.op === "find" ? (condition as FindOpIR) : undefined;
}

function overlapReason(
  left: AnswerPath,
  right: AnswerPath,
  required: ReadonlySet<string>,
): string | undefined {
  if (
    (left.proof === undefined && left.coverage === undefined) ||
    (right.proof === undefined && right.coverage === undefined) ||
    requestRelation(left.request, right.request) !== "overlaps"
  ) {
    return undefined;
  }
  if (totalPath(left, required) || totalPath(right, required)) {
    return "one answer path is unconditional";
  }
  if (sameGuard(left, right)) return "the complete answer guards are identical";
  const first = singleFind(left);
  const second = singleFind(right);
  if (
    first !== undefined &&
    second !== undefined &&
    structurallyEqual(
      "query" in first ? first.query : first.view,
      "query" in second ? second.query : second.view,
    ) &&
    structurallyEqual(first.in, second.in) &&
    structurallyEqual(requestGuard(left.request), requestGuard(right.request)) &&
    [first, second].some(
      ({ out, not }) =>
        Object.keys(out).length === 0 && (not === undefined || Object.keys(not).length === 0),
    )
  ) {
    return "a bare existence read also admits the more specific answer path";
  }
  return undefined;
}

function firstOverlap(
  paths: readonly AnswerPath[],
  required: ReadonlySet<string>,
): { left: AnswerPath; right: AnswerPath; reason: string } | undefined {
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      const reason = overlapReason(paths[left], paths[right], required);
      if (reason !== undefined) return { left: paths[left], right: paths[right], reason };
    }
  }
  return undefined;
}

function endpointPathOf(path: AnswerPath): string | undefined {
  if (!Object.hasOwn(path.request, "path")) return undefined;
  const value = literalValue(path.request.path);
  return value.known && typeof value.value === "string" ? value.value : undefined;
}

function endpointDiagnostics(
  app: AppIR,
  endpoints: readonly EndpointDeclaration[],
  wire: WireContractsIR,
): ApplicationDiagnostic[] {
  const diagnostics: ApplicationDiagnostic[] = [];
  const namesByPath = new Map<string, string[]>();
  for (const { name, path } of endpoints) {
    const names = namesByPath.get(path) ?? [];
    names.push(name);
    namesByPath.set(path, names);
  }
  const byName = new Map(app.reactions.map((reaction) => [reaction.name, reaction]));
  const boundaryOutcomesCovered = standardBoundaryOutcomesAreCovered(app.reactions);
  const answersByPath = new Map<string, AnswerPath[]>();
  for (const answer of app.reactions
    .filter(isResponse)
    .map((reaction) => traceAnswer(reaction, byName, boundaryOutcomesCovered))) {
    const answerPath = endpointPathOf(answer);
    if (answerPath === undefined) continue;
    const answers = answersByPath.get(answerPath) ?? [];
    answers.push(answer);
    answersByPath.set(answerPath, answers);
  }
  const wireByPath = new Map(wire.endpoints.map((endpoint) => [endpoint.path, endpoint.input]));
  for (const [path, names] of namesByPath) {
    const name = names.sort(ordinal).join(", ");
    const answers = answersByPath.get(path) ?? [];
    const required = requiredInputKeys(wireByPath.get(path) ?? { kind: "json" });
    const overlap = firstOverlap(answers, required);
    if (overlap !== undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ENDPOINT_PATH_OVERLAP",
        definition: { kind: "endpoint", name },
        endpoint: { name, path },
        message:
          `Endpoint "${name}" at "${path}" has potentially overlapping answer paths ` +
          `"${overlap.left.name}" and "${overlap.right.name}": ${overlap.reason}; all matching paths run.`,
      });
    }
    if (!answers.some((answer) => totalPath(answer, required))) {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_ENDPOINT_FALLBACK",
        definition: { kind: "endpoint", name },
        endpoint: { name, path },
        message:
          `Endpoint "${name}" at "${path}" has no recognized total answer path; ` +
          "an admitted request can time out when every answer guard drops.",
      });
    }
  }
  return diagnostics;
}

function unresolvedWireDiagnostics(wire: WireContractsIR): ApplicationDiagnostic[] {
  const diagnostics: ApplicationDiagnostic[] = [];
  const visit = (type: WireType, path: string, endpoint: string) => {
    for (const site of unresolvedWireLeaves(type, path, (at, index) => `${at}|${index}`)) {
      diagnostics.push({
        severity: "warning",
        code: "UNRESOLVED_WIRE_LEAF",
        definition: { kind: "endpoint", name: endpoint },
        endpoint: { name: endpoint, path: endpoint },
        message: `Endpoint "${endpoint}" has an unresolved wire leaf at ${site}.`,
      });
    }
  };
  for (const endpoint of wire.endpoints) {
    visit(endpoint.input, "input", endpoint.path);
    visit(endpoint.output, "output", endpoint.path);
  }
  return diagnostics;
}

function formerOrderDiagnostic(former: FormerIR): ApplicationDiagnostic | undefined {
  let sensitive = false;
  foldFormerNode(former.body, {
    node: (node) => {
      if (
        node.node === "distinct" ||
        (node.node === "each" && node.arranged === undefined) ||
        (node.node === "first" && node.arranged === undefined) ||
        ((node.node === "each" || node.node === "first") &&
          node.arranged !== undefined &&
          "order" in node.arranged)
      ) {
        sensitive = true;
      }
    },
  });
  return sensitive
    ? {
        severity: "info",
        code: "ORDER_SENSITIVE_FORMER",
        definition: { kind: "former", name: former.name },
        message: `Former "${former.name}" contains a source-order-sensitive selection.`,
      }
    : undefined;
}

export function applicationDiagnostics(
  app: AppIR,
  endpoints: readonly EndpointDeclaration[],
  wire: WireContractsIR,
): ApplicationDiagnostic[] {
  const endpointByReaction = new Map(
    endpoints.flatMap((endpoint) =>
      endpoint.reactions.map((reaction) => [reaction, endpoint] as const),
    ),
  );
  const diagnostics: ApplicationDiagnostic[] = [];
  const local = analyzeLocalBehavior(app);
  for (const { name, reason } of app.unlowered) {
    const endpoint = endpointByReaction.get(name);
    diagnostics.push(
      endpoint === undefined
        ? {
            severity: "warning",
            code: "UNLOWERED_REACTION",
            definition: { kind: "reaction", name },
            message: `Reaction "${name}" is local executable behavior: ${reason}.`,
          }
        : {
            severity: "error",
            code: "UNLOWERED_ENDPOINT",
            definition: { kind: "endpoint", name: endpoint.name },
            endpoint: { name: endpoint.name, path: endpoint.path },
            message: `Endpoint "${endpoint.name}" at "${endpoint.path}" contains forbidden local executable behavior: ${reason}.`,
          },
    );
  }
  for (const observed of local.localDefinitions) {
    const occurrences = local.occurrences.filter(
      ({ definition }) => localDefinitionKey(definition) === localDefinitionKey(observed),
    );
    const custom = occurrences.filter(({ kind }) => kind === "custom").length;
    const predicates = occurrences.filter(({ kind }) => kind === "identity-pattern").length;
    const definition = { kind: observed.kind, name: observed.name } as const;
    if (custom > 0) {
      diagnostics.push({
        severity: "warning",
        code: "OPAQUE_READ_OPERATION",
        definition,
        message: `${observed.kind} "${observed.name}" contains ${custom} local custom read operation${custom === 1 ? "" : "s"}; reasons: ${observed.reasons.join("; ")}.`,
      });
    }
    if (predicates > 0) {
      diagnostics.push({
        severity: "warning",
        code: "OPAQUE_PATTERN",
        definition,
        message: `${observed.kind} "${observed.name}" contains ${predicates} local object-identity pattern${predicates === 1 ? "" : "s"}; reasons: ${observed.reasons.join("; ")}.`,
      });
    }
  }
  for (const former of app.formers) {
    const order = formerOrderDiagnostic(former);
    if (order !== undefined) diagnostics.push(order);
  }
  diagnostics.push(
    ...endpointDiagnostics(app, endpoints, wire),
    ...unresolvedWireDiagnostics(wire),
  );
  return diagnostics.sort((left, right) => {
    const byCode = ordinal(left.code, right.code);
    if (byCode !== 0) return byCode;
    return ordinal(left.definition.name, right.definition.name);
  });
}

export function diagnosticsFail(
  diagnostics: readonly ApplicationDiagnostic[],
  policy: "errors" | "warnings" = "errors",
): boolean {
  return diagnostics.some(
    ({ severity }) => severity === "error" || (policy === "warnings" && severity === "warning"),
  );
}
