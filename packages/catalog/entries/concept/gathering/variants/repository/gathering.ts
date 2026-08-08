export class GatheringNotFound extends Error {}
export class AlreadyJoined extends Error {}
export class NotJoined extends Error {}

export type Gathering = { gathering: string; name: string; host: string };
export type Membership = { membership: string; gathering: string; member: string };

/** Storage contract required by the repository implementation variant. */
export interface GatheringRepository {
  gathering(id: string): Gathering | undefined;
  saveGathering(gathering: Gathering): void;
  membership(gathering: string, member: string): Membership | undefined;
  memberships(gathering: string): Membership[];
  saveMembership(membership: Membership): void;
  deleteMembership(membership: string): void;
}

/** Create named gatherings while delegating durable state to an application repository. */
export class GatheringConcept {
  constructor(
    private readonly repository: GatheringRepository,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {}

  create({ name, host }: { name: string; host: string }) {
    const gathering = this.freshID();
    this.repository.saveGathering({ gathering, name, host });
    const membership = this.freshID();
    this.repository.saveMembership({ membership, gathering, member: host });
    return { gathering };
  }

  join({ gathering, member }: { gathering: string; member: string }) {
    if (this.repository.gathering(gathering) === undefined) throw new GatheringNotFound();
    if (this.repository.membership(gathering, member) !== undefined) throw new AlreadyJoined();
    const membership = this.freshID();
    this.repository.saveMembership({ membership, gathering, member });
    return { membership };
  }

  leave({ gathering, member }: { gathering: string; member: string }) {
    if (this.repository.gathering(gathering) === undefined) throw new GatheringNotFound();
    const membership = this.repository.membership(gathering, member);
    if (membership === undefined) throw new NotJoined();
    this.repository.deleteMembership(membership.membership);
    return { membership: membership.membership };
  }

  _get({ gathering }: { gathering: string }): Gathering[] {
    const found = this.repository.gathering(gathering);
    return found === undefined ? [] : [found];
  }

  _members({ gathering }: { gathering: string }): { member: string }[] {
    return this.repository.memberships(gathering).map(({ member }) => ({ member }));
  }

  _membership({ gathering, member }: { gathering: string; member: string }): { joined: boolean } {
    return { joined: this.repository.membership(gathering, member) !== undefined };
  }
}
