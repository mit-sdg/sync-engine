import { Pool } from "pg";
import { describe, expect, test } from "vite-plus/test";
import { selectingConformance } from "./selecting.conformance.ts";
import { ensureSelectingSchema, SelectingPostgresConcept } from "./selecting.postgres.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.POSTGRES_URL !== undefined && environment.CATALOG_SKIP_POSTGRES !== "1";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("No deterministic identity remains.");
    return identity;
  };
}

interface IsolatedSchema {
  pool: Pool;
  drop: () => Promise<void>;
}

async function createIsolatedSchema(): Promise<IsolatedSchema> {
  const connectionString = environment.POSTGRES_URL ?? "";
  const name = `catalog_selecting_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`CREATE SCHEMA "${name}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const pool = new Pool({ connectionString, options: `-c search_path=${name}` });
  return {
    pool,
    drop: async () => {
      try {
        await pool.end();
        await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}

describe("Selecting postgres", () => {
  selectingConformance(
    "postgres",
    async (identities) => {
      const { pool, drop } = await createIsolatedSchema();
      return {
        concept: new SelectingPostgresConcept(pool, identityReader(identities)),
        close: drop,
      };
    },
    !enabled,
  );

  test.skipIf(!enabled)("rolls back history when the current projection write faults", async () => {
    const { pool, drop } = await createIsolatedSchema();
    try {
      await ensureSelectingSchema(pool);
      await pool.query(
        `ALTER TABLE current_selections
           ADD CONSTRAINT reject_rolled_back_scope CHECK (scope <> 'rolled-back-scope')`,
      );
      const selecting = new SelectingPostgresConcept(
        pool,
        identityReader(["rolled-back-selection"]),
      );

      await expect(
        selecting.choose({ scope: "rolled-back-scope", item: "Interrupted item" }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await selecting._get({ selection: "rolled-back-selection" })).toEqual([]);
      expect(await selecting._current({ scope: "rolled-back-scope" })).toEqual([]);
      const retained = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM selections WHERE scope = $1",
        ["rolled-back-scope"],
      );
      expect(retained.rows[0]?.count).toBe("0");
    } finally {
      await drop();
    }
  });
});
