# Runtime API

App hosting, lifecycle cleanup, and job-status aggregation for long-running processes.

```ts
import { AppHost, Lifecycle, JobStatusRegistry } from "@mit-sdg/sync-engine/runtime";
```

---

## AppHost\<TApp, TParams\>

Generic multi-tenant app registry with per-tenant lifecycle. Owns the map of running apps, their registration/unregistration, and the disposables each tenant brings.

```ts
const host = new AppHost<MyApp, MyParams>(hooks, sink);
```

### Constructor

```ts
new AppHost(hooks: AppHostHooks<TApp, TParams>, sink?: AppSink<TApp>)
```

`hooks.create(prefix, params)` builds an app instance and its teardown resources for a namespace. The optional `sink` is notified when apps appear/disappear (e.g., an HTTP server that routes by prefix).

### register(prefix, params) → Promise\<HostedApp\>

Idempotent registration. Returns the existing entry if already registered. Notifies the sink on first registration.

```ts
const entry = await host.register("tenant-a", { dbUrl: "..." });
```

### unregister(prefix) → Promise\<void\>

Stops the tenant's resources (reverse order) and notifies the sink. No-op if not registered.

### has(prefix) / get(prefix) / entries() / values()

Snapshot access to registered apps.

### stopAll() → Promise\<void\>

Stops every tenant's resources (for process shutdown). Does not notify the sink.

---

### AppHostHooks\<TApp, TParams\>

```ts
interface AppHostHooks<TApp, TParams> {
  create(prefix: string, params: TParams): CreatedApp<TApp> | Promise<CreatedApp<TApp>>;
}
```

### HostedApp\<TApp\>

```ts
interface HostedApp<TApp> {
  app: TApp;
  type: string;
}
```

### CreatedApp\<TApp\>

```ts
interface CreatedApp<TApp> extends HostedApp<TApp> {
  resources: Stoppable[]; // stopped (reverse order) on unregister
}
```

### AppSink\<TApp\>

```ts
interface AppSink<TApp> {
  registerApp(prefix: string, entry: HostedApp<TApp>): void;
  unregisterApp(prefix: string): void;
}
```

---

## Lifecycle

Uniform teardown registry. Register resources once; shutdown is a single call.

```ts
const lifecycle = new Lifecycle();

lifecycle.add({ stop: () => db.close() });
lifecycle.addTimer(intervalId);
// ...later
await lifecycle.stopAll();
```

### add(stoppable) / addTimer(timer)

Register a `Stoppable` resource or wrap a `setInterval`/`setTimeout` return value.

### stopAll() → Promise\<void\>

Stops every resource in reverse registration order. A failure in one does not prevent the others; the first error (if any) is re-thrown as an `AggregateError`.

### Stoppable

```ts
interface Stoppable {
  stop(): void | Promise<void>;
}
```

---

## JobStatusRegistry

Lazily-read aggregator of background job statuses. Schedulers register themselves; metrics/health modules read the aggregate without forward-referencing every scheduler.

```ts
const registry = new JobStatusRegistry();

// Each scheduler registers once:
const unreg = registry.add({
  getJobStatuses(): JobStatus[] {
    return [
      {
        name: "sync-import",
        lastRun: "2025-01-01T00:00:00Z",
        lastStatus: "success",
        lastError: null,
        lastDurationMs: 120,
      },
    ];
  },
});

// Health endpoint reads all:
registry.all(); // JobStatus[]
```

### add(source) → () => void

Register a `JobStatusSource`. Returns a disposer.

### all() → JobStatus[]

Flattened, current statuses across all registered sources.

### JobStatus

```ts
interface JobStatus {
  name: string;
  lastRun: string | null;
  lastStatus: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
}
```
