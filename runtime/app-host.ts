/**
 * AppHost — a generic multi-tenant app registry with per-tenant lifecycle.
 *
 * Owns the namespaced map of running apps, their registration/unregistration,
 * and the disposables (schedulers, observers, …) each tenant brings. All
 * domain specifics — how an app is built, what to seed, how to resolve a
 * prefix to a tenant — are injected via {@link AppHostHooks}, so this file has
 * zero app-alias imports.
 *
 * A {@link AppSink} (typically the HTTP server) is notified when apps appear
 * and disappear, replacing post-construction `setServer` back-wiring: the host
 * is given its sink at construction and the composition root wires the sink's
 * lazy resolver back to the host.
 */

import type { Stoppable } from "@sync-engine/runtime/lifecycle.ts";

export interface HostedApp<TApp> {
  app: TApp;
  type: string;
}

/** What {@link AppHostHooks.create} produces for a tenant. */
export interface CreatedApp<TApp> extends HostedApp<TApp> {
  /** Per-tenant resources stopped (reverse order) when the app unregisters. */
  resources: Stoppable[];
}

export interface AppHostHooks<TApp, TParams> {
  /** Build the app instance and its teardownable resources for a namespace. */
  create(prefix: string, params: TParams): CreatedApp<TApp> | Promise<CreatedApp<TApp>>;
}

/** Downstream consumer notified as apps register / unregister (e.g. server). */
export interface AppSink<TApp> {
  registerApp(prefix: string, entry: HostedApp<TApp>): void;
  unregisterApp(prefix: string): void;
}

export class AppHost<TApp, TParams> {
  private readonly apps = new Map<string, HostedApp<TApp>>();
  private readonly resources = new Map<string, Stoppable[]>();
  private readonly pendingRegistrations = new Map<string, Promise<HostedApp<TApp>>>();

  constructor(
    private readonly hooks: AppHostHooks<TApp, TParams>,
    private readonly sink?: AppSink<TApp>,
  ) {}

  has(prefix: string): boolean {
    return this.apps.has(prefix);
  }

  get(prefix: string): HostedApp<TApp> | undefined {
    return this.apps.get(prefix);
  }

  /** A snapshot of the current apps keyed by prefix. */
  entries(): Record<string, HostedApp<TApp>> {
    return Object.fromEntries(this.apps);
  }

  /** The running app instances, for iteration. */
  values(): HostedApp<TApp>[] {
    return [...this.apps.values()];
  }

  /**
   * Register a tenant app. Idempotent — returns the existing entry if the
   * prefix is already registered. Notifies the sink on first registration.
   */
  async register(prefix: string, params: TParams): Promise<HostedApp<TApp>> {
    const existing = this.apps.get(prefix);
    if (existing) return existing;

    const inFlight = this.pendingRegistrations.get(prefix);
    if (inFlight !== undefined) return inFlight;

    const promise = (async () => {
      try {
        const { app, type, resources } = await this.hooks.create(prefix, params);
        const recheck = this.apps.get(prefix);
        if (recheck) return recheck;
        const entry: HostedApp<TApp> = { app, type };
        this.apps.set(prefix, entry);
        this.resources.set(prefix, resources);
        this.sink?.registerApp(prefix, entry);
        return entry;
      } finally {
        this.pendingRegistrations.delete(prefix);
      }
    })();

    this.pendingRegistrations.set(prefix, promise);
    return promise;
  }

  /**
   * Unregister a tenant app: stop its resources (reverse order), drop it from
   * the map, and notify the sink. No-op if the prefix is not registered.
   */
  async unregister(prefix: string): Promise<void> {
    if (!this.apps.has(prefix)) return;

    const resources = this.resources.get(prefix) ?? [];
    const ordered = [...resources].reverse();
    const results = await Promise.allSettled(
      ordered.map((r) => Promise.resolve().then(() => r.stop())),
    );
    this.resources.delete(prefix);
    this.apps.delete(prefix);
    this.sink?.unregisterApp(prefix);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        `unregister("${prefix}"): some resources failed to stop`,
      );
    }
  }

  /**
   * Stop every tenant's resources (for process shutdown). Does not notify the
   * sink or mutate the map — the process is exiting.
   */
  async stopAll(): Promise<void> {
    const allResources: Stoppable[] = [];
    for (const resources of this.resources.values()) {
      for (const resource of [...resources].reverse()) {
        allResources.push(resource);
      }
    }
    const results = await Promise.allSettled(
      allResources.map((r) => Promise.resolve().then(() => r.stop())),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        "stopAll: some resources failed to stop",
      );
    }
  }
}
