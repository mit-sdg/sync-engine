/**
 * Output formatters for the sync-graph dev tool.
 *
 * Given a {@link SyncGraphReport} (graph + reachability + diagnostics), this
 * module exports to JSON, Mermaid, Graphviz DOT, and a human-readable CLI
 * report.
 *
 * This module is **app-agnostic**: it imports only from `./types.ts`.  Zero
 * imports from `@concepts` or `@sdk`.
 */

import type {
  ActionBinding,
  DiagnosticFinding,
  GraphNode,
  SyncGraphReport,
} from "./types.ts";

// ── Helpers ──────────────────────────────────────────────

/**
 * Compute the set of variable names that flow from when to then across a sync edge.
 * A variable is "carried" when it appears as a var-binding in any when-clause output
 * AND in any then-clause input.
 */
function carriedVars(when: ActionBinding[], then: ActionBinding[]): string[] {
  const whenOutVars = new Set<string>();
  for (const w of when) {
    for (const b of w.output) {
      if (b.source.kind === "var") whenOutVars.add(b.source.name);
    }
  }
  const thenInVars = new Set<string>();
  for (const t of then) {
    for (const b of t.input) {
      if (b.source.kind === "var") thenInVars.add(b.source.name);
    }
  }
  const carried: string[] = [];
  for (const v of whenOutVars) {
    if (thenInVars.has(v)) carried.push(v);
  }
  return carried.sort();
}

// ── JSON export ──────────────────────────────────────────

/**
 * Export the full report as a formatted JSON string.
 * This is the canonical format consumed by the viewer frontend.
 */
