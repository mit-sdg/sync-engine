export class NameTaken extends Error {}

export class NamingConcept {
  private readonly names = new Set<string>();

  claim({ name }: { name: string }) {
    if (this.names.has(name)) throw new NameTaken("This name is already claimed.");
    this.names.add(name);
    return { name };
  }
}
