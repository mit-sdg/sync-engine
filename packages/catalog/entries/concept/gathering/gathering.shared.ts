export class GatheringNotFound extends Error {}
export class AlreadyJoined extends Error {}
export class NotJoined extends Error {}

export interface GatheringRecord {
  gathering: string;
  name: string;
  host: string;
}
export interface MembershipRecord {
  membership: string;
  gathering: string;
  member: string;
}
