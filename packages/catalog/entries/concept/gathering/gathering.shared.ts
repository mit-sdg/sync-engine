export const GATHERING_NOT_FOUND_MESSAGE = "There is no such gathering.";
export const ALREADY_JOINED_MESSAGE = "This person already belongs to the gathering.";
export const NOT_JOINED_MESSAGE = "This person does not belong to the gathering.";

export class GatheringNotFound extends Error {}
export class AlreadyJoined extends Error {}
export class NotJoined extends Error {}

export interface GatheringRecord {
  gathering: string;
  name: string;
  host: string;
}

export interface StoredGatheringRecord extends GatheringRecord {
  nextMembershipOrder: number;
}

export interface MembershipRecord {
  membership: string;
  gathering: string;
  member: string;
}

export interface StoredMembershipRecord extends MembershipRecord {
  joinedOrder: number;
}
