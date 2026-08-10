import {
  acceptedEntry,
  actorEntry,
  entryDetails,
  replayed,
  targetEntry,
  trailEntry,
  type ActorEntryRecord,
  type EntryDetailsRecord,
  type EntryRecord,
  type RecordInput,
  type TargetEntryRecord,
  type TrailEntryRecord,
  type TrailExtentRecord,
} from "./auditing.shared.ts";

/** One trail's entries in position order, with its recorded events indexed. */
interface Trail {
  ordered: EntryRecord[];
  byEvent: Map<string, EntryRecord>;
}

export class AuditingMemoryConcept {
  private readonly entries = new Map<string, EntryRecord>();
  private readonly trails = new Map<string, Trail>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  record({ trail, event, actor, action, detail, target, at }: RecordInput) {
    acceptedEntry({ actor, action, detail, target });
    const kept = this.trails.get(trail) ?? { ordered: [], byEvent: new Map<string, EntryRecord>() };
    const recorded = kept.byEvent.get(event);
    if (recorded !== undefined) return replayed(recorded, { actor, action, detail, target });
    const entry = this.freshID();
    const position = (kept.ordered.at(-1)?.position ?? 0) + 1;
    const added: EntryRecord = {
      entry,
      trail,
      position,
      event,
      actor,
      action,
      detail,
      target,
      recordedAt: new Date(at.getTime()),
    };
    kept.ordered.push(added);
    kept.byEvent.set(event, added);
    this.trails.set(trail, kept);
    this.entries.set(entry, added);
    return { entry, position };
  }

  _get({ entry }: { entry: string }): EntryDetailsRecord[] {
    const found = this.entries.get(entry);
    return found === undefined ? [] : [entryDetails(found)];
  }

  _since({ trail, after }: { trail: string; after: number }): TrailEntryRecord[] {
    return this.#trail(trail)
      .filter((record) => record.position > after)
      .map(trailEntry);
  }

  _byActor({ trail, actor }: { trail: string; actor: string }): ActorEntryRecord[] {
    return this.#trail(trail)
      .filter((record) => record.actor === actor)
      .map(actorEntry);
  }

  _forTarget({ trail, target }: { trail: string; target: string }): TargetEntryRecord[] {
    return this.#trail(trail)
      .filter((record) => record.target === target)
      .map(targetEntry);
  }

  _extent({ trail }: { trail: string }): TrailExtentRecord {
    const kept = this.#trail(trail);
    return { entries: kept.length, last: kept.at(-1)?.position ?? 0 };
  }

  #trail(trail: string): readonly EntryRecord[] {
    return this.trails.get(trail)?.ordered ?? [];
  }
}
