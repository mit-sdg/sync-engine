export const NO_CURRENT_SELECTION_MESSAGE = "This scope has no current selection.";

export class NoCurrentSelection extends Error {}

export interface SelectionRecord {
  selection: string;
  scope: string;
  item: string;
}
