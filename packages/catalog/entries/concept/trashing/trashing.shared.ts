export const ITEM_PURGED_MESSAGE = "This item has been permanently purged.";
export const ITEM_ALREADY_TRASHED_MESSAGE = "This item is already trashed.";
export const ITEM_NOT_TRASHED_MESSAGE = "This item is not trashed.";

export class ItemPurged extends Error {
  constructor() {
    super(ITEM_PURGED_MESSAGE);
  }
}

export class ItemAlreadyTrashed extends Error {
  constructor() {
    super(ITEM_ALREADY_TRASHED_MESSAGE);
  }
}

export class ItemNotTrashed extends Error {
  constructor() {
    super(ITEM_NOT_TRASHED_MESSAGE);
  }
}

export type DispositionStatus = "active" | "trashed" | "purged";

export interface DispositionRecord {
  item: string;
  status: DispositionStatus;
  trashedAt?: Date;
  purgedAt?: Date;
}
