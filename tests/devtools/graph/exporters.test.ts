/**
 * Tests for the sync-graph exporters module — JSON, Mermaid, DOT, and CLI report.
 *
 * @covers-devtools sync-graph/exporters
 */

import { describe, expect, test } from "vite-plus/test";
import { toDot, toJson, toMermaid, toReport } from "@sync-engine/devtools/graph/exporters.ts";
import type { SyncGraphReport } from "@sync-engine/devtools/graph/types.ts";

// ── Fixtures ────────────────────────────────────────────────────

/** A minimal sample report with no findings. */
const cleanReport: SyncGraphReport = {
  graph: {
    nodes: [
      { id: "/test", kind: "endpoint" },
      {
        id: "Test.doSomething",
        kind: "concept-action",
        concept: "Test",
        outputs: ["result"],
      },
      { id: "Requesting.respond", kind: "concept-action" },
    ],
    edges: [
      {
        syncName: "TestSync",
        from: ["/test", "Test.doSomething"],
        to: ["Requesting.respond"],
        when: [],
        then: [],
        hasWhere: true,
        endpoint: "/test",
      },
    ],
    responseSinkId: "Requesting.respond",
  },
  reachability: [
    {
      endpoint: "/test",
      respondsReachable: true,
      deadEndNodes: [],
      longestChain: 2,
    },
  ],
  diagnostics: {
    findings: [],
    summary: {
      totalFindings: 0,
      correctnessSmells: 0,
      complexityHeuristics: 0,
    },
  },
  meta: {
    totalSyncs: 1,
    totalEndpoints: 1,
    totalConcepts: 1,
    generatedAt: "2025-01-01T00:00:00Z",
  },
};

/** A report with findings, for testing warning/info output. */
const reportWithFindings: SyncGraphReport = {
  ...cleanReport,
  diagnostics: {
    findings: [
      {
        code: "unreachable-response",
        severity: "warning",
        message: 'Endpoint "/test" has unreachable code paths.',
        syncNames: ["TestSync"],
        nodeIds: ["/test", "DeadEnd"],
        suggestion: "Add error handling.",
      },
      {
        code: "heavy-where",
        severity: "info",
        message: 'Sync "Complex" has a heavy where clause.',
        syncNames: ["Complex"],
        nodeIds: ["A", "B"],
        suggestion: "Simplify the where clause.",
      },
    ],
    summary: {
      totalFindings: 2,
      correctnessSmells: 1,
      complexityHeuristics: 1,
    },
  },
};

/** A report with bindings that carry a variable from when to then. */
const reportWithCarriedVars: SyncGraphReport = {
  graph: {
    nodes: [
      { id: "/login", kind: "endpoint" },
      {
        id: "Auth.authenticate",
        kind: "concept-action",
        concept: "Auth",
        outputs: ["user"],
        inputs: ["username", "password"],
      },
      {
        id: "Sessioning.createSession",
        kind: "concept-action",
        concept: "Sessioning",
        inputs: ["user"],
        outputs: ["sessionId"],
      },
      { id: "Requesting.respond", kind: "concept-action" },
    ],
    edges: [
      {
        syncName: "LoginStartsSession",
        from: ["Auth.authenticate"],
        to: ["Sessioning.createSession"],
        when: [
          {
            nodeId: "Auth.authenticate",
            input: [
              { key: "username", source: { kind: "var", name: "username" } },
              { key: "password", source: { kind: "var", name: "password" } },
            ],
            output: [{ key: "user", source: { kind: "var", name: "user" } }],
          },
        ],
        then: [
          {
            nodeId: "Sessioning.createSession",
            input: [{ key: "user", source: { kind: "var", name: "user" } }],
            output: [{ key: "sessionId", source: { kind: "var", name: "sessionId" } }],
          },
        ],
        hasWhere: false,
        endpoint: "/login",
      },
    ],
    responseSinkId: "Requesting.respond",
  },
  reachability: [
    {
      endpoint: "/login",
      respondsReachable: true,
      deadEndNodes: [],
      longestChain: 1,
    },
  ],
  diagnostics: {
    findings: [],
    summary: {
      totalFindings: 0,
      correctnessSmells: 0,
      complexityHeuristics: 0,
    },
  },
  meta: {
    totalSyncs: 1,
    totalEndpoints: 1,
    totalConcepts: 1,
    generatedAt: "2025-01-01T00:00:00Z",
  },
};

// ── Tests ───────────────────────────────────────────────────────

