/**
 * Contract tests for log-store implementations.
 *
 * These pin the behavior any {@link LogStore} must provide: append-only
 * writes, immutable records (an outcome is a fold, not a mutation), indexed
 * reads, firing records, and eviction as a prune policy.
 */

import { describe, expect, test } from "vite-plus/test";
import { earlier, reaction, vocabulary, when } from "@sync-engine/language";

import {
  ActionConcept,
  type ActionRecord,
} from "@sync-engine/internal/reactions/runtime/actions.ts";
import {
  MemoryStore,
  type FiringRecord,
  type LogEntry,
} from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";

function record(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    action: {} as ActionRecord["action"],
    concept: {},
    input: { test: true },
    flow: "flow-1",
    ...overrides,
  };
}

function appendFiring(store: MemoryStore, id: string, reaction: string, consumed: string[]): void {
  store.append({
    kind: "firing",
    at: Date.now(),
    firing: {
      id,
      reaction,
      flow: "flow-1",
      bindings: {},
      consumed,
      produced: [],
      at: Date.now(),
    },
  });
}

function reflectedText(value: unknown): string {
  const seen = new Set<object>();
  const visit = (current: unknown): string => {
    if (typeof current === "string" || typeof current === "symbol") return String(current);
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function") ||
      seen.has(current)
    ) {
      return "";
    }
    seen.add(current);
    return Reflect.ownKeys(current)
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        return `${String(key)} ${visit(descriptor?.value)}`;
      })
      .join(" ");
  };
  return visit(value);
}

describe("log store: append and indexed reads", () => {
  test("an invocation entry is served by id and by flow", () => {
    const log = new ActionConcept(new MemoryStore());
    const { id } = log.invoke(record());

    expect(log._getById(id)?.input).toEqual({ test: true });
    expect(log._getByFlow("flow-1")?.length).toBe(1);
    expect(log._getByFlow("unknown")).toBeUndefined();
  });

  test("records within a flow keep invocation order", () => {
    const log = new ActionConcept(new MemoryStore());
    const a = log.invoke(record({ input: { n: 1 } })).id;
    const b = log.invoke(record({ input: { n: 2 } })).id;

    const flow = log._getByFlow("flow-1") ?? [];
    expect(flow.map((r) => r.id)).toEqual([a, b]);
  });

  test("stored invocation inputs redact credential fields", () => {
    const log = new ActionConcept(new MemoryStore());
    const sentinels = {
      password: "password-sentinel",
      oldPassword: "old-password-sentinel",
      newPassword: "new-password-sentinel",
      setupKey: "setup-key-sentinel",
    };
    const { id } = log.invoke(record({ input: { username: "priya", ...sentinels } }));

    expect(log._getById(id)?.input).toEqual({
      username: "priya",
      password: "[redacted]",
      oldPassword: "[redacted]",
      newPassword: "[redacted]",
      setupKey: "[redacted]",
    });
    const serialized = JSON.stringify(log._getById(id));
    for (const sentinel of Object.values(sentinels)) expect(serialized).not.toContain(sentinel);
  });
});

