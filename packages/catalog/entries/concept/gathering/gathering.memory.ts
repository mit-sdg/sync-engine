import {
  AlreadyJoined,
  ALREADY_JOINED_MESSAGE,
  GatheringNotFound,
  GATHERING_NOT_FOUND_MESSAGE,
  NotJoined,
  NOT_JOINED_MESSAGE,
  type GatheringRecord,
  type StoredGatheringRecord,
  type StoredMembershipRecord,
} from "./gathering.shared.ts";

export class GatheringMemoryConcept {
  private readonly gatherings = new Map<string, StoredGatheringRecord>();
  private readonly memberships = new Map<string, StoredMembershipRecord>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  create({ name, host }: { name: string; host: string }) {
    const gathering = this.freshID();
    const membership = this.freshID();
    this.gatherings.set(gathering, { gathering, name, host, nextMembershipOrder: 1 });
    this.memberships.set(membership, {
      membership,
      gathering,
      member: host,
      joinedOrder: 0,
    });
    return { gathering };
  }

  join({ gathering, member }: { gathering: string; member: string }) {
    const found = this.gatherings.get(gathering);
    if (found === undefined) throw new GatheringNotFound(GATHERING_NOT_FOUND_MESSAGE);
    if (this.#membership(gathering, member) !== undefined)
      throw new AlreadyJoined(ALREADY_JOINED_MESSAGE);
    const membership = this.freshID();
    this.memberships.set(membership, {
      membership,
      gathering,
      member,
      joinedOrder: found.nextMembershipOrder,
    });
    found.nextMembershipOrder++;
    return { membership };
  }

  leave({ gathering, member }: { gathering: string; member: string }) {
    if (!this.gatherings.has(gathering)) throw new GatheringNotFound(GATHERING_NOT_FOUND_MESSAGE);
    const membership = this.#membership(gathering, member);
    if (membership === undefined) throw new NotJoined(NOT_JOINED_MESSAGE);
    this.memberships.delete(membership);
    return { membership };
  }

  _get({ gathering }: { gathering: string }): GatheringRecord[] {
    const found = this.gatherings.get(gathering);
    return found === undefined
      ? []
      : [{ gathering: found.gathering, name: found.name, host: found.host }];
  }

  _members({ gathering }: { gathering: string }): { member: string }[] {
    return [...this.memberships.values()]
      .filter((item) => item.gathering === gathering)
      .sort((left, right) => left.joinedOrder - right.joinedOrder)
      .map(({ member }) => ({ member }));
  }

  _membership({ gathering, member }: { gathering: string; member: string }) {
    return { joined: this.#membership(gathering, member) !== undefined };
  }

  #membership(gathering: string, member: string): string | undefined {
    for (const [id, item] of this.memberships)
      if (item.gathering === gathering && item.member === member) return id;
    return undefined;
  }
}
