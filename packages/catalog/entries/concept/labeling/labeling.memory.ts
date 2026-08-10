import {
  InvalidLabelName,
  LabelAlreadyApplied,
  LabelNameTaken,
  LabelNotApplied,
  LabelNotFound,
  type LabelRecord,
} from "./labeling.shared.ts";

interface ItemLabel {
  label: string;
  name: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareItemLabels(left: ItemLabel, right: ItemLabel): number {
  return compareText(left.name, right.name) || compareText(left.label, right.label);
}

function validName(name: string): boolean {
  return name.trim().length > 0 && name.length <= 64;
}

export class LabelingMemoryConcept {
  private readonly labels = new Map<string, LabelRecord>();
  private readonly namesByScope = new Map<string, Map<string, string>>();
  private readonly itemsByLabel = new Map<string, Set<string>>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  create({ scope, name }: { scope: string; name: string }) {
    if (!validName(name)) throw new InvalidLabelName();
    let names = this.namesByScope.get(scope);
    if (names === undefined) {
      names = new Map();
      this.namesByScope.set(scope, names);
    }
    if (names.has(name)) throw new LabelNameTaken();

    const label = this.freshID();
    this.labels.set(label, { label, scope, name });
    names.set(name, label);
    return { label };
  }

  rename({ label, name }: { label: string; name: string }) {
    const found = this.labels.get(label);
    if (found === undefined) throw new LabelNotFound();
    if (!validName(name)) throw new InvalidLabelName();

    const names = this.namesByScope.get(found.scope);
    if (names === undefined) throw new Error("Label scope index is missing.");
    const other = names.get(name);
    if (other !== undefined && other !== label) throw new LabelNameTaken();

    names.delete(found.name);
    names.set(name, label);
    this.labels.set(label, { ...found, name });
    return { label };
  }

  apply({ label, item }: { label: string; item: string }) {
    if (!this.labels.has(label)) throw new LabelNotFound();
    let items = this.itemsByLabel.get(label);
    if (items === undefined) {
      items = new Set();
      this.itemsByLabel.set(label, items);
    }
    if (items.has(item)) throw new LabelAlreadyApplied();
    items.add(item);
    return { label, item };
  }

  remove({ label, item }: { label: string; item: string }) {
    const items = this.itemsByLabel.get(label);
    if (items === undefined || !items.delete(item)) throw new LabelNotApplied();
    if (items.size === 0) this.itemsByLabel.delete(label);
    return { label, item };
  }

  _get({ label }: { label: string }): Array<Omit<LabelRecord, "label">> {
    const found = this.labels.get(label);
    return found === undefined ? [] : [{ scope: found.scope, name: found.name }];
  }

  _for({ scope, item }: { scope: string; item: string }): ItemLabel[] {
    return [...this.labels.values()]
      .filter(
        ({ label, scope: labelScope }) =>
          labelScope === scope && this.itemsByLabel.get(label)?.has(item) === true,
      )
      .map(({ label, name }) => ({ label, name }))
      .sort(compareItemLabels);
  }

  _items({ label }: { label: string }): Array<{ item: string }> {
    return [...(this.itemsByLabel.get(label) ?? [])].sort(compareText).map((item) => ({ item }));
  }
}
