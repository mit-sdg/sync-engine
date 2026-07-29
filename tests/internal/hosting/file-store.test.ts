/**
 * FileStore composes a live in-memory occurrence index with append-only JSONL
 * auditing. The audit is intentionally not replayed into a new runtime index.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { faulted, type LogEvent } from "@sync-engine/advanced";
import { reaction, vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { FrameworkErrorCode } from "@sync-engine/boundary";
import { FileStore } from "@sync-engine/internal/hosting/file-store.ts";

type AuditEntry =
  | {
      kind: "invocation";
      id: string;
      flow: string;
      concept: string;
      action: string;
      input: unknown;
    }
  | { kind: "outcome"; id: string; outcome: unknown }
  | { kind: "firing"; firing: unknown }
  | { kind: "reaction-failure"; failure: unknown }
  | { kind: "integrity-failure"; failure: unknown }
  | { kind: "fault"; id: string; fault: unknown };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "file-store-"));
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

const refs = vocabulary({
  concepts: { Source: SourceConcept, Sink: SinkConcept },
}).concepts;

function engineOn(store: FileStore) {
  const reacting = new Reacting(new ActionConcept(store));
  const { Source, Sink } = reacting.instrument({
    Source: new SourceConcept(),
    Sink: new SinkConcept(),
  });
  reacting.register({
    Forward: reaction(({ tag }: Vars) =>
      when(refs.Source.emit({ tag }).responds()).then(refs.Sink.receive({ tag })),
    ),
  });
  return { reacting, Source, Sink };
}

function readEntries(path: string): AuditEntry[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AuditEntry);
}

describe("FileStore: the log survives as JSONL", () => {
  test("indexes and audits the same entries", async () => {
    const path = join(dir, "composed.jsonl");
    const store = new FileStore(path);
    const { Source } = engineOn(store);

    await Source.emit({ tag: "indexed-and-audited" });

    expect([...store.actions.values()].map((entry) => entry.input.tag)).toEqual([
      "indexed-and-audited",
      "indexed-and-audited",
    ]);
    expect(readEntries(path).filter((entry) => entry.kind === "invocation")).toHaveLength(2);
  });

  test("does not replay an existing audit into a new occurrence index", async () => {
    const path = join(dir, "non-replayable.jsonl");
    const first = new FileStore(path);
    await engineOn(first).Source.emit({ tag: "first" });
    const second = new FileStore(path);
    expect(second.actions.size).toBe(0);
    expect(second.flowIndex.size).toBe(0);

    await engineOn(second).Source.emit({ tag: "second" });
    expect([...second.actions.values()].map((entry) => entry.input.tag)).toEqual([
      "second",
      "second",
    ]);
    expect(readEntries(path).filter((entry) => entry.kind === "invocation")).toHaveLength(4);
  });

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

  test("a where failure is durable without consuming its trigger", async () => {
    const path = join(dir, "log.jsonl");
    const { reacting, Source } = engineOn(new FileStore(path));
    reacting.register({
      BadWhere: reaction(({ tag }: Vars) =>
        when(refs.Source.emit({ tag }).responds())
          .where(() => {
            throw new TypeError("private diagnostic");
          })
          .then(refs.Source.emit({ tag })),
      ),
    });

    await Source.emit({ tag: "failed" });

    const failures = readEntries(path).filter((entry) => entry.kind === "reaction-failure");
    expect(failures).toMatchObject([
      {
        failure: {
          reaction: "BadWhere",
          stage: "where",
          errorClass: "TypeError",
        },
      },
    ]);
    expect(JSON.stringify(failures)).not.toContain("private diagnostic");
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

  test("a window keeps concurrent flows until their outcomes can be appended", async () => {
    const path = join(dir, "concurrent.jsonl");
    const store = new FileStore(path, { window: 1 });
    const reacting = new Reacting(new ActionConcept(store));
    class SettlingConcept {
      async settle({ tag }: { tag: string }) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { tag };
      }
    }
    const Settling = reacting.instrumentConcept(new SettlingConcept());

    await Promise.all([Settling.settle({ tag: "first" }), Settling.settle({ tag: "second" })]);

    expect([...store.actions.values()].map((record) => record.input.tag)).toEqual(["second"]);
    const entries = readEntries(path);
    expect(entries.filter((entry) => entry.kind === "invocation")).toHaveLength(2);
    expect(entries.filter((entry) => entry.kind === "outcome")).toHaveLength(2);
  });

  test("a window keeps concurrent flows until their faults can be appended", async () => {
    const path = join(dir, "concurrent-fault.jsonl");
    const store = new FileStore(path, { window: 1 });
    const reacting = new Reacting(new ActionConcept(store));
    class SettlingConcept {
      async settle({ fail }: { fail: boolean }) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (fail) throw new Error("expected fault");
        return {};
      }
    }
    const Settling = reacting.instrumentConcept(new SettlingConcept());

    const faulted = Settling.settle({ fail: true });
    const completed = Settling.settle({ fail: false });
    await expect(faulted).rejects.toThrow("expected fault");
    await expect(completed).resolves.toEqual({});

    const entries = readEntries(path);
    expect(entries.filter((entry) => entry.kind === "fault")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "outcome")).toHaveLength(1);
  });

  test("a zero window lets an action complete before evicting its flow", async () => {
    const path = join(dir, "zero.jsonl");
    const store = new FileStore(path, { window: 0 });
    const { Source, Sink } = engineOn(store);

    await expect(Source.emit({ tag: "complete" })).resolves.toEqual({ tag: "complete" });

    expect(Sink.received).toEqual(["complete"]);
    expect(store.actions.size).toBe(0);
    expect(store.flowIndex.size).toBe(0);
    expect(readEntries(path).map((entry) => entry.kind)).toEqual([
      "invocation",
      "outcome",
      "invocation",
      "outcome",
      "firing",
    ]);
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
    const faultRefs = vocabulary({
      concepts: { Starting, Failing, FaultRecorder },
    }).concepts;

    const { Starting: Start, Failing: Fail } = reacting.instrument({
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
      FailAfterStart: () =>
        when(faultRefs.Starting.run({}).responds()).then(faultRefs.Failing.run({ known: false })),
      RecordFault: ({ fault }: Vars) =>
        when(faulted({ fault })).then(faultRefs.FaultRecorder.record({ fault })),
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
