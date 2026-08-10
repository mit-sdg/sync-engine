import {
  ItemAlreadyTrashed,
  ItemNotTrashed,
  ItemPurged,
  type DispositionRecord,
  type DispositionStatus,
} from "./trashing.shared.ts";

interface TrashedItem {
  item: string;
  trashedAt: Date;
}

function compareTrashed(left: TrashedItem, right: TrashedItem): number {
  const byTime = left.trashedAt.getTime() - right.trashedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.item < right.item ? -1 : left.item > right.item ? 1 : 0;
}

export class TrashingMemoryConcept {
  private readonly dispositions = new Map<string, DispositionRecord>();

  trash({ item, at }: { item: string; at: Date }) {
    const found = this.dispositions.get(item);
    if (found?.status === "purged") throw new ItemPurged();
    if (found?.status === "trashed") throw new ItemAlreadyTrashed();
    this.dispositions.set(item, {
      item,
      status: "trashed",
      trashedAt: new Date(at.getTime()),
    });
    return { item };
  }

  restore({ item }: { item: string }) {
    const found = this.dispositions.get(item);
    if (found?.status === "purged") throw new ItemPurged();
    if (found?.status !== "trashed") throw new ItemNotTrashed();
    this.dispositions.set(item, { item, status: "active" });
    return { item };
  }

  purge({ item, at }: { item: string; at: Date }) {
    const found = this.dispositions.get(item);
    if (found?.status === "purged") throw new ItemPurged();
    if (found?.status !== "trashed" || found.trashedAt === undefined) {
      throw new ItemNotTrashed();
    }
    this.dispositions.set(item, {
      item,
      status: "purged",
      trashedAt: new Date(found.trashedAt.getTime()),
      purgedAt: new Date(at.getTime()),
    });
    return { item };
  }

  _state({ item }: { item: string }): { status: DispositionStatus } {
    return { status: this.dispositions.get(item)?.status ?? "active" };
  }

  _trashed(_input: Record<string, never>): TrashedItem[] {
    return [...this.dispositions.values()]
      .flatMap((record) =>
        record.status === "trashed" && record.trashedAt !== undefined
          ? [{ item: record.item, trashedAt: new Date(record.trashedAt.getTime()) }]
          : [],
      )
      .sort(compareTrashed);
  }
}