export function toJson(report: SyncGraphReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Mermaid export ───────────────────────────────────────

/**
 * Export the graph as a Mermaid flowchart.
 * Renders on GitHub, in markdown, and in many editors.
 */
export function toMermaid(report: SyncGraphReport): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];
  const { nodes, edges } = report.graph;

  // Track which node IDs have appeared (for graph direction)
  const seen = new Set<string>();

  for (const edge of edges) {
    for (const fromId of edge.from) {
      for (const toId of edge.to) {
        // Sanitize node IDs for Mermaid (replace special chars)
        const from = sanitizeId(fromId);
        const to = sanitizeId(toId);

        // Add nodes if not yet seen
        if (!seen.has(fromId)) {
          seen.add(fromId);
          const node = nodes.find((n) => n.id === fromId);
          lines.push(`    ${from}["${escapeLabel(fromId)}"]`);
          if (node) addStyle(lines, from, node);
        }
        if (!seen.has(toId)) {
          seen.add(toId);
          const node = nodes.find((n) => n.id === toId);
          lines.push(`    ${to}["${escapeLabel(toId)}"]`);
          if (node) addStyle(lines, to, node);
        }

        // Add edge with label — include carried variables when present
        const cvars = carriedVars(edge.when, edge.then);
        const labelText =
          cvars.length > 0
            ? `${edge.syncName} · ${cvars.join(", ")}`
            : edge.syncName;
        const label = escapeLabel(labelText);
        lines.push(`    ${from} -->|"${label}"| ${to}`);
      }
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/** Sanitize a node ID for use as a Mermaid node key. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Escape double-quotes in labels. */
function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Add a Mermaid style directive for the node based on its kind. */
function addStyle(lines: string[], nodeId: string, node: GraphNode): void {
  switch (node.kind) {
    case "endpoint":
      lines.push(`    style ${nodeId} fill:#4a90d9,stroke:#333,color:#fff`);
      break;
    case "concept-action":
      if (node.producesError) {
        lines.push(`    style ${nodeId} fill:#e8a838,stroke:#333`);
      } else {
        lines.push(`    style ${nodeId} fill:#6abf6a,stroke:#333`);
      }
      break;
    case "query":
      lines.push(`    style ${nodeId} fill:#d4d4d4,stroke:#999`);
      break;
  }
}

// ── Graphviz DOT export ──────────────────────────────────

/**
 * Export the graph as a Graphviz DOT digraph.
 * Can be rendered with `dot -Tsvg graph.dot -o graph.svg`.
 */
export function toDot(report: SyncGraphReport): string {
  const lines: string[] = ["digraph SyncGraph {"];
  lines.push("  rankdir=LR;");
  lines.push('  node [shape=box, style=filled, fontname="Helvetica"];');
  lines.push("");

  const { nodes, edges } = report.graph;
  const seen = new Set<string>();

  for (const edge of edges) {
    for (const fromId of edge.from) {
      for (const toId of edge.to) {
        const from = dotNodeId(fromId);
        const to = dotNodeId(toId);

        if (!seen.has(fromId)) {
          seen.add(fromId);
          const node = nodes.find((n) => n.id === fromId);
          lines.push(
            `  ${from} [label="${dotLabel(fromId)}"${dotAttrs(node)}];`,
          );
        }
        if (!seen.has(toId)) {
          seen.add(toId);
          const node = nodes.find((n) => n.id === toId);
          lines.push(`  ${to} [label="${dotLabel(toId)}"${dotAttrs(node)}];`);
        }

        const cvars = carriedVars(edge.when, edge.then);
        const labelText =
          cvars.length > 0
            ? `${edge.syncName} · ${cvars.join(", ")}`
            : edge.syncName;
        lines.push(`  ${from} -> ${to} [label="${dotLabel(labelText)}"];`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

function dotNodeId(id: string): string {
  return `node_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function dotLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}

function dotAttrs(node: GraphNode | undefined): string {
  if (!node) return "";
  switch (node.kind) {
    case "endpoint":
      return ', fillcolor="#4a90d9", fontcolor="white"';
    case "concept-action":
      return node.producesError
        ? ', fillcolor="#e8a838"'
        : ', fillcolor="#6abf6a"';
    case "query":
      return ', fillcolor="#d4d4d4", fontcolor="#666"';
    default:
      return "";
  }
}

// ── CLI report (human-readable) ──────────────────────────

/**
 * Generate a human-readable CLI report of the sync graph diagnostics.
 */
export function toReport(report: SyncGraphReport): string {
  const lines: string[] = [];
  const { meta, diagnostics } = report;
  const { findings, summary } = diagnostics;

  lines.push("═".repeat(60));
  lines.push("  Sync Graph Diagnostics Report");
  lines.push("═".repeat(60));
  lines.push(`  Generated: ${meta.generatedAt}`);
  lines.push(
    `  Syncs: ${meta.totalSyncs}  Endpoints: ${meta.totalEndpoints}  Concepts: ${meta.totalConcepts}`,
  );
  lines.push("");

  if (findings.length === 0) {
    lines.push("  ✓ No findings. All checks passed.");
    return lines.join("\n");
  }

  lines.push(
    `  Findings: ${summary.totalFindings} (${summary.correctnessSmells} smells, ${summary.complexityHeuristics} heuristics)`,
  );
  lines.push("─".repeat(60));

  // Group by severity, with correctness smells first
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  if (warnings.length > 0) {
    lines.push("");
    lines.push("  ⚠ Warnings (correctness smells):");
    for (const f of warnings) {
      formatFinding(lines, f);
    }
  }

  if (infos.length > 0) {
    lines.push("  ℹ Info (complexity heuristics):");
    for (const f of infos) {
      formatFinding(lines, f);
    }
  }

  lines.push("═".repeat(60));
  lines.push("  Advisory only — does not gate CI.");
  lines.push("═".repeat(60));

  return lines.join("\n");
}

/** Format a single diagnostic finding into the report lines. */
function formatFinding(lines: string[], f: DiagnosticFinding): void {
  lines.push(`    [${f.code}] ${f.message}`);
  if (f.syncNames.length > 0) {
    lines.push(`      Syncs: ${f.syncNames.join(", ")}`);
  }
  if (f.suggestion) {
    lines.push(`      → ${f.suggestion}`);
  }
  lines.push("");
}
