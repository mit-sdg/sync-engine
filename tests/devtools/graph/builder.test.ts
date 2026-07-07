/**
 * Tests for the sync-graph builder module.
 *
 * @covers-devtools sync-graph/builder
 */

import { describe, expect, test } from "vite-plus/test";
import { buildSyncGraph } from "@sync-engine/devtools/graph/builder.ts";
import type {
  GraphEdge,
  GraphNode,
  PatternBinding,
  RequestBoundary,
} from "@sync-engine/devtools/graph/types.ts";
import { actions, branch, step, SyncConcept, type Vars } from "@sync-engine/engine";

// ── Mock concepts ────────────────────────────────────────────────

/** Simple concept with actions that produce normal and error outputs. */
class TestConcept {
  doSomething(_input: Record<string, unknown>) {
    return { result: "ok" };
  }
  failAction(_input: Record<string, unknown>) {
    return { error: "bad" };
  }
  noOutput(_input: Record<string, unknown>) {
    return {};
  }
}

/** Mock requesting concept — the builder matches it via the boundary descriptor. */
class RequestingConcept {
  request(_input: { path: string }) {
    return { request: "id" };
  }
  respond(_input: Record<string, unknown>) {
    return {};
  }
}

/** The request boundary the builder is given for these tests. */
const boundary: RequestBoundary = {
  conceptClass: RequestingConcept,
  entryAction: "request",
  exitAction: "respond",
  pathKey: "path",
};

// ── Tests ────────────────────────────────────────────────────────

