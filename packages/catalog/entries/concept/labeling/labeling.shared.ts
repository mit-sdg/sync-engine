export const INVALID_LABEL_NAME_MESSAGE =
  "A label name must not be blank and must be at most 64 characters.";
export const LABEL_NAME_TAKEN_MESSAGE = "This scope already has a label with that name.";
export const LABEL_NOT_FOUND_MESSAGE = "There is no such label.";
export const LABEL_ALREADY_APPLIED_MESSAGE = "This label is already applied to the item.";
export const LABEL_NOT_APPLIED_MESSAGE = "This label is not applied to the item.";

export class InvalidLabelName extends Error {
  constructor() {
    super(INVALID_LABEL_NAME_MESSAGE);
  }
}

export class LabelNameTaken extends Error {
  constructor() {
    super(LABEL_NAME_TAKEN_MESSAGE);
  }
}

export class LabelNotFound extends Error {
  constructor() {
    super(LABEL_NOT_FOUND_MESSAGE);
  }
}

export class LabelAlreadyApplied extends Error {
  constructor() {
    super(LABEL_ALREADY_APPLIED_MESSAGE);
  }
}

export class LabelNotApplied extends Error {
  constructor() {
    super(LABEL_NOT_APPLIED_MESSAGE);
  }
}

export interface LabelRecord {
  label: string;
  scope: string;
  name: string;
}

export interface LabelApplicationRecord {
  label: string;
  item: string;
}