describe("toJson", () => {
  test("produces valid parseable JSON", () => {
    const json = toJson(cleanReport);
    const parsed = JSON.parse(json);
    expect(parsed.graph.nodes).toBeDefined();
    expect(parsed.graph.edges).toBeDefined();
    expect(parsed.graph.nodes).toHaveLength(3);
    expect(parsed.graph.edges).toHaveLength(1);
  });

  test("includes reachability and diagnostics", () => {
    const json = toJson(cleanReport);
    const parsed = JSON.parse(json);
    expect(parsed.reachability).toBeDefined();
    expect(parsed.reachability[0].endpoint).toBe("/test");
    expect(parsed.diagnostics.summary.totalFindings).toBe(0);
    expect(parsed.meta.totalSyncs).toBe(1);
  });

  test("preserves findings when present", () => {
    const json = toJson(reportWithFindings);
    const parsed = JSON.parse(json);
    expect(parsed.diagnostics.findings).toHaveLength(2);
    expect(parsed.diagnostics.findings[0].code).toBe("unreachable-response");
  });
});

describe("toMermaid", () => {
  test("produces valid mermaid syntax start", () => {
    const mermaid = toMermaid(cleanReport);
    expect(mermaid).toContain("```mermaid");
    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain("```");
  });

  test("includes edge labels from sync names", () => {
    const mermaid = toMermaid(cleanReport);
    expect(mermaid).toContain("TestSync");
  });

  test("includes styled endpoint node", () => {
    const mermaid = toMermaid(cleanReport);
    // Endpoint nodes get blue styling
    expect(mermaid).toContain("style");
    expect(mermaid).toContain("fill:#4a90d9");
  });

  test("edge labels include carried variables when present", () => {
    const mermaid = toMermaid(reportWithCarriedVars);
    expect(mermaid).toContain("LoginStartsSession · user");
  });

  test("edge labels do not append marker when no variables carried", () => {
    const mermaid = toMermaid(cleanReport);
    // cleanReport has empty when/then, so no carried vars — label should be just the sync name
    expect(mermaid).toContain('"TestSync"');
    expect(mermaid).not.toContain("·");
  });
});

describe("toDot", () => {
  test("produces valid digraph syntax", () => {
    const dot = toDot(cleanReport);
    expect(dot).toContain("digraph SyncGraph {");
    expect(dot).toContain("rankdir=LR;");
    expect(dot).toContain("->");
    expect(dot).toContain("}");
  });

  test("includes edge labels", () => {
    const dot = toDot(cleanReport);
    expect(dot).toContain("TestSync");
  });

  test("includes node styling for endpoints and concept actions", () => {
    const dot = toDot(cleanReport);
    // Endpoint color
    expect(dot).toContain('fillcolor="#4a90d9"');
    // Concept action color (green, not error)
    expect(dot).toContain('fillcolor="#6abf6a"');
  });

  test("edge labels include carried variables when present", () => {
    const dot = toDot(reportWithCarriedVars);
    expect(dot).toContain("LoginStartsSession · user");
  });

  test("edge labels do not append marker when no variables carried", () => {
    const dot = toDot(cleanReport);
    expect(dot).toContain('[label="TestSync"]');
    expect(dot).not.toContain("·");
  });
});

describe("toReport", () => {
  test("produces human-readable text with header", () => {
    const report = toReport(cleanReport);
    expect(report).toContain("Sync Graph Diagnostics Report");
  });

  test("shows meta information", () => {
    const report = toReport(cleanReport);
    expect(report).toContain("2025-01-01T00:00:00Z");
    expect(report).toContain("Syncs: 1");
  });

  test("shows success message when no findings", () => {
    const report = toReport(cleanReport);
    expect(report).toContain("No findings");
  });

  test("shows warnings and info sections when findings present", () => {
    const report = toReport(reportWithFindings);
    expect(report).toContain("Warnings");
    expect(report).toContain("Info");
    expect(report).toContain("unreachable-response");
    expect(report).toContain("heavy-where");
  });

  test("includes suggestions in findings output", () => {
    const report = toReport(reportWithFindings);
    expect(report).toContain("Add error handling.");
    expect(report).toContain("Simplify the where clause.");
  });

  test("ends with advisory-only footer when findings present", () => {
    const report = toReport(reportWithFindings);
    expect(report).toContain("Advisory only");
  });

  test("shows sync names for findings that have them", () => {
    const report = toReport(reportWithFindings);
    expect(report).toContain("TestSync");
  });

  test("shows findings summary counts", () => {
    const report = toReport(reportWithFindings);
    expect(report).toContain("Findings: 2");
    expect(report).toContain("1 smells");
  });
});