describe("buildSyncGraph", () => {
  test("empty engine produces empty graph", () => {
    const engine = new SyncConcept();
    const graph = buildSyncGraph(engine, boundary);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  test("single sync creates nodes and edges", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      TestSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, { result }, { error: "bad" }]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].syncName).toBe("TestSync");
    expect(graph.edges[0].hasWhere).toBe(false);

    const nodeIds: string[] = graph.nodes.map((n: GraphNode) => n.id);
    expect(nodeIds).toContain("Test.doSomething");
    expect(nodeIds).toContain("Test.failAction");

    const failNode: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.failAction",
    );
    expect(failNode?.producesError).toBe(true);
    if (failNode?.outputs) {
      expect(failNode.outputs).toContain("error");
    }
  });

  test("sync with where clause sets hasWhere", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      FilteredSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        where: (frames) => frames,
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].hasWhere).toBe(true);
  });

  test("request anchor creates endpoint node", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());
    const req = engine.instrumentConcept(new RequestingConcept());

    engine.register({
      EndpointSync: ({ result }: Vars) => ({
        when: actions(
          [req.request, { path: "/test/endpoint" }, {}],
          [tc.doSomething, {}, { result }],
        ),
        then: actions([req.respond, { result, ok: true }]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);

    // Should have an endpoint node
    const endpointNode: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.kind === "endpoint",
    );
    expect(endpointNode).toBeDefined();
    expect(endpointNode?.id).toBe("/test/endpoint");

    // Edge should carry the endpoint path
    const edge = graph.edges[0];
    expect(edge.endpoint).toBe("/test/endpoint");

    // then side should reference Requesting.respond (stable id)
    expect(edge.to).toContain("Requesting.respond");
  });

  test("deduplicates nodes with same action id", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      SyncA: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
      SyncB: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    // Should deduplicate to only 2 unique nodes, not 4
    expect(graph.nodes.length).toBe(2);
    // But 2 edges
    expect(graph.edges.length).toBe(2);
  });

  test("infers output keys from patterns", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      OutputSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, { error: "sample" }]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const doNode: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.doSomething",
    );
    expect(doNode?.outputs).toBeDefined();
    expect(doNode?.outputs).toContain("result");

    const failNode: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.failAction",
    );
    expect(failNode?.outputs).toBeDefined();
    expect(failNode?.outputs).toContain("error");
  });

  test("duplicate output keys across syncs are merged", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    // Two syncs that both produce the same action but with different keys
    engine.register({
      SyncX: ({ result, detail }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, { error: "bad", detail }]),
      }),
      SyncY: ({ result, code }: Vars) => ({
        when: actions([tc.doSomething, {}, { result, code }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const doNode: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.doSomething",
    );
    // result should appear once (deduplicated)
    const resultCount: number | undefined = doNode?.outputs?.filter(
      (o: string) => o === "result",
    ).length;
    expect(resultCount).toBe(1);
    // code should also be captured
    expect(doNode?.outputs).toContain("code");
  });

  test("multiple request anchors produce separate endpoint nodes", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());
    const req = engine.instrumentConcept(new RequestingConcept());

    engine.register({
      EndpointA: ({ result }: Vars) => ({
        when: actions([req.request, { path: "/a" }, {}], [tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
      EndpointB: ({ result }: Vars) => ({
        when: actions([req.request, { path: "/b" }, {}], [tc.doSomething, {}, { result }]),
        then: actions([tc.noOutput, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const endpoints: GraphNode[] = graph.nodes.filter((n: GraphNode) => n.kind === "endpoint");
    expect(endpoints.length).toBe(2);
    const endpointIds: string[] = endpoints.map((n: GraphNode) => n.id).sort();
    expect(endpointIds).toEqual(["/a", "/b"]);
  });

  test("classifies var bindings from pattern values", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      VarSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const edge: GraphEdge | undefined = graph.edges[0];
    expect(edge).toBeDefined();

    // The when side's output binding should classify the symbol as "var"
    const varBinding: PatternBinding | undefined = edge.when[0]?.output?.find(
      (b: PatternBinding) => b.key === "result",
    );
    expect(varBinding).toBeDefined();
    expect(varBinding?.source).toEqual({ kind: "var", name: "result" });
  });

  test("classifies literal bindings from pattern values", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    // Use a literal path in the input (simulating endpoint-style literal)
    engine.register({
      LiteralSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, { path: "/test" }, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const edge: GraphEdge | undefined = graph.edges[0];
    expect(edge).toBeDefined();

    const literalBinding: PatternBinding | undefined = edge.when[0]?.input?.find(
      (b: PatternBinding) => b.key === "path",
    );
    expect(literalBinding).toBeDefined();
    expect(literalBinding?.source).toEqual({ kind: "literal", value: "/test" });
  });

  test("classifies expr bindings for non-primitive values", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      ExprSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, { config: { timeout: 1000 } }, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const edge: GraphEdge | undefined = graph.edges[0];
    expect(edge).toBeDefined();

    const exprBinding: PatternBinding | undefined = edge.when[0]?.input?.find(
      (b: PatternBinding) => b.key === "config",
    );
    expect(exprBinding).toBeDefined();
    expect(exprBinding?.source).toEqual({ kind: "expr" });
  });

  test("populates node.inputs from when patterns", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      InputSync: ({ result, detail }: Vars) => ({
        when: actions([tc.doSomething, { method: "POST", detail }, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const node: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.doSomething",
    );
    expect(node).toBeDefined();
    expect(node?.inputs).toBeDefined();
    expect(node?.inputs).toContain("method");
    expect(node?.inputs).toContain("detail");
  });

  test("deduplicates input keys across syncs", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      SyncOne: ({ result }: Vars) => ({
        when: actions([tc.doSomething, { action: "do" }, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
      SyncTwo: ({ result }: Vars) => ({
        when: actions([tc.doSomething, { action: "do", extra: true }, { result }]),
        then: actions([tc.failAction, {}, {}]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const node: GraphNode | undefined = graph.nodes.find(
      (n: GraphNode) => n.id === "Test.doSomething",
    );
    expect(node).toBeDefined();
    // "action" should appear only once (deduplicated)
    const actionCount: number | undefined = node?.inputs?.filter(
      (i: string) => i === "action",
    ).length;
    expect(actionCount).toBe(1);
    expect(node?.inputs).toContain("action");
    expect(node?.inputs).toContain("extra");
  });

  test("populates when/then bindings on edges", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      BindingSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: actions([tc.failAction, { result }, { error: "bad" }]),
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const edge: GraphEdge | undefined = graph.edges[0];
    expect(edge).toBeDefined();

    // when should have exactly one ActionBinding
    expect(edge.when).toBeDefined();
    expect(edge.when.length).toBe(1);
    expect(edge.when[0].nodeId).toBe("Test.doSomething");

    // then should have exactly one ActionBinding
    expect(edge.then).toBeDefined();
    expect(edge.then.length).toBe(1);
    expect(edge.then[0].nodeId).toBe("Test.failAction");

    // Verify structure of the then output binding
    const errorBinding: PatternBinding | undefined = edge.then[0]?.output?.find(
      (b: PatternBinding) => b.key === "error",
    );
    expect(errorBinding).toBeDefined();
    expect(errorBinding?.source).toEqual({ kind: "literal", value: "bad" });
  });

  test("flattens nested workflow steps into graph nodes and then bindings", () => {
    const engine = new SyncConcept();
    const tc = engine.instrumentConcept(new TestConcept());

    engine.register({
      NestedSync: ({ result }: Vars) => ({
        when: actions([tc.doSomething, {}, { result }]),
        then: [
          step([tc.noOutput, {}, {}], {
            then: [
              branch(
                {},
                {
                  then: [step([tc.failAction, { result }, { error: "bad" }])],
                },
              ),
            ],
          }),
        ],
      }),
    });

    const graph = buildSyncGraph(engine, boundary);
    const nodeIds = graph.nodes.map((node: GraphNode) => node.id);
    expect(nodeIds).toContain("Test.doSomething");
    expect(nodeIds).toContain("Test.noOutput");
    expect(nodeIds).toContain("Test.failAction");

    const edge = graph.edges[0];
    expect(edge.then.map((binding: { nodeId: string }) => binding.nodeId)).toEqual([
      "Test.noOutput",
      "Test.failAction",
    ]);
  });
});
