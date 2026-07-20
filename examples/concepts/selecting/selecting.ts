import { NoCurrentSelection } from "./errors.ts";

type Selection = { selection: string; scope: string; item: string };

/** Keep one current item selected within each scope. */
export class SelectingConcept {
  static readonly queries = { _current: "optional", _get: "optional" } as const;
  private readonly selections = new Map<string, Selection>();
  private readonly current = new Map<string, string>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  choose({ scope, item }: { scope: string; item: string }) {
    const selection = this.freshID();
    this.selections.set(selection, { selection, scope, item });
    this.current.set(scope, selection);
    return { selection };
  }

  clear({ scope }: { scope: string }) {
    const selection = this.current.get(scope);
    if (selection === undefined) {
      throw new NoCurrentSelection("This scope has no current selection.");
    }
    this.current.delete(scope);
    return { selection };
  }

  _current({ scope }: { scope: string }): Selection[] {
    const selection = this.current.get(scope);
    const found = selection === undefined ? undefined : this.selections.get(selection);
    return found === undefined ? [] : [found];
  }

  _get({ selection }: { selection: string }): Selection[] {
    const found = this.selections.get(selection);
    return found === undefined ? [] : [found];
  }
}
