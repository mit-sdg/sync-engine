export class NoteNotFound extends Error {}

type Note = { note: string; text: string };

/** Keep short notes, each identified on its own. */
export class NotingConcept {
  private readonly notes = new Map<string, Note>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  write({ text }: { text: string }) {
    const note = this.freshID();
    this.notes.set(note, { note, text });
    return { note };
  }

  discard({ note }: { note: string }) {
    if (!this.notes.delete(note)) throw new NoteNotFound();
    return { note };
  }

  _get({ note }: { note: string }): Note[] {
    const found = this.notes.get(note);
    return found === undefined ? [] : [found];
  }
}
