export const INVALID_ENTRY_ACTION_MESSAGE =
  "An entry action must not be blank and must be at most 100 characters.";
export const INVALID_ENTRY_DETAIL_MESSAGE = "An entry detail must be at most 500 characters.";
export const ENTRY_EVENT_CONFLICT_MESSAGE =
  "This event is already recorded in this trail with different facts.";

export const ENTRY_ACTION_LIMIT = 100;
export const ENTRY_DETAIL_LIMIT = 500;
export const POSITION_ATTEMPTS = 32;

export class InvalidEntryAction extends Error {
  constructor() {
    super(INVALID_ENTRY_ACTION_MESSAGE);
  }
}

export class InvalidEntryDetail extends Error {
  constructor() {
    super(INVALID_ENTRY_DETAIL_MESSAGE);
  }
}

export class EntryEventConflict extends Error {
  constructor() {
    super(ENTRY_EVENT_CONFLICT_MESSAGE);
  }
}

export interface EntryFacts {
  actor: string;
  action: string;
  detail: string;
  target: string;
}

export interface RecordInput extends EntryFacts {
  trail: string;
  event: string;
  at: Date;
}

export interface EntryRecord extends EntryFacts {
  entry: string;
  trail: string;
  position: number;
  event: string;
  recordedAt: Date;
}

export type EntryDetailsRecord = Omit<EntryRecord, "entry">;
export type TrailEntryRecord = Omit<EntryRecord, "trail">;
export type ActorEntryRecord = Omit<EntryRecord, "trail" | "actor">;
export type TargetEntryRecord = Omit<EntryRecord, "trail" | "target">;

export interface TrailExtentRecord {
  entries: number;
  last: number;
}

export function acceptedEntry({ action, detail }: EntryFacts): void {
  if (action.trim().length === 0 || action.length > ENTRY_ACTION_LIMIT)
    throw new InvalidEntryAction();
  if (detail.length > ENTRY_DETAIL_LIMIT) throw new InvalidEntryDetail();
}

export function replayed(
  recorded: EntryRecord,
  asked: EntryFacts,
): { entry: string; position: number } {
  if (
    recorded.actor !== asked.actor ||
    recorded.action !== asked.action ||
    recorded.detail !== asked.detail ||
    recorded.target !== asked.target
  )
    throw new EntryEventConflict();
  return { entry: recorded.entry, position: recorded.position };
}

export function entryDetails(record: EntryRecord): EntryDetailsRecord {
  return {
    trail: record.trail,
    position: record.position,
    event: record.event,
    actor: record.actor,
    action: record.action,
    detail: record.detail,
    target: record.target,
    recordedAt: new Date(record.recordedAt.getTime()),
  };
}

export function trailEntry(record: EntryRecord): TrailEntryRecord {
  return {
    entry: record.entry,
    position: record.position,
    event: record.event,
    actor: record.actor,
    action: record.action,
    detail: record.detail,
    target: record.target,
    recordedAt: new Date(record.recordedAt.getTime()),
  };
}

export function actorEntry(record: EntryRecord): ActorEntryRecord {
  return {
    entry: record.entry,
    position: record.position,
    event: record.event,
    action: record.action,
    detail: record.detail,
    target: record.target,
    recordedAt: new Date(record.recordedAt.getTime()),
  };
}

export function targetEntry(record: EntryRecord): TargetEntryRecord {
  return {
    entry: record.entry,
    position: record.position,
    event: record.event,
    actor: record.actor,
    action: record.action,
    detail: record.detail,
    recordedAt: new Date(record.recordedAt.getTime()),
  };
}
