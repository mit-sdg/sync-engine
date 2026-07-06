/**
 * Tests for the sync-graph diagnostics module — all 9 detectors,
 * covering both positive findings and false-positive resistance.
 *
 * @covers-devtools sync-graph/diagnostics
 */

import { describe, expect, test } from "bun:test";
import { runDiagnostics } from "@sync-engine/devtools/graph/diagnostics.ts";
import type {
  DiagnosticFinding,
  EndpointReachability,
  GraphEdge,
  GraphNode,
  SyncGraph,
} from "@sync-engine/devtools/graph/types.ts";

// ── Test fixture helpers ────────────────────────────────────────

/**
 * Build a hand-crafted SyncGraph from node and edge specs.
 * Defaults: kind → "concept-action", syncName → "Edge{i}",
 * hasWhere → false, endpoint → undefined.
 */
function g(
  nodes: Array<Partial<GraphNode> & { id: string }>,
  edges: Array<Partial<GraphEdge> & { from: string[]; to: string[] }>,
): SyncGraph {
  return {
    nodes: nodes.map((n: Partial<GraphNode> & { id: string }) => ({
      kind: "concept-action" as const,
      ...n,
    })),
    edges: edges.map(
      (
        e: Partial<GraphEdge> & { from: string[]; to: string[] },
        i: number,
      ) => ({
        syncName: e.syncName ?? `Edge${i}`,
        when: e.when ?? [],
        then: e.then ?? [],
        hasWhere: e.hasWhere ?? false,
        endpoint: e.endpoint,
        from: e.from,
        to: e.to,
      }),
    ),
    responseSinkId: "Requesting.respond",
  };
}

function findCode(
  haystack: DiagnosticFinding[],
  code: string,
): DiagnosticFinding[] {
  return haystack.filter((f: DiagnosticFinding) => f.code === code);
}

// ── Tests ───────────────────────────────────────────────────────

