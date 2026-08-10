export class NoCurrentSelection extends Error {}
export interface SelectionRecord {
  selection: string;
  scope: string;
  item: string;
}
