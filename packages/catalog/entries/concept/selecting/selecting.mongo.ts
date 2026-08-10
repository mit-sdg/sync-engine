import type { Collection, Db, TransactionOptions } from "mongodb";
import {
  NoCurrentSelection,
  NO_CURRENT_SELECTION_MESSAGE,
  type SelectionRecord,
} from "./selecting.shared.ts";

interface CurrentSelection {
  scope: string;
  selection: string;
  item: string;
}

const transactionOptions: TransactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

const indexes = new WeakMap<Db, Promise<void>>();
export function ensureSelectingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = Promise.all([
      db
        .collection<SelectionRecord>("selections")
        .createIndex({ selection: 1 }, { name: "selection_identity", unique: true }),
      db.collection<CurrentSelection>("current_selections").createIndexes([
        { key: { scope: 1 }, name: "one_current_selection_per_scope", unique: true },
        { key: { selection: 1 }, name: "current_selection_identity", unique: true },
      ]),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class SelectingMongoConcept {
  private readonly selections: Collection<SelectionRecord>;
  private readonly current: Collection<CurrentSelection>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.selections = db.collection("selections");
    this.current = db.collection("current_selections");
  }

  async choose({ scope, item }: { scope: string; item: string }) {
    const selection = this.freshID();
    await ensureSelectingIndexes(this.db);
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.selections.insertOne({ selection, scope, item }, { session });
        await this.current.updateOne(
          { scope },
          { $set: { selection, item } },
          { session, upsert: true },
        );
      }, transactionOptions);
    } finally {
      await session.endSession();
    }
    return { selection };
  }

  async clear({ scope }: { scope: string }) {
    await ensureSelectingIndexes(this.db);
    const found = await this.current.findOneAndDelete({ scope });
    if (found === null) throw new NoCurrentSelection(NO_CURRENT_SELECTION_MESSAGE);
    return { selection: found.selection };
  }

  async _current({ scope }: { scope: string }): Promise<SelectionRecord[]> {
    const found = await this.current.findOne({ scope }, { projection: { _id: 0 } });
    return found === null ? [] : [{ selection: found.selection, scope, item: found.item }];
  }

  async _get({ selection }: { selection: string }): Promise<SelectionRecord[]> {
    const found = await this.selections.findOne({ selection }, { projection: { _id: 0 } });
    return found === null ? [] : [found];
  }
}
