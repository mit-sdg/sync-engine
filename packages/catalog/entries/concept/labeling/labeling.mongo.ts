import type { Collection, Db } from "mongodb";
import {
  InvalidLabelName,
  LabelAlreadyApplied,
  LabelNameTaken,
  LabelNotApplied,
  LabelNotFound,
  type LabelApplicationRecord,
  type LabelRecord,
} from "./labeling.shared.ts";

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function validName(name: string): boolean {
  return name.trim().length > 0 && name.length <= 64;
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureLabelingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const labels = db.collection<LabelRecord>("labeling_labels");
    const applications = db.collection<LabelApplicationRecord>("labeling_applications");
    ready = Promise.all([
      labels.createIndex({ label: 1 }, { unique: true }),
      labels.createIndex({ scope: 1, name: 1 }, { unique: true }),
      applications.createIndex({ label: 1, item: 1 }, { unique: true }),
      applications.createIndex({ item: 1, label: 1 }),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class LabelingMongoConcept {
  private readonly labels: Collection<LabelRecord>;
  private readonly applications: Collection<LabelApplicationRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.labels = db.collection("labeling_labels");
    this.applications = db.collection("labeling_applications");
  }

  async create({ scope, name }: { scope: string; name: string }) {
    if (!validName(name)) throw new InvalidLabelName();
    await ensureLabelingIndexes(this.db);
    const label = this.freshID();
    try {
      await this.labels.insertOne({ label, scope, name });
    } catch (error) {
      if (duplicate(error)) throw new LabelNameTaken();
      throw error;
    }
    return { label };
  }

  async rename({ label, name }: { label: string; name: string }) {
    await ensureLabelingIndexes(this.db);
    const found = await this.labels.findOne({ label }, { projection: { _id: 0, scope: 1 } });
    if (found === null) throw new LabelNotFound();
    if (!validName(name)) throw new InvalidLabelName();

    try {
      await this.labels.updateOne({ label }, { $set: { name } });
    } catch (error) {
      if (duplicate(error)) throw new LabelNameTaken();
      throw error;
    }
    return { label };
  }

  async apply({ label, item }: { label: string; item: string }) {
    await ensureLabelingIndexes(this.db);
    if ((await this.labels.countDocuments({ label }, { limit: 1 })) === 0) {
      throw new LabelNotFound();
    }
    try {
      await this.applications.insertOne({ label, item });
    } catch (error) {
      if (duplicate(error)) throw new LabelAlreadyApplied();
      throw error;
    }
    return { label, item };
  }

  async remove({ label, item }: { label: string; item: string }) {
    await ensureLabelingIndexes(this.db);
    const removed = await this.applications.findOneAndDelete({ label, item });
    if (removed === null) throw new LabelNotApplied();
    return { label, item };
  }

  async _get({ label }: { label: string }): Promise<Array<Omit<LabelRecord, "label">>> {
    const found = await this.labels.findOne(
      { label },
      { projection: { _id: 0, scope: 1, name: 1 } },
    );
    return found === null ? [] : [{ scope: found.scope, name: found.name }];
  }

  async _for({ scope, item }: { scope: string; item: string }) {
    const applications = await this.applications
      .find({ item }, { projection: { _id: 0, label: 1 } })
      .toArray();
    if (applications.length === 0) return [];
    return this.labels
      .find(
        { scope, label: { $in: applications.map(({ label }) => label) } },
        { projection: { _id: 0, label: 1, name: 1 } },
      )
      .sort({ name: 1, label: 1 })
      .toArray();
  }

  async _items({ label }: { label: string }): Promise<Array<{ item: string }>> {
    return this.applications
      .find({ label }, { projection: { _id: 0, item: 1 } })
      .sort({ item: 1 })
      .toArray();
  }
}
