/**
 * The Persisting package: durable JSONL logs, retention policies as prune
 * behavior, the Persisting concept's subject registry, and the audit feed
 * as queries over the record.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  faulted,
  MemoryStore,
  request,
  reaction,
  Reacting,
  when,
  type LogEvent,
  type Vars,
} from "@sync-engine/internal/reactions";
import { ActionConcept } from "@sync-engine/internal/reactions/actions.ts";
import { FrameworkErrorCode } from "@sync-engine/internal/boundary";
import {
  AuditFeed,
  FileStore,
  PersistingConcept,
  type PersistedEntry,
} from "@sync-engine/internal/hosting/persisting.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "persisting-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

class SourceConcept {
  emit({ tag }: { tag: string }) {
    return { tag };
  }
}
class SinkConcept {
  received: string[] = [];
  receive({ tag }: { tag: string }) {
    this.received.push(tag);
    return {};
  }
}

function engineOn(store: FileStore) {
  const reacting = new Reacting(new ActionConcept(store));
  const { Source, Sink } = reacting.instrument({
    Source: new SourceConcept(),
    Sink: new SinkConcept(),
  });
  reacting.register({
    Forward: reaction(({ tag }: Vars) =>
      when(Source.emit, { tag }, {}).then(request(Sink.receive, { tag })),
    ),
  });
  return { reacting, Source, Sink };
}

function readEntries(path: string): PersistedEntry[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as PersistedEntry);
}

describe("FileStore: the log survives as JSONL", () => {
  test("a live run appends invocation, outcome, and firing entries that cross-reference", async () => {
    const path = join(dir, "log.jsonl");
    const { Source } = engineOn(new FileStore(path));

    await Source.emit({ tag: "hello" });

    const entries = readEntries(path);
    const invocations = entries.filter((e) => e.kind === "invocation");
    const outcomes = entries.filter((e) => e.kind === "outcome");
    const firings = entries.filter((e) => e.kind === "firing");

    // emit + receive, each with an outcome, joined by one firing.
    expect(invocations.map((e) => `${e.concept}.${e.action}`)).toEqual([
      "Source.emit",
      "Sink.receive",
    ]);
    expect(outcomes.length).toBe(2);
    expect(firings.length).toBe(1);

    const emitId = invocations[0]!.id;
    const receiveId = invocations[1]!.id;
    expect(outcomes.map((e) => e.id)).toEqual([emitId, receiveId]);
    expect(Object.keys(firings[0]!.firing as object).sort()).toEqual([
      "at",
      "bindings",
      "consumed",
      "flow",
      "id",
      "produced",
      "reaction",
    ]);
    const firing = firings[0]!.firing as {
      reaction: string;
      consumed: string[];
      produced: string[];
      bindings: Record<string, unknown>;
    };
    expect(firing.reaction).toBe("Forward");
    expect(firing.consumed).toEqual([emitId]);
    expect(firing.produced).toEqual([receiveId]);
    expect(firing.bindings).toEqual({ tag: "hello" });
  });

  test("keepAll never prunes; the fold retains everything", async () => {
    const store = new FileStore(join(dir, "log.jsonl"), "keepAll");
    const { Source } = engineOn(store);

    await Source.emit({ tag: "a" });
    await Source.emit({ tag: "b" });

    expect(store.prune()).toBe(0);
    expect(store.actions.size).toBe(4);
  });

  test("a window policy evicts old flows from the fold but the file keeps the record", async () => {
    const path = join(dir, "log.jsonl");
    const store = new FileStore(path, { window: 1 });
    const { Source } = engineOn(store);

    await Source.emit({ tag: "first" }); // flow 1
    await Source.emit({ tag: "second" }); // flow 2 evicts flow 1 from the fold

    expect(store.flowIndex.size).toBe(1);
    const retained = [...store.actions.values()].map((r) => r.input.tag);
    expect(retained).toEqual(["second", "second"]);

    // Nothing already written was touched: all four invocations are on disk.
    const invocations = readEntries(path).filter((e) => e.kind === "invocation");
    expect(invocations.length).toBe(4);
    expect(store.firingsByReaction("Forward")).toHaveLength(1);
  });

  test("rejects invalid retention windows before creating a store", () => {
    for (const window of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new FileStore(join(dir, "log.jsonl"), { window })).toThrow(
        "window must be a non-negative finite integer",
      );
    }
  });

  test("credential inputs do not enter the retained fold or JSONL", () => {
    const path = join(dir, "log.jsonl");
    const store = new FileStore(path, "keepAll");
    const log = new ActionConcept(store);
    const sentinels = {
      password: "password-sentinel",
      oldPassword: "old-password-sentinel",
      newPassword: "new-password-sentinel",
      setupKey: "setup-key-sentinel",
    };

    const { id } = log.invoke({
      action: (() => {}) as never,
      concept: {},
      input: sentinels,
      flow: "credential-flow",
    });

    expect(store.byId(id)?.input).toEqual({
      password: "[redacted]",
      oldPassword: "[redacted]",
      newPassword: "[redacted]",
      setupKey: "[redacted]",
    });
    const serialized = readFileSync(path, "utf8");
    for (const sentinel of Object.values(sentinels)) expect(serialized).not.toContain(sentinel);
  });

  test("credential outputs are redacted in the retained fold and JSONL", async () => {
    const path = join(dir, "outputs.jsonl");
    const store = new FileStore(path, "keepAll");
    const reacting = new Reacting(new ActionConcept(store));
    const sentinels = {
      sessionToken: "file-session-sentinel",
      password: "file-password-sentinel",
      setupKey: "file-setup-key-sentinel",
    };
    class Sessioning {
      start(_: Record<PropertyKey, never>) {
        return sentinels;
      }
    }
    const Session = reacting.instrumentConcept(new Sessioning());

    expect(await Session.start({})).toEqual(sentinels);
    expect([...store.actions.values()][0]?.outcome).toEqual({
      kind: "result",
      value: {
        sessionToken: "[redacted]",
        password: "[redacted]",
        setupKey: "[redacted]",
      },
    });
    const serialized = readFileSync(path, "utf8");
    for (const sentinel of Object.values(sentinels)) expect(serialized).not.toContain(sentinel);
  });

  test("fault entries retain only validated classifications", async () => {
    const path = join(dir, "faults.jsonl");
    const store = new FileStore(path, "keepAll");
    const reacting = new Reacting(new ActionConcept(store));
    const observed: LogEvent[] = [];
    const matched: unknown[] = [];
    const sentinels = {
      message: "mongodb://fault-user:fault-password@example.test/private",
      detail: "detail-sentinel",
      code: "code-sentinel",
      cause: "cause-sentinel",
    };

    class Starting {
      run(_: Record<PropertyKey, never>) {
        return {};
      }
    }
    class Failing {
      run({ known }: { known: boolean }) {
        const error = new Error(sentinels.message, { cause: new Error(sentinels.cause) });
        Object.assign(error, {
          detail: sentinels.detail,
          code: known ? FrameworkErrorCode.NETWORK_ERROR : sentinels.code,
        });
        throw error;
      }
    }
    class FaultRecorder {
      record({ fault }: { fault: unknown }) {
        matched.push(fault);
        return {};
      }
    }

    const {
      Starting: Start,
      Failing: Fail,
      FaultRecorder: Recorder,
    } = reacting.instrument({
      Starting: new Starting(),
      Failing: new Failing(),
      FaultRecorder: new FaultRecorder(),
    });
    reacting.addObserver({
      onAction(event) {
        observed.push(event);
      },
    });
    reacting.register({
      FailAfterStart: () => when(Start.run, {}).then(request(Fail.run, { known: false })),
      RecordFault: ({ fault }: Vars) =>
        when(faulted({ fault })).then(request(Recorder.record, { fault })),
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let logged = "";
    try {
      await Start.run({});
      await expect(Fail.run({ known: true })).rejects.toThrow(sentinels.message);
    } finally {
      logged = errorSpy.mock.calls.map(([line]) => String(line)).join("\n");
      errorSpy.mockRestore();
    }

    expect(matched).toEqual([
      { error: FrameworkErrorCode.UNKNOWN_ERROR },
      { error: FrameworkErrorCode.NETWORK_ERROR },
    ]);
    const retainedFaults = [...store.actions.values()]
      .filter((record) => record.fault !== undefined)
      .map((record) => record.fault);
    expect(retainedFaults).toEqual(matched);

    const projections = [
      readFileSync(path, "utf8"),
      JSON.stringify([...store.actions.values()]),
      JSON.stringify(observed),
      logged,
    ];
    for (const projection of projections) {
      for (const sentinel of Object.values(sentinels)) expect(projection).not.toContain(sentinel);
    }
    expect(logged).toContain('"name":"Error"');
    expect(reacting.Action._getMatchingRecordCount()).toBe(0);
  });
});

describe("Persisting: subjects bind once and must be bound before release or prune", () => {
  test("bind refuses a duplicate subject; release refuses an unknown one", () => {
    const Persisting = new PersistingConcept();
    const store = new FileStore(join(dir, "log.jsonl"));

    expect(Persisting.bind({ subject: "engine-log", store, policy: "keepAll" })).toEqual({
      subject: "engine-log",
    });
    expect(() => Persisting.bind({ subject: "engine-log", store, policy: "keepAll" })).toThrow(
      'Subject "engine-log" is already bound.',
    );
    expect(Persisting._getBinding({ subject: "engine-log" })[0]?.policy).toBe("keepAll");

    expect(Persisting.release({ subject: "engine-log" })).toEqual({ subject: "engine-log" });
    expect(() => Persisting.release({ subject: "engine-log" })).toThrow(
      'Subject "engine-log" is not bound.',
    );
  });

  test("prune delegates to the bound store without interpreting the recorded policy", () => {
    class CountingStore extends MemoryStore {
      calls = 0;
      override prune(): number {
        this.calls += 1;
        return 3;
      }
    }
    const Persisting = new PersistingConcept();
    const store = new CountingStore();
    Persisting.bind({ subject: "engine-log", store, policy: "keepAll" });

    expect(Persisting.prune({ subject: "engine-log" })).toEqual({ evicted: 3 });
    expect(store.calls).toBe(1);
    expect(Persisting._getBinding({ subject: "engine-log" })[0]?.policy).toBe("keepAll");
    expect(() => Persisting.prune({ subject: "other" })).toThrow('Subject "other" is not bound.');
  });
});

describe("AuditFeed: the audit trail is a reading of the log", () => {
  test("byEntity finds occurrences mentioning a value, with the reactions that fired", async () => {
    const store = new FileStore(join(dir, "log.jsonl"));
    const { Source } = engineOn(store);
    const feed = new AuditFeed(store);

    await Source.emit({ tag: "target" });
    await Source.emit({ tag: "other" });

    const entries = feed.byEntity({ id: "target" });
    expect(entries.map((e) => `${e.concept}.${e.action}`)).toEqual(["Source.emit", "Sink.receive"]);
    expect(entries[0]?.firings).toEqual(["Forward"]);
    expect(entries[0]?.outcome).toEqual({ kind: "result", value: { tag: "target" } });
  });

  test("byConcept and byFlow slice the same record", async () => {
    const store = new FileStore(join(dir, "log.jsonl"));
    const { Source } = engineOn(store);
    const feed = new AuditFeed(store);

    await Source.emit({ tag: "a" });
    await Source.emit({ tag: "b" });

    expect(feed.byConcept({ concept: "Sink" }).length).toBe(2);
    expect(feed.byConcept({ concept: "Source", action: "emit" }).length).toBe(2);

    const flow = feed.byConcept({ concept: "Source" })[0]?.flow ?? "";
    const chain = feed.byFlow({ flow });
    expect(chain.map((e) => e.action)).toEqual(["emit", "receive"]);

    expect(feed.firingsOf({ reaction: "Forward" }).length).toBe(2);
  });
});
