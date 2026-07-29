import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  assemble,
  conceptFloor,
  MemoryStore,
  type ConceptFloor,
  type OperationalEvent,
} from "@mit-sdg/sync-engine/assembly";
import {
  createGateway,
  createHttpHandler,
  FrameworkErrorCode,
} from "@mit-sdg/sync-engine/boundary";
import {
  Conflict,
  composition,
  createMultiInstanceClient,
  multiInstanceHttpProfile,
  type MultiInstanceWire,
  vocabulary,
} from "@sync-engine-fixture/multi-instance-client";

const WAIT_DEADLINE_MS = 2_000;
const RETENTION_WINDOW = 3;
const CONTEST_ROUNDS = 4;

interface EntryResult {
  entryId: string;
  name: string;
}

interface EntryRow {
  id: number;
  operation_id: string;
  name: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = WAIT_DEADLINE_MS) {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitUntil(test: () => boolean, label: string): Promise<void> {
  const expires = performance.now() + WAIT_DEADLINE_MS;
  while (!test()) {
    if (performance.now() >= expires) throw new Error(`${label} did not become true`);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

class OverlapProbe {
  readonly active = new Set<string>();
  maximum = 0;

  enter(instance: string, operationId: string): string {
    const token = `${instance}:${operationId}`;
    this.active.add(token);
    this.maximum = Math.max(this.maximum, this.active.size);
    return token;
  }

  leave(token: string): void {
    this.active.delete(token);
  }
}

interface ScheduleSlot {
  entered: Deferred;
  released: Deferred;
}

class ControlledScheduler {
  private readonly slots = new Map<string, ScheduleSlot>();
  closeCalls = 0;

  constructor(
    readonly instance: string,
    private readonly probe: OverlapProbe,
  ) {}

  hold(operationId: string): void {
    assert(!this.slots.has(operationId), `duplicate scheduler hold for ${operationId}`);
    this.slots.set(operationId, { entered: deferred(), released: deferred() });
  }

  entered(operationId: string): Promise<void> {
    const slot = this.slots.get(operationId);
    assert(slot, `no scheduler hold for ${operationId}`);
    return slot.entered.promise;
  }

  release(operationId: string): void {
    const slot = this.slots.get(operationId);
    assert(slot, `no scheduler hold for ${operationId}`);
    slot.released.resolve();
  }

  releaseAll(): void {
    for (const slot of this.slots.values()) slot.released.resolve();
  }

  async wait(operationId: string): Promise<void> {
    const slot = this.slots.get(operationId);
    if (slot === undefined) return;
    const token = this.probe.enter(this.instance, operationId);
    slot.entered.resolve();
    try {
      await slot.released.promise;
    } finally {
      this.probe.leave(token);
      this.slots.delete(operationId);
    }
  }

  close(): void {
    this.closeCalls += 1;
    assert.equal(this.closeCalls, 1, `${this.instance} scheduler closed more than once`);
    this.releaseAll();
  }
}

class SqliteEntries {
  constructor(
    private readonly database: DatabaseSync,
    private readonly scheduler: ControlledScheduler,
    readonly instance: string,
  ) {}

  async create({ operationId, name }: { operationId: string; name: string }) {
    await this.scheduler.wait(operationId);
    this.database.exec("BEGIN IMMEDIATE");
    let transactionOpen = true;
    try {
      const existing = this.byOperation(operationId);
      if (existing !== undefined) {
        if (existing.name !== name) throw new Conflict();
        this.database.exec("COMMIT");
        transactionOpen = false;
        return resultOf(existing);
      }

      this.database
        .prepare("INSERT INTO entries (operation_id, name, created_by) VALUES (?, ?, ?)")
        .run(operationId, name, this.instance);
      const inserted = this.byOperation(operationId);
      assert(inserted, "inserted operation was not readable in its transaction");
      this.database.exec("COMMIT");
      transactionOpen = false;
      return resultOf(inserted);
    } catch (error) {
      if (transactionOpen) this.database.exec("ROLLBACK");
      if (error instanceof Conflict) throw error;

      const operation = this.byOperation(operationId);
      if (operation !== undefined && operation.name === name) return resultOf(operation);
      const claimedName = this.one(
        "SELECT id, operation_id, name FROM entries WHERE name = ?",
        name,
      );
      if (operation !== undefined || claimedName !== undefined) throw new Conflict();
      throw error;
    }
  }

  byOperation(operationId: string): EntryRow | undefined {
    return this.one(
      "SELECT id, operation_id, name FROM entries WHERE operation_id = ?",
      operationId,
    );
  }

  count(column: "name" | "operation_id", value: string): number {
    const row = this.database
      .prepare(`SELECT count(*) AS count FROM entries WHERE ${column} = ?`)
      .get(value) as { count: number };
    return row.count;
  }

  total(): number {
    const row = this.database.prepare("SELECT count(*) AS count FROM entries").get() as {
      count: number;
    };
    return row.count;
  }

  private one(sql: string, value: SQLInputValue): EntryRow | undefined {
    return this.database.prepare(sql).get(value) as EntryRow | undefined;
  }
}

class LocalEffects {
  readonly observations: Array<{ operationId: string; entryId: string }> = [];

  constructor(readonly instance: string) {}

  record(input: { operationId: string; entryId: string }) {
    this.observations.push(input);
    return { recorded: true };
  }
}

class LaterFault {
  crash(_: { operationId: string }): { reached: boolean } {
    throw new Error("later fixture fault");
  }
}

function resultOf(row: EntryRow): EntryResult {
  return { entryId: String(row.id), name: row.name };
}

function configureConnection(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 2000");
}

function createSchema(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL
  ) STRICT`);
  database
    .prepare("INSERT INTO entries (operation_id, name, created_by) VALUES (?, ?, ?)")
    .run("restart-seed", "present-before-start", "prior-process");
}

interface Runtime {
  label: string;
  application: ReturnType<typeof assemble>;
  gateway: ReturnType<typeof createGateway<MultiInstanceWire>>;
  handler: ReturnType<typeof createHttpHandler>;
  floor: ConceptFloor<typeof vocabulary>;
  scheduler: ControlledScheduler;
  entries: SqliteEntries;
  effects: LocalEffects;
  applicationStore: MemoryStore;
  applicationEvents: OperationalEvent[];
  gatewayEvents: OperationalEvent[];
  databaseCloseCalls: number;
  floorCloseCalls: number;
}

function createRuntime(
  label: string,
  databasePath: string,
  probe: OverlapProbe,
  initialize: boolean,
): Runtime {
  const database = new DatabaseSync(databasePath);
  configureConnection(database);
  if (initialize) createSchema(database);

  const scheduler = new ControlledScheduler(label, probe);
  const entries = new SqliteEntries(database, scheduler, label);
  const effects = new LocalEffects(label);
  let databaseCloseCalls = 0;
  let floorCloseCalls = 0;
  const floor = conceptFloor(vocabulary, {
    name: `sqlite-${label}`,
    instances: { Entries: entries, Effects: effects, Faulting: new LaterFault() },
    resources: [`sqlite-connection:${label}`, `controlled-scheduler:${label}`],
    async close() {
      floorCloseCalls += 1;
      assert.equal(floorCloseCalls, 1, `${label} concept floor closed more than once`);
      scheduler.close();
      database.close();
      databaseCloseCalls += 1;
    },
  });
  const applicationStore = new MemoryStore({ window: RETENTION_WINDOW });
  const applicationEvents: OperationalEvent[] = [];
  const gatewayEvents: OperationalEvent[] = [];
  const application = assemble({
    vocabulary,
    instances: floor.instances,
    composition,
    logStore: applicationStore,
    observers: [(event) => applicationEvents.push(event)],
  });
  const gateway = createGateway<MultiInstanceWire>({
    application,
    observers: [(event) => gatewayEvents.push(event)],
  });
  const handler = createHttpHandler({
    application,
    gateway,
    profile: multiInstanceHttpProfile,
    correlation: {
      resolve: (request) => request.headers.get("X-Correlation-Id") ?? undefined,
      responseHeader: "X-Correlation-Id",
    },
  });
  const runtime: Runtime = {
    label,
    application,
    gateway,
    handler,
    floor,
    scheduler,
    entries,
    effects,
    applicationStore,
    applicationEvents,
    gatewayEvents,
    get databaseCloseCalls() {
      return databaseCloseCalls;
    },
    get floorCloseCalls() {
      return floorCloseCalls;
    },
  };
  return runtime;
}

function fetchFor(handler: ReturnType<typeof createHttpHandler>): typeof fetch {
  return (input, init) => handler(new Request(input, init));
}

function clientFor(runtime: Runtime, correlationId: string) {
  return createMultiInstanceClient({
    fetch: fetchFor(runtime.handler),
    headers: { "X-Correlation-Id": correlationId },
  });
}

function successful(result: unknown, label: string): EntryResult {
  assert(result !== null && typeof result === "object", `${label} returned a non-object`);
  if ("error" in result) assert.fail(`${label} failed with ${String(result.error)}`);
  assert("entryId" in result && typeof result.entryId === "string");
  assert("name" in result && typeof result.name === "string");
  return result as EntryResult;
}

function rowCount(database: SqliteEntries, column: "name" | "operation_id", value: string): number {
  return database.count(column, value);
}

function totalRows(database: SqliteEntries): number {
  return database.total();
}

function hasCorrelation(store: MemoryStore, correlationId: string): boolean {
  return [...store.actions.values()].some((record) => record.input.correlationId === correlationId);
}

function ids(store: MemoryStore): Set<string> {
  return new Set(store.actions.keys());
}

function assertDisjoint(left: Set<string>, right: Set<string>, label: string): void {
  for (const value of left) assert(!right.has(value), `${label} shared action id ${value}`);
}

function isFrameworkError(
  result: Awaited<ReturnType<Runtime["application"]["invoker"]["invoke"]>>,
  code: string,
): boolean {
  return !result.ok && result.error.kind === "framework" && result.error.code === code;
}

async function runScenario(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sync-engine-multi-instance-"));
  const databasePath = join(directory, "shared.sqlite");
  const probe = new OverlapProbe();
  const runtimes: Runtime[] = [];

  try {
    const first = createRuntime("first", databasePath, probe, true);
    runtimes.push(first);
    const second = createRuntime("second", databasePath, probe, false);
    runtimes.push(second);

    assert.notStrictEqual(first.floor.instances.Entries, second.floor.instances.Entries);
    assert.notStrictEqual(first.scheduler, second.scheduler);
    assert.notStrictEqual(first.applicationStore, second.applicationStore);
    assert.notDeepEqual(first.floor.resources, second.floor.resources);
    assert((await stat(databasePath)).isFile(), "the transactional store is not file-backed");

    assert.equal(totalRows(first.entries), 1, "the restart seed was not durable");
    assert.equal(first.effects.observations.length, 0);
    assert.equal(second.effects.observations.length, 0);
    assert.equal(first.applicationStore.actions.size, 0);
    assert.equal(second.applicationStore.actions.size, 0);

    for (let round = 1; round <= CONTEST_ROUNDS; round += 1) {
      const name = `contested-${round}`;
      const firstOperation = `contest-${round}-first`;
      const secondOperation = `contest-${round}-second`;
      const firstCorrelation = `contest-${round}-first-correlation`;
      const secondCorrelation = `contest-${round}-second-correlation`;
      first.scheduler.hold(firstOperation);
      second.scheduler.hold(secondOperation);

      let firstSettled = false;
      let secondSettled = false;
      const firstCall = clientFor(first, firstCorrelation)
        .entries.create({ operationId: firstOperation, name })
        .then((result) => {
          firstSettled = true;
          return result;
        });
      const secondCall = clientFor(second, secondCorrelation)
        .entries.create({ operationId: secondOperation, name })
        .then((result) => {
          secondSettled = true;
          return result;
        });

      await within(
        Promise.all([
          first.scheduler.entered(firstOperation),
          second.scheduler.entered(secondOperation),
        ]),
        `contest ${round} overlap`,
      );
      assert.equal(probe.active.size, 2);
      assert.equal(firstSettled, false);
      assert.equal(secondSettled, false);

      first.scheduler.release(firstOperation);
      const winner = successful(await within(firstCall, `contest ${round} winner`), "winner");
      second.scheduler.release(secondOperation);
      const loser = await within(secondCall, `contest ${round} loser`);
      assert.deepEqual(loser, { error: "CONFLICT" });
      assert.equal(rowCount(first.entries, "name", name), 1);
      assert.equal(first.entries.byOperation(firstOperation)?.id, Number(winner.entryId));
      assert.equal(second.entries.byOperation(secondOperation), undefined);

      if (round === 1) {
        assert.equal(first.effects.observations.length, 1);
        assert.equal(second.effects.observations.length, 0);
        assert.equal(first.applicationStore.firingsByReaction("RecordCreation").length, 1);
        assert.equal(second.applicationStore.firingsByReaction("RecordCreation").length, 0);
        assert(
          [...second.applicationStore.actions.values()].some(
            (record) =>
              record.concept === second.floor.instances.Entries &&
              record.outcome?.kind === "error" &&
              (record.outcome.error as { error?: unknown }).error === "CONFLICT",
          ),
          "the storage loser was not recorded as the registered CONFLICT refusal",
        );
        assert(hasCorrelation(first.applicationStore, firstCorrelation));
        assert(!hasCorrelation(first.applicationStore, secondCorrelation));
        assert(hasCorrelation(second.applicationStore, secondCorrelation));
        assert(!hasCorrelation(second.applicationStore, firstCorrelation));
        assert(
          first.gatewayEvents.some(
            (event) => "correlationId" in event && event.correlationId === firstCorrelation,
          ),
        );
        assert(
          !first.gatewayEvents.some(
            (event) => "correlationId" in event && event.correlationId === secondCorrelation,
          ),
        );
        assertDisjoint(ids(first.applicationStore), ids(second.applicationStore), "instance logs");
        assert(
          [...first.applicationStore.actions.values()].some(
            (record) => record.concept === first.floor.instances.Entries,
          ),
        );
      }
    }
    assert(probe.maximum >= 2, "independent action bodies never overlapped");

    const firstRetryBefore = first.effects.observations.length;
    const secondRetryBefore = second.effects.observations.length;
    const original = successful(
      await within(
        clientFor(first, "retry-correlation-original").entries.create({
          operationId: "retry-operation",
          name: "retry-stable",
        }),
        "original idempotent operation",
      ),
      "original idempotent operation",
    );
    const retried = successful(
      await within(
        clientFor(second, "retry-correlation-new").entries.create({
          operationId: "retry-operation",
          name: "retry-stable",
        }),
        "retried idempotent operation",
      ),
      "retried idempotent operation",
    );
    assert.deepEqual(retried, original);
    assert.equal(rowCount(first.entries, "operation_id", "retry-operation"), 1);
    assert.equal(first.effects.observations.length, firstRetryBefore + 1);
    assert.equal(second.effects.observations.length, secondRetryBefore + 1);
    assert(
      first.applicationEvents.some(
        (event) =>
          event.type === "invocation-settled" &&
          event.correlationId === "retry-correlation-original",
      ),
    );
    assert(
      second.applicationEvents.some(
        (event) =>
          event.type === "invocation-settled" && event.correlationId === "retry-correlation-new",
      ),
    );

    const sharedCorrelationClient = clientFor(second, "shared-correlation");
    const distinctOne = successful(
      await within(
        sharedCorrelationClient.entries.create({ operationId: "shared-one", name: "shared-one" }),
        "first shared-correlation operation",
      ),
      "first shared-correlation operation",
    );
    const distinctTwo = successful(
      await within(
        sharedCorrelationClient.entries.create({ operationId: "shared-two", name: "shared-two" }),
        "second shared-correlation operation",
      ),
      "second shared-correlation operation",
    );
    assert.notEqual(distinctOne.entryId, distinctTwo.entryId);
    assert.equal(rowCount(first.entries, "operation_id", "shared-one"), 1);
    assert.equal(rowCount(first.entries, "operation_id", "shared-two"), 1);
    assert.equal(
      second.applicationEvents.filter(
        (event) =>
          event.type === "invocation-settled" && event.correlationId === "shared-correlation",
      ).length,
      2,
    );

    const faultResult = await within(
      clientFor(second, "fault-correlation").entries["create-then-fault"]({
        operationId: "committed-before-fault",
        name: "committed-before-fault",
      }),
      "later fault",
    );
    assert.deepEqual(faultResult, { error: "INTERNAL_ERROR" });
    assert.equal(rowCount(first.entries, "operation_id", "committed-before-fault"), 1);
    assert(
      [...second.applicationStore.actions.values()].some(
        (record) =>
          record.concept === second.floor.instances.Faulting && record.fault !== undefined,
      ),
      "the later fault was not retained beside the committed entry action",
    );

    const retainedOperations = Array.from(
      { length: RETENTION_WINDOW + 2 },
      (_, index) => `retention-${index + 1}`,
    );
    for (const operationId of retainedOperations) second.scheduler.hold(operationId);
    const retainedCalls = retainedOperations.map((operationId) =>
      second.application.invoker.invoke(
        "/entries/create",
        { operationId, name: operationId },
        { timeoutMs: 150, correlationId: operationId },
      ),
    );
    await within(second.scheduler.entered(retainedOperations[0] ?? ""), "retention body start");
    await waitUntil(
      () => second.applicationStore.flowIndex.size > RETENTION_WINDOW,
      "active retention overflow",
    );
    assert(second.applicationStore.flowIndex.size > RETENTION_WINDOW);
    const timedRetention = await within(Promise.all(retainedCalls), "retention caller timeouts");
    assert(
      timedRetention.every((result) => isFrameworkError(result, FrameworkErrorCode.TIMED_OUT)),
      "retention callers did not all time out",
    );
    for (const operationId of retainedOperations) second.scheduler.release(operationId);
    await within(second.application.whenIdle(), "retention settlement");
    assert(second.applicationStore.flowIndex.size <= RETENTION_WINDOW);
    for (const operationId of retainedOperations) {
      assert.equal(rowCount(first.entries, "operation_id", operationId), 1);
    }

    const timeoutOperation = "timeout-continues";
    first.scheduler.hold(timeoutOperation);
    const timedOutCall = first.application.invoker.invoke(
      "/entries/create",
      { operationId: timeoutOperation, name: timeoutOperation },
      { timeoutMs: 150, correlationId: "timeout-correlation" },
    );
    await within(first.scheduler.entered(timeoutOperation), "timed action body start");
    assert(
      isFrameworkError(await within(timedOutCall, "caller timeout"), FrameworkErrorCode.TIMED_OUT),
    );

    let drainSettled = false;
    const draining = first.gateway.beginDrain().then(() => {
      drainSettled = true;
    });
    assert(
      isFrameworkError(
        await first.gateway.invoke(
          "/entries/create",
          { operationId: "rejected-gateway-root", name: "rejected-gateway-root" },
          { correlationId: "rejected-gateway-root" },
        ),
        FrameworkErrorCode.UNAVAILABLE,
      ),
    );
    assert(
      isFrameworkError(
        await first.application.invoker.invoke(
          "/entries/create",
          { operationId: "rejected-application-root", name: "rejected-application-root" },
          { correlationId: "rejected-application-root" },
        ),
        FrameworkErrorCode.UNAVAILABLE,
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(drainSettled, false, "drain ignored accepted work after timeout");
    first.scheduler.release(timeoutOperation);
    await within(draining, "actual drain settlement");
    assert.equal(drainSettled, true);
    assert.equal(rowCount(second.entries, "operation_id", timeoutOperation), 1);
  } finally {
    for (const runtime of runtimes) runtime.scheduler.releaseAll();
    for (const runtime of runtimes) {
      await within(runtime.gateway.beginDrain(), `${runtime.label} cleanup drain`).catch(
        () => undefined,
      );
    }
    for (const runtime of runtimes) await runtime.floor.close();
    for (const runtime of runtimes) {
      assert.equal(runtime.floorCloseCalls, 1);
      assert.equal(runtime.scheduler.closeCalls, 1);
      assert.equal(runtime.databaseCloseCalls, 1);
    }
    await rm(directory, { recursive: true, force: true });
  }
}

await within(runScenario(), "complete multi-instance scenario", 20_000);
console.log(`multi-instance packed scenario passed (${CONTEST_ROUNDS} controlled contests)`);