describe("log store: outcomes fold immutably", () => {
  test("attaching an outcome replaces the record instead of mutating it", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    const { id } = log.invoke(record());

    const pending = log._getById(id);
    expect(pending?.output).toBeUndefined();

    log.invoked({ id, output: { result: "ok" } });

    const resolved = log._getById(id);
    expect(resolved?.output).toEqual({ result: "ok" });
    expect(resolved?.outcome).toEqual({ kind: "result", value: { result: "ok" } });
    // The pending record was never written to; the fold produced a new one.
    expect(pending?.output).toBeUndefined();
    expect(resolved).not.toBe(pending);
  });

  test("the fold replaces the record at its position in the flow view", () => {
    const log = new ActionConcept(new MemoryStore());
    const first = log.invoke(record({ input: { n: 1 } })).id;
    const second = log.invoke(record({ input: { n: 2 } })).id;

    log.invoked({ id: first, output: { value: 1 } });

    const flow = log._getByFlow("flow-1") ?? [];
    expect(flow.map((r) => r.id)).toEqual([first, second]);
    expect(flow[0]?.outcome?.kind).toBe("result");
    expect(flow[1]?.outcome).toBeUndefined();
  });

  test("stored outputs and outcomes redact credential fields", () => {
    const log = new ActionConcept(new MemoryStore());
    const { id } = log.invoke(record());
    log.invoked({
      id,
      output: {
        sessionToken: "session-sentinel",
        password: "password-sentinel",
        setupKey: "setup-key-sentinel",
      },
    });

    expect(log._getById(id)?.output).toEqual({
      sessionToken: "[redacted]",
      password: "[redacted]",
      setupKey: "[redacted]",
    });
    expect(log._getById(id)?.outcome).toEqual({
      kind: "result",
      value: {
        sessionToken: "[redacted]",
        password: "[redacted]",
        setupKey: "[redacted]",
      },
    });
  });

  test("an outcome for an unknown id throws", () => {
    const log = new ActionConcept(new MemoryStore());
    expect(() => log.invoked({ id: "missing", output: {} })).toThrow(
      "Action with id missing not found.",
    );
  });
});

describe("log store: window retention", () => {
  test("reports a failed flow only at quiescence and before retention", () => {
    const store = new MemoryStore({ window: 0 });
    const log = new ActionConcept(store);
    const settled: Array<{ flow: string; interpreterFailed: boolean; retained: boolean }> = [];
    log._onFlowQuiescent((event) => {
      settled.push({ ...event, retained: store.flowIndex.has(event.flow) });
    });

    for (const id of ["root", "child"]) {
      log._beginMatchingInput({ id, flow: "flow", input: {} });
      log.invoke(record({ id, flow: "flow" }));
    }
    log._recordReactionFailure({
      reaction: "Broken",
      flow: "flow",
      triggerIds: ["root"],
      stage: "where",
      errorClass: "Error",
      at: Date.now(),
    });

    log._endMatchingInput("flow");
    expect(settled).toEqual([]);
    log._endMatchingInput("flow");

    expect(settled).toEqual([{ flow: "flow", interpreterFailed: true, retained: true }]);
    expect(store.flowIndex.has("flow")).toBe(false);
    expect(store.reactionFailures).toEqual([]);
  });

  test("retains only the newest settled flows", () => {
    const store = new MemoryStore({ window: 1 });
    const log = new ActionConcept(store);

    for (const name of ["first", "second"]) {
      const id = `${name}-id`;
      const flow = `${name}-flow`;
      log._beginMatchingInput({ id, flow, input: { name } });
      log.invoke(record({ id, flow, input: { name } }));
      store.append({
        kind: "reaction-failure",
        at: Date.now(),
        failure: {
          reaction: "TestFailure",
          flow,
          triggerIds: [id],
          stage: "where",
          errorClass: "Error",
          at: Date.now(),
        },
      });
      log.invoked({ id, output: { name } });
      log._endMatchingInput(flow);
    }

    expect([...store.flowIndex.keys()]).toEqual(["second-flow"]);
    expect([...store.actions.values()].map((entry) => entry.input.name)).toEqual(["second"]);
    expect(store.reactionFailures.map((failure) => failure.flow)).toEqual(["second-flow"]);
  });

  test("evicts a flow's interpreter failures with its last consumed record", () => {
    const store = new MemoryStore("evictConsumed");
    const log = new ActionConcept(store);
    const { id } = log.invoke(record());
    log._recordReactionFailure({
      reaction: "Broken",
      flow: "flow-1",
      triggerIds: [id],
      stage: "where",
      errorClass: "Error",
      at: Date.now(),
    });
    appendFiring(store, "firing", "Consumer", [id]);

    expect(store.prune()).toBe(1);
    expect(store.reactionFailures).toEqual([]);
  });

  test("rejects invalid windows", () => {
    for (const window of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new MemoryStore({ window })).toThrow(
        "MemoryStore: window must be a non-negative finite integer.",
      );
    }
  });

  test("orders the window by settlement rather than start", () => {
    const store = new MemoryStore({ window: 1 });
    const log = new ActionConcept(store);

    for (const name of ["first", "second"]) {
      log._beginMatchingInput({ id: name, flow: name, input: { name } });
      log.invoke(record({ id: name, flow: name, input: { name } }));
      log.invoked({ id: name, output: { name } });
    }

    log._endMatchingInput("second");
    expect([...store.flowIndex.keys()]).toEqual(["first", "second"]);

    log._endMatchingInput("first");
    expect([...store.flowIndex.keys()]).toEqual(["first"]);
  });
});

