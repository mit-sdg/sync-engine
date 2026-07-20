type Selection = { selection: string; room: string; mitigation: string };

/** Keep one current mitigation for each operations room. */
export class MitigatingConcept {
  static readonly queries = { _current: "optional" } as const;
  private readonly selections = new Map<string, Selection>();
  private readonly current = new Map<string, string>();

  choose({ room, mitigation }: { room: string; mitigation: string }) {
    const selection = crypto.randomUUID();
    this.selections.set(selection, { selection, room, mitigation });
    this.current.set(room, selection);
    return { selection };
  }

  _current({ room }: { room: string }): Selection[] {
    const selection = this.current.get(room);
    const found = selection === undefined ? undefined : this.selections.get(selection);
    return found === undefined ? [] : [found];
  }
}
