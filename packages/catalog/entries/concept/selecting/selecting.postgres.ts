import type { Pool } from "pg";
import {
  NoCurrentSelection,
  NO_CURRENT_SELECTION_MESSAGE,
  type SelectionRecord,
} from "./selecting.shared.ts";

const schemas = new WeakMap<Pool, Promise<void>>();

export function ensureSelectingSchema(pool: Pool): Promise<void> {
  let ready = schemas.get(pool);
  if (ready === undefined) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS selections (
           selection text PRIMARY KEY,
           scope text NOT NULL,
           item text NOT NULL
         );
         CREATE TABLE IF NOT EXISTS current_selections (
           scope text PRIMARY KEY,
           selection text NOT NULL UNIQUE REFERENCES selections (selection),
           item text NOT NULL
         );`,
      )
      .then(() => undefined);
    schemas.set(pool, ready);
  }
  return ready;
}

export class SelectingPostgresConcept {
  constructor(
    private readonly pool: Pool,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {}

  async choose({ scope, item }: { scope: string; item: string }) {
    const selection = this.freshID();
    await ensureSelectingSchema(this.pool);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO selections (selection, scope, item) VALUES ($1, $2, $3)", [
        selection,
        scope,
        item,
      ]);
      await client.query(
        `INSERT INTO current_selections (scope, selection, item) VALUES ($1, $2, $3)
         ON CONFLICT (scope) DO UPDATE SET selection = EXCLUDED.selection, item = EXCLUDED.item`,
        [scope, selection, item],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { selection };
  }

  async clear({ scope }: { scope: string }) {
    await ensureSelectingSchema(this.pool);
    const cleared = await this.pool.query<{ selection: string }>(
      "DELETE FROM current_selections WHERE scope = $1 RETURNING selection",
      [scope],
    );
    const found = cleared.rows[0];
    if (found === undefined) throw new NoCurrentSelection(NO_CURRENT_SELECTION_MESSAGE);
    return { selection: found.selection };
  }

  async _current({ scope }: { scope: string }): Promise<SelectionRecord[]> {
    await ensureSelectingSchema(this.pool);
    const found = await this.pool.query<SelectionRecord>(
      "SELECT selection, scope, item FROM current_selections WHERE scope = $1",
      [scope],
    );
    return found.rows;
  }

  async _get({ selection }: { selection: string }): Promise<SelectionRecord[]> {
    await ensureSelectingSchema(this.pool);
    const found = await this.pool.query<SelectionRecord>(
      "SELECT selection, scope, item FROM selections WHERE selection = $1",
      [selection],
    );
    return found.rows;
  }
}
