export class AlreadyScheduled extends Error {}
export class DeadlineInPast extends Error {}
export class NoDeadline extends Error {}

export interface DeadlineRecord {
  subject: string;
  expiresAt: string;
}
