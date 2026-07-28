import type { EndpointDeclaration } from "@engine/boundary/assembly/endpoint-portability";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import type { WireType } from "@engine/boundary/wire/wire-types";
import type { AppIR, FormerIR, PatternIR, ReactionIR, ValueIR } from "@engine/reads/ir";
import { foldFormerNode, foldReaction, foldView } from "@engine/reads/schema";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "UNLOWERED_REACTION"
  | "UNLOWERED_ENDPOINT"
  | "OPAQUE_READ_OPERATION"
  | "OPAQUE_PATTERN"
  | "UNRESOLVED_WIRE_LEAF"
  | "DEPENDENCY_CYCLE"
  | "ENDPOINT_PATH_OVERLAP"
  | "ENDPOINT_LITERAL_UNCOVERED"
  | "MULTIPLE_RESPOND_CONSEQUENCES"
  | "MISSING_ENDPOINT_FALLBACK"
  | "ORDER_SENSITIVE_FORMER"
  | "INVALID_VALIDATOR_ATTACHMENT";

export interface ApplicationDiagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  definition: { kind: "application" | "endpoint" | "reaction" | "view" | "former"; name: string };
  endpoint?: { name: string; path: string };
  message: string;
}

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function walkValue(value: ValueIR, visit: (value: ValueIR) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const entry of value) walkValue(entry, visit);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const entry of Object.values(value)) {
    if (typeof entry === "object" && entry !== null) walkValue(entry as ValueIR, visit);
  }
}

function opaqueDiagnostics(
  definition: ApplicationDiagnostic["definition"],
  fold: (callbacks: Parameters<typeof foldReaction>[1]) => void,
): ApplicationDiagnostic[] {
  const diagnostics: ApplicationDiagnostic[] = [];
  let custom = 0;
  let predicates = 0;
  const pattern = (mapping: PatternIR) => {
    for (const value of Object.values(mapping)) {
      walkValue(value, (candidate) => {
        if (
          typeof candidate === "object" &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          "$is" in candidate
        ) {
          predicates++;
        }
      });
    }
  };
  fold({
    op: (op) => {
      if (op.op === "custom") custom++;
    },
    pattern,
  });
  if (custom > 0) {
    diagnostics.push({
      severity: "warning",
      code: "OPAQUE_READ_OPERATION",
      definition,
      message: `${definition.kind} "${definition.name}" contains ${custom} custom read operation${custom === 1 ? "" : "s"}; tooling treats the dependency as opaque.`,
    });
  }
  if (predicates > 0) {
    diagnostics.push({
      severity: "warning",
      code: "OPAQUE_PATTERN",
      definition,
      message: `${definition.kind} "${definition.name}" contains ${predicates} opaque predicate${predicates === 1 ? "" : "s"}; tooling cannot inspect its semantics.`,
    });
  }
  return diagnostics;
}

function reactionBelongsTo(reaction: ReactionIR, endpoint: EndpointDeclaration): boolean {
  return endpoint.reactions.some(
    (name) =>
      reaction.name === name ||
      reaction.name.startsWith(`${name}#`) ||
      reaction.name.startsWith(`${name}:`),
  );
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
    const responseCount = related.reduce(
      (count, reaction) =>
        count +
        reaction.then.filter(
          ({ concept, action }) => concept === "RequestBoundary" && action === "respond",
        ).length,
      0,
    );
    if (responseCount > 1) {
      diagnostics.push({
        severity: "warning",
        code: "MULTIPLE_RESPOND_CONSEQUENCES",
        definition: { kind: "endpoint", name: endpoint.name },
        endpoint: { name: endpoint.name, path: endpoint.path },
        message: `Endpoint "${endpoint.name}" at "${endpoint.path}" has ${responseCount} possible respond consequences; all matching branches run.`,
      });
    }
    if (answers.filter(({ where }) => where.length === 0).length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "ENDPOINT_PATH_OVERLAP",
        definition: { kind: "endpoint", name: endpoint.name },
        endpoint: { name: endpoint.name, path: endpoint.path },
        message: `Endpoint "${endpoint.name}" at "${endpoint.path}" has overlapping unconditional answer paths.`,
      });
    }
    if (answers.length > 0 && answers.every(({ where }) => where.length > 0)) {
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
    if (type.kind === "json") {
      diagnostics.push({
        severity: "warning",
        code: "UNRESOLVED_WIRE_LEAF",
        definition: { kind: "endpoint", name: endpoint },
        endpoint: { name: endpoint, path: endpoint },
        message: `Endpoint "${endpoint}" has an unresolved wire leaf at ${path}.`,
      });
      return;
    }
    if (type.kind === "array") visit(type.of, `${path}[]`, endpoint);
    if (type.kind === "object") {
      for (const field of type.fields) visit(field.type, `${path}.${field.key}`, endpoint);
    }
    if (type.kind === "union") {
      type.of.forEach((member, index) => visit(member, `${path}|${index}`, endpoint));
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
  const diagnostics: ApplicationDiagnostic[] = app.unlowered.map(({ name, reason }) => {
    const endpoint = endpointByReaction.get(name);
    return endpoint === undefined
      ? {
          severity: "warning",
          code: "UNLOWERED_REACTION",
          definition: { kind: "reaction", name },
          message: `Reaction "${name}" is executable only: ${reason}.`,
        }
      : {
          severity: "error",
          code: "UNLOWERED_ENDPOINT",
          definition: { kind: "endpoint", name: endpoint.name },
          endpoint: { name: endpoint.name, path: endpoint.path },
          message: `Endpoint "${endpoint.name}" at "${endpoint.path}" is executable only: ${reason}.`,
        };
  });
  for (const reaction of app.reactions) {
    diagnostics.push(
      ...opaqueDiagnostics({ kind: "reaction", name: reaction.name }, (fold) =>
        foldReaction(reaction, fold),
      ),
    );
  }
  for (const view of app.views) {
    diagnostics.push(
      ...opaqueDiagnostics({ kind: "view", name: view.name }, (fold) => foldView(view, fold)),
    );
  }
  for (const former of app.formers) {
    diagnostics.push(
      ...opaqueDiagnostics({ kind: "former", name: former.name }, (fold) =>
        foldFormerNode(former.body, fold),
      ),
    );
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
