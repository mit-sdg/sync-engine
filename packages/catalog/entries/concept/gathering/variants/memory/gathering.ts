export class GatheringNotFound extends Error {}
export class AlreadyJoined extends Error {}
export class NotJoined extends Error {}

type Gathering = { gathering: string; name: string; host: string };
type Membership = { membership: string; gathering: string; member: string };

/** Create named gatherings and maintain their membership. */
export class GatheringConcept {
  private readonly gatherings = new Map<string, Gathering>();
  private readonly memberships = new Map<string, Membership>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  create({ name, host }: { name: string; host: string }) {
    const gathering = this.freshID();
    this.gatherings.set(gathering, { gathering, name, host });
    const membership = this.freshID();
    this.memberships.set(membership, { membership, gathering, member: host });
    return { gathering };
  }

  join({ gathering, member }: { gathering: string; member: string }) {
    if (!this.gatherings.has(gathering)) throw new GatheringNotFound();
    if (this.#membership(gathering, member) !== undefined) throw new AlreadyJoined();
    const membership = this.freshID();
    this.memberships.set(membership, { membership, gathering, member });
    return { membership };
  }

  leave({ gathering, member }: { gathering: string; member: string }) {
    if (!this.gatherings.has(gathering)) throw new GatheringNotFound();
    const membership = this.#membership(gathering, member);
    if (membership === undefined) throw new NotJoined();
    this.memberships.delete(membership);
    return { membership };
  }

  _get({ gathering }: { gathering: string }): Gathering[] {
    const found = this.gatherings.get(gathering);
    return found === undefined ? [] : [found];
  }

  _members({ gathering }: { gathering: string }): { member: string }[] {
    return [...this.memberships.values()]
      .filter((entry) => entry.gathering === gathering)
      .map(({ member }) => ({ member }));
  }

  _membership({ gathering, member }: { gathering: string; member: string }): { joined: boolean } {
    return { joined: this.#membership(gathering, member) !== undefined };
  }

  #membership(gathering: string, member: string): string | undefined {
    for (const [membership, entry] of this.memberships) {
      if (entry.gathering === gathering && entry.member === member) return membership;
    }
    return undefined;
  }
}
