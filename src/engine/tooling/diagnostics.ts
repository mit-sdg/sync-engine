import type { EndpointDeclaration } from "@engine/boundary/assembly/endpoint-portability";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import { unresolvedWireLeaves } from "@engine/boundary/wire/wire-types";
import type { WireType } from "@engine/boundary/wire/wire-types";
import type { AppIR, FormerIR, ReactionIR } from "@engine/reads/ir";
import { analyzeLocalBehavior, localDefinitionKey } from "@engine/reads/local-behavior";
import { foldFormerNode } from "@engine/reads/schema";
import { canonicalJson } from "@engine/utils/canonical-json";
import { ordinal } from "@engine/utils/ordinal";
import { reactionNameBelongsTo } from "@engine/utils/reaction-name";

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

function reactionBelongsTo(reaction: ReactionIR, endpoint: EndpointDeclaration): boolean {
  return reactionNameBelongsTo(reaction.name, endpoint.reactions);
}

function hasEndpointCondition(reaction: ReactionIR): boolean {
  return reaction.where.some(({ op }) => op !== "earlier");
}

function endpointConditions(reaction: ReactionIR): ReactionIR["where"] {
  return reaction.where.filter(({ op }) => op !== "earlier");
}

interface ReadCondition {
  posture: "find" | "no";
  line: string;
}

function singleReadCondition(reaction: ReactionIR): ReadCondition | undefined {
  const conditions = endpointConditions(reaction);
  if (conditions.length !== 1) return undefined;
  const condition = conditions[0];
  if (condition.op !== "find" && condition.op !== "no") return undefined;
  const { op, ...line } = condition;
  return { posture: op, line: canonicalJson(line) };
}

function readConditions(reactions: readonly ReactionIR[]): ReadCondition[] {
  return reactions
    .map(singleReadCondition)
    .filter((condition): condition is ReadCondition => condition !== undefined);
}

function exhaustiveReadPair(reactions: readonly ReactionIR[]): boolean {
  const reads = readConditions(reactions);
  const present = new Set(
    reads.filter(({ posture }) => posture === "find").map(({ line }) => line),
  );
  return reads.some(({ posture, line }) => posture === "no" && present.has(line));
}

function duplicateReadPosture(reactions: readonly ReactionIR[]): "find" | "no" | undefined {
  const seen = new Set<string>();
  for (const { posture, line } of readConditions(reactions)) {
    const key = `${posture}\0${line}`;
    if (seen.has(key)) return posture;
    seen.add(key);
  }
  return undefined;
}

function endpointDiagnostics(
  app: AppIR,
  endpoints: readonly EndpointDeclaration[],
): ApplicationDiagnostic[] {
  const diagnostics: ApplicationDiagnostic[] = [];
  const byPath = new Map<string, EndpointDeclaration[]>();
  for (const endpoint of endpoints) {
    const declarations = byPath.get(endpoint.path) ?? [];
    declarations.push(endpoint);
    byPath.set(endpoint.path, declarations);
  }
  for (const [path, declarations] of byPath) {
    const endpoint: EndpointDeclaration = {
      name: declarations
        .map(({ name }) => name)
        .sort(ordinal)
        .join(", "),
      path,
      reactions: declarations.flatMap(({ reactions }) => reactions),
    };
    const related = app.reactions.filter((reaction) => reactionBelongsTo(reaction, endpoint));
    const answers = related.filter((reaction) =>
      reaction.then.some(
        ({ concept, action }) => concept === "RequestBoundary" && action === "respond",
      ),
    );
    const unconditional = answers.filter((reaction) => !hasEndpointCondition(reaction)).length;
    const duplicate = duplicateReadPosture(answers);
    if (unconditional > 1 || duplicate !== undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ENDPOINT_PATH_OVERLAP",
        definition: { kind: "endpoint", name: endpoint.name },
        endpoint: { name: endpoint.name, path: endpoint.path },
        message:
          duplicate === undefined
            ? `Endpoint "${endpoint.name}" at "${endpoint.path}" has overlapping unconditional answer paths.`
            : `Endpoint "${endpoint.name}" at "${endpoint.path}" has duplicate ${duplicate} answer conditions; both can respond to the same request.`,
      });
    }
    if (answers.every(hasEndpointCondition) && !exhaustiveReadPair(answers)) {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_ENDPOINT_FALLBACK",
        definition: { kind: "endpoint", name: endpoint.name },
        endpoint: { name: endpoint.name, path: endpoint.path },
        message: `Endpoint "${endpoint.name}" at "${endpoint.path}" has no explicit unconditional fallback; coverage cannot be proved.`,
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
  diagnostics.push(...endpointDiagnostics(app, endpoints), ...unresolvedWireDiagnostics(wire));
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