describe("runDiagnostics", () => {
  test("empty graph produces no findings", () => {
    const r = runDiagnostics(g([], []), []);
    expect(r.findings).toEqual([]);
    expect(r.summary.totalFindings).toBe(0);
    expect(r.summary.correctnessSmells).toBe(0);
    expect(r.summary.complexityHeuristics).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // Correctness smells
  // ═══════════════════════════════════════════════════════════════

  // ── unreachable-response ───────────────────────────────────

  test("unreachable-response: detects dead-end branch", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/test",
        respondsReachable: false,
        deadEndNodes: ["BrokenAction"],
        longestChain: 1,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    const findings = findCode(r.findings, "unreachable-response");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("/test");
    expect(findings[0].nodeIds).toContain("BrokenAction");
    expect(findings[0].severity).toBe("warning");
  });

  test("unreachable-response: no finding when all branches reach Respond", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/test",
        respondsReachable: true,
        deadEndNodes: [],
        longestChain: 2,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    expect(findCode(r.findings, "unreachable-response").length).toBe(0);
  });

  // ── dead-end-side-effect ───────────────────────────────────

  test("dead-end-side-effect: detects fire-and-forget audit/notification syncs", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/test",
        respondsReachable: true,
        deadEndNodes: ["Auditing.recordEvent"],
        longestChain: 2,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    // unreachable-response must NOT fire — Respond IS reachable
    expect(findCode(r.findings, "unreachable-response").length).toBe(0);
    // dead-end-side-effect MUST fire
    const findings = findCode(r.findings, "dead-end-side-effect");
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].nodeIds).toContain("/test");
    expect(findings[0].nodeIds).toContain("Auditing.recordEvent");
  });

  test("dead-end-side-effect: no finding when no dead ends exist", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/test",
        respondsReachable: true,
        deadEndNodes: [],
        longestChain: 2,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    expect(findCode(r.findings, "dead-end-side-effect").length).toBe(0);
  });

  // ── unhandled-error-output ─────────────────────────────────

  test("unhandled-error-output: detects unhandled error producer", () => {
    const graph = g(
      [
        { id: "BadAction", producesError: true },
        { id: "Requesting.respond" },
        { id: "OtherAction" },
      ],
      [
        {
          from: ["BadAction"],
          to: ["OtherAction"],
          syncName: "BadSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "unhandled-error-output");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("BadAction");
    expect(findings[0].syncNames).toContain("BadSync");
  });

  test("unhandled-error-output: no finding when error routes to Respond", () => {
    const graph = g(
      [{ id: "BadAction", producesError: true }, { id: "Requesting.respond" }],
      [
        {
          from: ["BadAction"],
          to: ["Requesting.respond"],
          syncName: "GoodSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "unhandled-error-output").length).toBe(0);
  });

  test("unhandled-error-output: no finding when error action has no consumers", () => {
    // This node has producesError but is never a source in any edge
    const graph = g(
      [
        { id: "UnusedErrorAction", producesError: true },
        { id: "Requesting.respond" },
        { id: "OtherAction" },
      ],
      [
        {
          from: ["OtherAction"],
          to: ["Requesting.respond"],
          syncName: "OtherSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "unhandled-error-output").length).toBe(0);
  });

  // ── orphan-action ──────────────────────────────────────────

  test("orphan-action: detects unreferenced node", () => {
    const graph = g(
      [{ id: "OrphanAction" }, { id: "ReferencedAction" }],
      [{ from: ["ReferencedAction"], to: ["ReferencedAction"] }],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "orphan-action");
    expect(
      findings.some((f: DiagnosticFinding) =>
        f.nodeIds.includes("OrphanAction"),
      ),
    ).toBe(true);
  });

  test("orphan-action: no finding when all nodes are referenced", () => {
    const graph = g([{ id: "A" }, { id: "B" }], [{ from: ["A"], to: ["B"] }]);
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "orphan-action").length).toBe(0);
  });

  test("orphan-action: skips endpoint nodes and Requesting.respond", () => {
    const graph = g(
      [{ id: "/endpoint", kind: "endpoint" }, { id: "Requesting.respond" }],
      [], // no edges → both would be orphans, but skippable
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "orphan-action").length).toBe(0);
  });

  // ── dangling-reference ─────────────────────────────────────

  test("dangling-reference: detects non-existent node in edge from", () => {
    const graph = g(
      [{ id: "RealAction" }],
      [{ from: ["GhostAction"], to: ["RealAction"], syncName: "GhostSync" }],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "dangling-reference");
    expect(findings.length).toBe(1);
    expect(findings[0].syncNames).toContain("GhostSync");
    expect(findings[0].nodeIds).toContain("GhostAction");
  });

  test("dangling-reference: detects non-existent node in edge to", () => {
    const graph = g(
      [{ id: "RealAction" }],
      [{ from: ["RealAction"], to: ["GhostTarget"], syncName: "GhostSync" }],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "dangling-reference");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("GhostTarget");
  });

  test("dangling-reference: no finding when all edges reference existing nodes", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }],
      [{ from: ["A"], to: ["B"], syncName: "ValidSync" }],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "dangling-reference").length).toBe(0);
  });

  // ── missing-auth-guard ─────────────────────────────────────
  //
  // The missing-auth-guard detector is now an app-specific plugin
  // (app/devtools/plugins/auth-guard.ts).  It is no longer part of the
  // app-agnostic built-in diagnostics.  Plugin-specific tests are in
  // app/tests/diagnostics-plugins/.

  // ═══════════════════════════════════════════════════════════════
  // Complexity heuristics
  // ═══════════════════════════════════════════════════════════════

  // ── heavy-where ────────────────────────────────────────────

  test("heavy-where: detects complex syncs", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }],
      [
        {
          from: ["A", "B", "C"],
          to: ["D", "E"],
          hasWhere: true,
          syncName: "ComplexSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "heavy-where");
    expect(findings.length).toBe(1);
    expect(findings[0].syncNames).toContain("ComplexSync");
  });

  test("heavy-where: no finding when unique actions below threshold", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }],
      [
        {
          from: ["A"],
          to: ["B"],
          hasWhere: true,
          syncName: "SimpleSync",
        },
      ],
    );
    // 2 unique actions < 5 threshold
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "heavy-where").length).toBe(0);
  });

  test("heavy-where: no finding when no hasWhere", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      [
        {
          from: ["A", "B"],
          to: ["C", "D"],
          hasWhere: false,
          syncName: "NonWhereSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "heavy-where").length).toBe(0);
  });

  // ── high-fan ───────────────────────────────────────────────

  test("high-fan: detects high fan-in sync", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }],
      [
        {
          from: ["A", "B", "C", "D", "E"],
          to: ["A"],
          syncName: "FanInSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "high-fan");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const fanIn: DiagnosticFinding | undefined = findings.find(
      (f: DiagnosticFinding) => f.syncNames.includes("FanInSync"),
    );
    expect(fanIn).toBeDefined();
  });

  test("high-fan: detects high fan-out sync", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }],
      [
        {
          from: ["A"],
          to: ["B", "C", "D", "E"],
          syncName: "FanOutSync",
        },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "high-fan");
    const fanOut: DiagnosticFinding | undefined = findings.find(
      (f: DiagnosticFinding) => f.syncNames.includes("FanOutSync"),
    );
    expect(fanOut).toBeDefined();
  });

  test("high-fan: detects hub actions referenced by many syncs", () => {
    const graph = g(
      [{ id: "HubAction" }],
      [
        { from: ["HubAction"], to: ["HubAction"], syncName: "Sync1" },
        { from: ["HubAction"], to: ["HubAction"], syncName: "Sync2" },
        { from: ["HubAction"], to: ["HubAction"], syncName: "Sync3" },
        { from: ["HubAction"], to: ["HubAction"], syncName: "Sync4" },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "high-fan");
    const hubFinding: DiagnosticFinding | undefined = findings.find(
      (f: DiagnosticFinding) =>
        f.nodeIds.includes("HubAction") && f.syncNames.length === 0,
    );
    expect(hubFinding).toBeDefined();
  });

  test("high-fan: no finding below thresholds", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }],
      [{ from: ["A", "B"], to: ["A", "B"], syncName: "LowFan" }],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "high-fan").length).toBe(0);
  });

  // ── deep-chain ─────────────────────────────────────────────

  test("deep-chain: detects long causal chains", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/deep",
        respondsReachable: true,
        deadEndNodes: [],
        longestChain: 7,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    const findings = findCode(r.findings, "deep-chain");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("/deep");
  });

  test("deep-chain: no finding for chains below threshold", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/shallow",
        respondsReachable: true,
        deadEndNodes: [],
        longestChain: 2,
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    expect(findCode(r.findings, "deep-chain").length).toBe(0);
  });

  test("deep-chain: treats exactly-at-threshold as a finding", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/exact",
        respondsReachable: true,
        deadEndNodes: [],
        longestChain: 5, // default threshold is 5
      },
    ];
    const r = runDiagnostics(g([], []), reachability);
    // >= 5 → finding
    expect(findCode(r.findings, "deep-chain").length).toBe(1);
  });

  // ── sync-cycle ─────────────────────────────────────────────

  test("sync-cycle: detects cycles in graph", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }],
      [
        { from: ["A"], to: ["B"], syncName: "AB" },
        { from: ["B"], to: ["A"], syncName: "BA" },
      ],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "sync-cycle");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("A");
    expect(findings[0].nodeIds).toContain("B");
  });

  test("sync-cycle: acyclic graph produces no cycle findings", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }],
      [
        { from: ["A"], to: ["B"], syncName: "AB" },
        { from: ["B"], to: ["C"], syncName: "BC" },
      ],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "sync-cycle").length).toBe(0);
  });

  test("sync-cycle: self-loop is detected as cycle", () => {
    const graph = g(
      [{ id: "SelfLoop" }],
      [{ from: ["SelfLoop"], to: ["SelfLoop"], syncName: "Self" }],
    );
    const r = runDiagnostics(graph, []);
    const findings = findCode(r.findings, "sync-cycle");
    expect(findings.length).toBe(1);
    expect(findings[0].nodeIds).toContain("SelfLoop");
  });

  test("sync-cycle: diamond pattern (A→B, A→C, B→D, C→D) is acyclic", () => {
    const graph = g(
      [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      [
        { from: ["A"], to: ["B"], syncName: "AB" },
        { from: ["A"], to: ["C"], syncName: "AC" },
        { from: ["B"], to: ["D"], syncName: "BD" },
        { from: ["C"], to: ["D"], syncName: "CD" },
      ],
    );
    const r = runDiagnostics(graph, []);
    expect(findCode(r.findings, "sync-cycle").length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // Summary correctness
  // ═══════════════════════════════════════════════════════════════

  test("summary counts correctness smells separately from heuristics", () => {
    const reachability: EndpointReachability[] = [
      {
        endpoint: "/test",
        respondsReachable: false,
        deadEndNodes: ["Broken"],
        longestChain: 1,
      },
    ];
    const graph = g(
      [{ id: "Broken" }, { id: "Ghost" }],
      [{ from: ["Ghost"], to: ["Broken"], syncName: "S" }],
    );
    const r = runDiagnostics(graph, reachability);
    expect(r.summary.totalFindings).toBeGreaterThan(0);
    expect(r.summary.correctnessSmells).toBeGreaterThan(0);
    // unreachable-response + dangling-reference = 2 smells; no heuristics
  });
});
