import {
  NoCurrentSelection,
  NO_CURRENT_SELECTION_MESSAGE,
  type SelectionRecord,
} from "./selecting.shared.ts";

export class SelectingMemoryConcept {
  private readonly selections = new Map<string, SelectionRecord>();
  private readonly current = new Map<string, string>();
  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}
  choose({ scope, item }: { scope: string; item: string }) {
    const selection = this.freshID();
    const superseded = this.current.get(scope);
    if (superseded !== undefined) this.selections.delete(superseded);
    this.selections.set(selection, { selection, scope, item });
    this.current.set(scope, selection);
    return { selection };
  }
  clear({ scope }: { scope: string }) {
    const selection = this.current.get(scope);
    if (selection === undefined) throw new NoCurrentSelection(NO_CURRENT_SELECTION_MESSAGE);
    this.current.delete(scope);
    this.selections.delete(selection);
    return { selection };
  }
  _current({ scope }: { scope: string }): SelectionRecord[] {
    const id = this.current.get(scope);
    const found = id === undefined ? undefined : this.selections.get(id);
    return found === undefined ? [] : [found];
  }
  _get({ selection }: { selection: string }): SelectionRecord[] {
    const found = this.selections.get(selection);
    return found === undefined ? [] : [found];
  }
}