describe("log store: firing records", () => {
  test("firing entries are served by reaction name in order", () => {
    const store = new MemoryStore();
    const firing = (id: string): FiringRecord => ({
      id,
      reaction: "GrantOnAccept",
      flow: "flow-1",
      bindings: { invitation: "inv-1" },
      consumed: ["rec-1"],
      produced: ["rec-2"],
      at: Date.now(),
    });

    store.append({ kind: "firing", at: Date.now(), firing: firing("f1") });
    store.append({ kind: "firing", at: Date.now(), firing: firing("f2") });

    expect(store.firingsByReaction("GrantOnAccept").map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(store.firingsByReaction("Unknown")).toEqual([]);
  });

  test("hasConsumed derives from firing entries", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    const { id } = log.invoke(record());

    expect(store.hasConsumed(id, "SomeReaction")).toBe(false);

    store.append({
      kind: "firing",
      at: Date.now(),
      firing: {
        id: "f1",
        reaction: "SomeReaction",
        flow: "flow-1",
        bindings: {},
        consumed: [id],
        produced: [],
        at: Date.now(),
      },
    });

    expect(store.hasConsumed(id, "SomeReaction")).toBe(true);
    expect(store.hasConsumed(id, "OtherReaction")).toBe(false);
  });
});

describe("log store: firings are introspectable after a live run", () => {
  test("a fired reaction leaves a queryable firing with bindings, consumed, produced", async () => {
    const reacting = new Reacting();

    class Source {
      emit({ tag }: { tag: string }) {
        return { tag };
      }
    }
    class Sink {
      received: string[] = [];
      receive({ tag }: { tag: string }) {
        this.received.push(tag);
        return {};
      }
    }
    const refs = vocabulary({ concepts: { Source, Sink } }).concepts;

    const { Source: Src } = reacting.instrument({
      Source: new Source(),
      Sink: new Sink(),
    });

    reacting.register({
      Forward: reaction(({ tag }) =>
        when(refs.Source.emit({ tag }).responds()).then(refs.Sink.receive({ tag })),
      ),
    });

    await Src.emit({ tag: "hello" });

    const firings = reacting._getFirings("Forward");
    expect(firings.length).toBe(1);
    const firing = firings[0]!;
    expect(firing.bindings).toEqual({ tag: "hello" });
    expect(firing.consumed.length).toBe(1);
    expect(firing.produced.length).toBe(1);
    // The firing's references resolve back to log records: why → what.
    expect(reacting.Action._getById(firing.consumed[0]!)?.input).toEqual({ tag: "hello" });
    expect(reacting.Action._getById(firing.produced[0]!)?.input).toEqual({ tag: "hello" });
  });

  test("redaction does not change action execution or reaction input matching", async () => {
    const reacting = new Reacting();
    let sourceInput: unknown;
    let chainedInput: unknown;
    let earlierInput: unknown;
    const events: Array<{ action: string; input: Record<string, unknown> }> = [];

    class CredentialSource {
      change(input: {
        password: string;
        oldPassword: string;
        newPassword: string;
        setupKey: string;
      }) {
        sourceInput = input;
        return {};
      }
    }
    class CredentialSink {
      receive({ credentials }: { credentials: unknown }) {
        chainedInput = credentials;
        return {};
      }
    }
    class EarlierSink {
      receive({ credentials }: { credentials: unknown }) {
        earlierInput = credentials;
        return {};
      }
    }
    const refs = vocabulary({
      concepts: { Source: CredentialSource, Sink: CredentialSink, EarlierSink },
    }).concepts;

    const Source = reacting.instrumentConcept(new CredentialSource(), "Source");
    reacting.instrumentConcept(new CredentialSink(), "Sink");
    reacting.instrumentConcept(new EarlierSink(), "EarlierSink");
    reacting.addObserver({
      onAction(event) {
        events.push(event);
      },
    });
    reacting.register({
      ForwardCredentials: reaction(({ password, oldPassword, newPassword, setupKey }) =>
        when(refs.Source.change({ password, oldPassword, newPassword, setupKey }).responds()).then(
          refs.Sink.receive({
            credentials: { password, oldPassword, newPassword, setupKey },
          }),
        ),
      ),
      ReadEarlierCredentials: reaction(({ password, oldPassword, newPassword, setupKey }) =>
        when(refs.Sink.receive({}).responds())
          .where(earlier(refs.Source.change, { password, oldPassword, newPassword, setupKey }))
          .then(
            refs.EarlierSink.receive({
              credentials: { password, oldPassword, newPassword, setupKey },
            }),
          ),
      ),
    });
    const credentials = {
      password: "password-sentinel",
      oldPassword: "old-password-sentinel",
      newPassword: "new-password-sentinel",
      setupKey: "setup-key-sentinel",
    };

    await Source.change(credentials);

    expect(sourceInput).toEqual(credentials);
    expect(chainedInput).toEqual(credentials);
    expect(earlierInput).toEqual(credentials);
    expect(events.find((event) => event.action === "change")?.input).toEqual({
      password: "[redacted]",
      oldPassword: "[redacted]",
      newPassword: "[redacted]",
      setupKey: "[redacted]",
    });

    const retained = {
      actions: [...reacting.Action.actions.values()],
      firings: [...reacting.Action.store.firingsByReaction("ForwardCredentials")],
    };
    const reflected = reflectedText(retained);
    for (const sentinel of Object.values(credentials)) expect(reflected).not.toContain(sentinel);
    expect(reacting.Action._getMatchingRecordCount()).toBe(0);
    expect(reacting._getFirings("ForwardCredentials")[0]?.bindings).toEqual({
      password: "[redacted]",
      oldPassword: "[redacted]",
      newPassword: "[redacted]",
      setupKey: "[redacted]",
    });
  });

  test("raw outputs serve direct returns, chain matching, and earlier matching only", async () => {
    const reacting = new Reacting();
    const output = {
      sessionToken: "session-token-sentinel",
      token: "token-sentinel",
      password: "password-sentinel",
      setupKey: "setup-key-sentinel",
    };
    let chainedOutput: unknown;
    let earlierOutput: unknown;
    const matchedOutputs: unknown[] = [];
    const events: Array<{
      action: string;
      output: Record<string, unknown>;
      outcome?: unknown;
    }> = [];

    class Starting {
      run(_: Record<PropertyKey, never>) {
        return {};
      }
    }
    class Issuing {
      issue(_: Record<PropertyKey, never>) {
        return output;
      }
    }
    class ChainSink {
      receive(values: typeof output) {
        chainedOutput = values;
        return {};
      }
    }
    class EarlierSink {
      receive(values: typeof output) {
        earlierOutput = values;
        return {};
      }
    }
    class MatchingSink {
      receive(values: typeof output) {
        matchedOutputs.push(values);
        return {};
      }
    }
    const refs = vocabulary({
      concepts: { Starting, Issuing, ChainSink, EarlierSink, MatchingSink },
    }).concepts;

    const { Starting: Start, Issuing: Issuer } = reacting.instrument({
      Starting: new Starting(),
      Issuing: new Issuing(),
      ChainSink: new ChainSink(),
      EarlierSink: new EarlierSink(),
      MatchingSink: new MatchingSink(),
    });
    reacting.addObserver({ onAction: (event) => events.push(event) });
    reacting.register({
      ChainOutput: reaction(({ sessionToken, token, password, setupKey }) =>
        when(refs.Starting.run({}).responds())
          .then(refs.Issuing.issue({}).responds({ sessionToken, token, password, setupKey }))
          .then(refs.ChainSink.receive({ sessionToken, token, password, setupKey })),
      ),
      ReadEarlierOutput: reaction(({ sessionToken, token, password, setupKey }) =>
        when(refs.ChainSink.receive({}).responds())
          .where(earlier(refs.Issuing.issue, {}, { sessionToken, token, password, setupKey }))
          .then(refs.EarlierSink.receive({ sessionToken, token, password, setupKey })),
      ),
      MatchOutput: reaction(({ sessionToken, token, password, setupKey }) =>
        when(refs.Issuing.issue({}).responds({ sessionToken, token, password, setupKey })).then(
          refs.MatchingSink.receive({ sessionToken, token, password, setupKey }),
        ),
      ),
    });

    expect(await Issuer.issue({})).toEqual(output);
    await Start.run({});

    expect(chainedOutput).toEqual(output);
    expect(earlierOutput).toEqual(output);
    expect(matchedOutputs).toEqual([output, output]);
    const redactedOutput = {
      sessionToken: "[redacted]",
      token: "[redacted]",
      password: "[redacted]",
      setupKey: "[redacted]",
    };
    const issueRecords = [...reacting.Action.actions.values()].filter(
      (candidate) => candidate.action === Issuer.issue,
    );
    expect(issueRecords).toHaveLength(2);
    for (const issue of issueRecords) {
      expect(issue.output).toEqual(redactedOutput);
      expect(issue.outcome).toEqual({ kind: "result", value: redactedOutput });
    }
    const issueEvents = events.filter((event) => event.action === "issue");
    expect(issueEvents).toHaveLength(2);
    for (const event of issueEvents) {
      expect(event.output).toEqual(redactedOutput);
      expect(event.outcome).toEqual({ kind: "result", value: redactedOutput });
    }
    const retained = {
      actions: [...reacting.Action.actions.values()],
      firings: [
        ...reacting.Action.store.firingsByReaction("ChainOutput"),
        ...reacting.Action.store.firingsByReaction("ReadEarlierOutput"),
        ...reacting.Action.store.firingsByReaction("MatchOutput"),
      ],
    };
    const reflected = reflectedText(retained);
    for (const sentinel of Object.values(output)) expect(reflected).not.toContain(sentinel);
    expect(reacting.Action._getMatchingRecordCount()).toBe(0);
  });

  test("custom sinks receive redacted output entries before indexing", async () => {
    class CapturingSink {
      readonly entries: LogEntry[] = [];

      append(entry: LogEntry): void {
        this.entries.push(entry);
      }
    }
    class Issuing {
      issue(_: Record<PropertyKey, never>) {
        return { sessionToken: "custom-store-session-sentinel" };
      }
    }
    const sink = new CapturingSink();
    const store = new MemoryStore("evictConsumed", sink);
    const reacting = new Reacting(new ActionConcept(store));
    const Issuer = reacting.instrumentConcept(new Issuing());

    expect(await Issuer.issue({})).toEqual({
      sessionToken: "custom-store-session-sentinel",
    });
    expect(reflectedText(sink.entries)).not.toContain("custom-store-session-sentinel");
    expect(store.actions.values().next().value?.output).toEqual({ sessionToken: "[redacted]" });
  });

  test("validates entries before the sink and indexes only after a successful append", () => {
    const seen: LogEntry[] = [];
    const store = new MemoryStore("keepAll", {
      append(entry) {
        expect(store.actions.size).toBe(0);
        seen.push(entry);
      },
    });

    expect(() =>
      store.append({
        kind: "outcome",
        at: 1,
        id: "missing",
        output: {},
        outcome: { kind: "result", value: {} },
      }),
    ).toThrow("Action with id missing not found");
    expect(seen).toEqual([]);

    store.append({ kind: "invocation", at: 1, record: record({ id: "accepted" }) });
    expect(seen).toHaveLength(1);
    expect(store.actions.has("accepted")).toBe(true);
  });

  test("leaves the index unchanged when a sink throws", () => {
    const failure = new Error("sink unavailable");
    const store = new MemoryStore("keepAll", {
      append() {
        throw failure;
      },
    });

    expect(() =>
      store.append({ kind: "invocation", at: 1, record: record({ id: "rejected" }) }),
    ).toThrow(failure);
    expect(store.actions.size).toBe(0);
  });
});

