import type { Collection, Db } from "mongodb";
import { NoCurrentSelection, type SelectionRecord } from "./selecting.shared.ts";

interface CurrentSelection {
  scope: string;
  selection: string;
  item: string;
}
const indexes = new WeakMap<Db, Promise<void>>();
export function ensureSelectingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = Promise.all([
      db.collection<SelectionRecord>("selections").createIndex({ selection: 1 }, { unique: true }),
      db
        .collection<CurrentSelection>("current_selections")
        .createIndex({ scope: 1 }, { unique: true }),
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
    await ensureSelectingIndexes(this.db);
    const selection = this.freshID();
    await this.selections.insertOne({ selection, scope, item });
    await this.current.updateOne({ scope }, { $set: { selection, item } }, { upsert: true });
    return { selection };
  }
  async clear({ scope }: { scope: string }) {
    await ensureSelectingIndexes(this.db);
    const found = await this.current.findOneAndDelete({ scope });
    if (found === null) throw new NoCurrentSelection("This scope has no current selection.");
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
