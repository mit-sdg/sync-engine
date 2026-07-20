import { Refuse } from "@sync-engine/internal/reactions";
import type { Empty, OutcomeContracts } from "@sync-engine/internal/reactions";

export type Priority = "low" | "normal" | "high";
export type WorkStatus = "open" | "active" | "done";

export interface WorkItem {
  id: string;
  title: string;
  priority: Priority;
  status: WorkStatus;
}

export interface WorkState {
  nextId: number;
  items: WorkItem[];
}

export class WorkConcept {
  static readonly queries = { _get: "optional", _list: "many", _snapshot: "one" } as const;
  static readonly outcomes: OutcomeContracts = {
    add: { refusals: ["EMPTY_TITLE"] },
    activate: { refusals: ["NOT_FOUND", "ALREADY_DONE", "ALREADY_ACTIVE"] },
    complete: { refusals: ["NOT_FOUND", "ALREADY_DONE"] },
  };

  constructor(private readonly state: WorkState) {}

  add({ title, priority }: { title: string; priority: Priority }) {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Refuse("EMPTY_TITLE", { detail: "A title is required" });

    const id = `W${String(this.state.nextId).padStart(3, "0")}`;
    this.state.nextId += 1;
    this.state.items.push({ id, title: cleanTitle, priority, status: "open" });
    return { item: id, title: cleanTitle, priority };
  }

  activate({ id }: { id: string }) {
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item) throw new Refuse("NOT_FOUND", { detail: `No work item named ${id}` });
    if (item.status === "done") {
      throw new Refuse("ALREADY_DONE", { detail: `${id} is already done` });
    }
    if (item.status === "active") {
      throw new Refuse("ALREADY_ACTIVE", { detail: `${id} is already in focus` });
    }

    item.status = "active";
    return { item: id, title: item.title };
  }

  pause({ id }: { id: string }) {
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "active") return { item: id, changed: false };
    item.status = "open";
    return { item: id, title: item.title, changed: true };
  }

  complete({ id }: { id: string }) {
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item) throw new Refuse("NOT_FOUND", { detail: `No work item named ${id}` });
    if (item.status === "done") {
      throw new Refuse("ALREADY_DONE", { detail: `${id} is already done` });
    }

    item.status = "done";
    return { item: id, title: item.title };
  }

  _get({ id }: { id: string }): WorkItem[] {
    const item = this.state.items.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  }

  _list(_: Empty): WorkItem[] {
    return [...this.state.items];
  }

  _snapshot(_: Empty): WorkState[] {
    return [this.state];
  }
}

export interface FocusSession {
  item: string;
  endedBy?: "switched" | "completed";
}

export interface FocusState {
  current: string | null;
  sessions: FocusSession[];
}

export class FocusConcept {
  static readonly queries = { _current: "optional", _snapshot: "one" } as const;
  constructor(private readonly state: FocusState) {}

  begin({ item }: { item: string }) {
    const previous = this.state.current ?? "";
    if (previous) {
      const session = this.state.sessions.findLast((candidate) => !candidate.endedBy);
      if (session) session.endedBy = "switched";
    }
    this.state.current = item;
    this.state.sessions.push({ item });
    return { item, previous };
  }

  finish({ item }: { item: string }) {
    if (this.state.current !== item) return { item, changed: false };
    const session = this.state.sessions.findLast((candidate) => !candidate.endedBy);
    if (session) session.endedBy = "completed";
    this.state.current = null;
    return { item, changed: true };
  }

  _current(_: Empty): { item: string }[] {
    return this.state.current ? [{ item: this.state.current }] : [];
  }

  _snapshot(_: Empty): FocusState[] {
    return [this.state];
  }
}

export type HistoryVerb = "added" | "started" | "paused" | "completed";

export interface HistoryEntry {
  sequence: number;
  verb: HistoryVerb;
  item: string;
  title: string;
}

export interface HistoryState {
  entries: HistoryEntry[];
}

export class HistoryConcept {
  constructor(private readonly state: HistoryState) {}

  record({ verb, item, title }: Omit<HistoryEntry, "sequence">) {
    const entry = { sequence: this.state.entries.length + 1, verb, item, title };
    this.state.entries.push(entry);
    return entry;
  }

  _list(_: Empty): HistoryEntry[] {
    return [...this.state.entries];
  }

  _snapshot(_: Empty): HistoryState[] {
    return [this.state];
  }
}
