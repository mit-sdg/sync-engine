/**
 * Tests for the sync-graph reachability module.
 *
 * @covers-devtools sync-graph/reachability
 */

import { describe, expect, test } from "vite-plus/test";
import { computeReachability } from "@sync-engine/devtools/graph";
import type { EndpointReachability, SyncGraph } from "@sync-engine/devtools/graph";

// ── Helpers ─────────────────────────────────────────────────────

function makeGraph(edges: Array<{ from: string; to: string }>): SyncGraph {
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  }
  const nodes = [...nodeIds].map((id: string) => {
    let kind: SyncGraph["nodes"][number]["kind"];
    if (id === "Requesting.respond") {
      kind = "concept-action" as const;
    } else if (id.startsWith("/")) {
      kind = "endpoint" as const;
    } else {
      kind = "concept-action" as const;
    }
    return { id, kind };
  });
  const graphEdges = edges.map((e, i) => ({
    syncName: `Edge${i}`,
    from: [e.from],
    to: [e.to],
    when: [],
    then: [],
    hasWhere: false,
  }));
  return { nodes, edges: graphEdges, responseSinkId: "Requesting.respond" };
}

// ── Tests ───────────────────────────────────────────────────────

describe("computeReachability", () => {
  test("empty graph returns empty array", () => {
    const result = computeReachability({
      nodes: [],
      edges: [],
      responseSinkId: "Requesting.respond",
    });
    expect(result).toEqual([]);
  });

  test("single endpoint with Respond reachable", () => {
    const graph = makeGraph([
      { from: "/test", to: "SomeAction" },
      { from: "SomeAction", to: "Requesting.respond" },
    ]);
    const r = computeReachability(graph);
    expect(r.length).toBe(1);
    expect(r[0].respondsReachable).toBe(true);
    expect(r[0].deadEndNodes).toEqual([]);
    expect(r[0].longestChain).toBe(2);
  });

  test("endpoint with dead-end branch", () => {
    const graph = makeGraph([
      { from: "/test", to: "Action1" },
      { from: "Action1", to: "Requesting.respond" },
      { from: "/test", to: "Action2" }, // leaf — no outgoing edges
    ]);
    const r = computeReachability(graph);
    expect(r.length).toBe(1);
    // Overall Respond IS reachable (via Action1), but Action2 is a dead-end
    expect(r[0].respondsReachable).toBe(true);
    expect(r[0].deadEndNodes).toContain("Action2");
    expect(r[0].deadEndNodes).not.toContain("Action1");
  });

  test("endpoint with no Respond at all", () => {
    const graph = makeGraph([
      { from: "/test", to: "Action1" },
      { from: "Action1", to: "Action2" },
    ]);
    const r = computeReachability(graph);
    expect(r[0].respondsReachable).toBe(false);
    expect(r[0].deadEndNodes).toContain("Action2");
  });

  test("chain computes longest path correctly", () => {
    const graph = makeGraph([
      { from: "/test", to: "A" },
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "Requesting.respond" },
    ]);
    const r = computeReachability(graph);
    expect(r[0].longestChain).toBe(4);
  });

  test("graph with no endpoints returns empty", () => {
    const graph = makeGraph([{ from: "BackgroundTask", to: "OtherAction" }]);
    const r = computeReachability(graph);
    expect(r).toEqual([]);
  });

  test("multiple endpoints each analyzed independently", () => {
    const graph = makeGraph([
      { from: "/endpoint1", to: "A" },
      { from: "A", to: "Requesting.respond" },
      { from: "/endpoint2", to: "B" },
      { from: "B", to: "C" },
    ]);
    const r = computeReachability(graph);
    expect(r.length).toBe(2);
    const e1: EndpointReachability | undefined = r.find(
      (x: EndpointReachability) => x.endpoint === "/endpoint1",
    );
    const e2: EndpointReachability | undefined = r.find(
      (x: EndpointReachability) => x.endpoint === "/endpoint2",
    );
    expect(e1?.respondsReachable).toBe(true);
    expect(e1?.deadEndNodes).toEqual([]);
    expect(e2?.respondsReachable).toBe(false);
    expect(e2?.deadEndNodes).toContain("C");
  });

  test("fan-out edge connects from to multiple targets", () => {
    const graph = makeGraph([
      { from: "/fan", to: "A" },
      { from: "/fan", to: "B" },
      { from: "/fan", to: "C" },
      { from: "A", to: "Requesting.respond" },
      { from: "B", to: "Requesting.respond" },
      // C has no outgoing edge — dead end
    ]);
    const r = computeReachability(graph);
    expect(r.length).toBe(1);
    expect(r[0].respondsReachable).toBe(true); // via A or B
    expect(r[0].deadEndNodes).toContain("C");
  });

  test("longestChain is 0 when Respond not reachable", () => {
    const graph = makeGraph([{ from: "/orphan", to: "A" }]);
    const r = computeReachability(graph);
    expect(r[0].longestChain).toBe(0);
  });

  test("Respond node itself is not a dead-end", () => {
    const graph = makeGraph([{ from: "/test", to: "Requesting.respond" }]);
    const r = computeReachability(graph);
    expect(r[0].deadEndNodes).toEqual([]);
    expect(r[0].longestChain).toBe(1);
  });
});
