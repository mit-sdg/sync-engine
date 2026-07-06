/**
 * Readiness probe — a generic MongoDB / index / migration health check.
 *
 * The mechanism (ping mongo, diff indexes against an expected set, fold in
 * migration status, assemble a {@link ReadinessResult}) is app-agnostic. The
 * *catalog* of critical collections and the policy on whether pending
 * migrations block readiness are injected by the caller, keeping this file
 * free of any app-specific config.
 */

import type { ReadinessResult } from "@sync-engine/infra/health-module.ts";
import type { Db } from "mongodb";

export interface CriticalCollection {
  /** Concept namespace, e.g. "registry.Authenticating". */
  namespace: string;
  /** Collection name within the namespace, e.g. "users". */
  collection: string;
  /** Index key names expected to exist on the collection. */
  indexes: string[];
}

export interface MigrationStatus {
  applied: boolean;
  missing: number[];
  error?: string;
}

export interface ReadinessProbeConfig {
  database: Db;
  collections: CriticalCollection[];
  /** Lazily returns the latest migration status (or undefined if unchecked). */
  getMigrationStatus: () => MigrationStatus | undefined;
  /** When true, pending/failed migrations make the probe report not-ready. */
  requireMigrations: boolean;
}

/** Build a readiness check function from probe config. */
export function createReadinessProbe(
  config: ReadinessProbeConfig,
): () => Promise<ReadinessResult> {
  const { database, collections, getMigrationStatus, requireMigrations } =
    config;

  return async () => {
    const details: Record<string, string> = {};
    let mongodbOk = false;
    let indexesOk = true;

    try {
      await database.admin().ping();
      mongodbOk = true;
      details.mongodb = "reachable";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      details.mongodb = `unreachable: ${message}`;
      return {
        ready: false,
        mongodb: false,
        indexes: false,
        details,
        migrations: getMigrationStatus(),
      };
    }

    for (const cc of collections) {
      const collectionName = `${cc.namespace}.${cc.collection}`;
      try {
        const found = await database
          .listCollections({ name: collectionName })
          .toArray();
        if (found.length === 0) {
          details[collectionName] = "not yet created";
          continue;
        }

        const indexDocs = await database.collection(collectionName).indexes();
        const indexKeys = indexDocs.flatMap((idx) =>
          Object.keys(idx.key ?? {}),
        );
        const missing = cc.indexes.filter((i) => !indexKeys.includes(i));

        if (missing.length > 0) {
          indexesOk = false;
          details[collectionName] = `missing indexes: ${missing.join(", ")}`;
        } else {
          details[collectionName] = "ok";
        }
      } catch (err: unknown) {
        indexesOk = false;
        const message = err instanceof Error ? err.message : String(err);
        details[collectionName] = `error: ${message}`;
      }
    }

    const migrations = getMigrationStatus();
    const migrationsOk = migrations?.applied ?? false;
    if (migrations) {
      details.migrations = migrations.applied
        ? "ok"
        : `pending: [${migrations.missing.join(", ")}]`;
      if (migrations.error) {
        details.migrationError = migrations.error;
      }
    }

    const ready =
      mongodbOk && indexesOk && (!requireMigrations || migrationsOk);

    return {
      ready,
      mongodb: mongodbOk,
      indexes: indexesOk,
      details,
      migrations,
    };
  };
}