describe("log store: eviction is a prune policy", () => {
  test("evictFlow drops a flow from both views", () => {
    const log = new ActionConcept(new MemoryStore());
    const { id } = log.invoke(record());

    log.evictFlow("flow-1");

    expect(log._getById(id)).toBeUndefined();
    expect(log._getByFlow("flow-1")).toBeUndefined();
  });

  test("prune evicts trailing records consumed by their reactions", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    const kept = log.invoke(record({ input: { n: 1 } })).id;
    const consumed = log.invoke(record({ input: { n: 2 } })).id;
    store.append({
      kind: "firing",
      at: Date.now(),
      firing: {
        id: "f1",
        reaction: "SomeReaction",
        flow: "flow-1",
        bindings: {},
        consumed: [consumed],
        produced: ["produced"],
        at: Date.now(),
      },
    });

    const evicted = log.evictConsumedFlows();

    expect(evicted).toBe(1);
    expect(log._getById(consumed)).toBeUndefined();
    expect(log._getById(kept)).toBeDefined();
  });

  test("pruning [a, gap, b] preserves a multi-trigger firing's evidence for a", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    for (const id of ["a", "gap", "b"]) log.invoke(record({ id }));
    appendFiring(store, "pair-firing", "Pair", ["a", "b"]);

    expect(store.prune()).toBe(1);

    expect(log._getByFlow("flow-1")?.map(({ id }) => id)).toEqual(["a", "gap"]);
    expect(store.hasConsumed("a", "Pair")).toBe(true);
    expect(store.hasConsumed("b", "Pair")).toBe(false);
    expect(store.firingsByReaction("Pair")).toMatchObject([
      { id: "pair-firing", consumed: ["a", "b"] },
    ]);
  });

  test("repeated pruning preserves evidence through successive partial firing eviction", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    for (const id of ["a", "gap-1", "b", "gap-2", "c"]) log.invoke(record({ id }));
    appendFiring(store, "triple-firing", "Triple", ["a", "b", "c"]);

    expect(store.prune()).toBe(1);
    appendFiring(store, "gap-firing", "Gap", ["gap-2"]);
    expect(store.prune()).toBe(2);
    expect(store.prune()).toBe(0);

    expect(log._getByFlow("flow-1")?.map(({ id }) => id)).toEqual(["a", "gap-1"]);
    expect(store.hasConsumed("a", "Triple")).toBe(true);
    expect(store.hasConsumed("b", "Triple")).toBe(false);
    expect(store.hasConsumed("c", "Triple")).toBe(false);
    expect(store.firingsByReaction("Triple")).toHaveLength(1);
  });

  test("mixed retained and evicted consumption keeps only firings with retained evidence", () => {
    const store = new MemoryStore();
    const log = new ActionConcept(store);
    for (const id of ["a", "gap", "b"]) log.invoke(record({ id }));
    appendFiring(store, "pair-firing", "Pair", ["a", "b"]);
    appendFiring(store, "tail-firing", "Tail", ["b"]);

    expect(store.prune()).toBe(1);

    expect(store.firingsByReaction("Pair")).toHaveLength(1);
    expect(store.firingsByReaction("Tail")).toEqual([]);
    expect(store.consumedBy("a")).toEqual(["Pair"]);
    expect(store.consumedBy("b")).toEqual([]);

    appendFiring(store, "gap-firing", "Gap", ["gap"]);
    expect(store.prune()).toBe(2);
    expect(store.firingsByReaction("Pair")).toEqual([]);
    expect(store.consumedBy("a")).toEqual([]);
  });
});
