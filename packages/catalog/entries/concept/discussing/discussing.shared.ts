export class DiscussionAlreadyOpen extends Error {}
export class InvalidResponseText extends Error {}
export class DiscussionNotOpen extends Error {}

export const DISCUSSION_ALREADY_OPEN_MESSAGE = "This subject already has an open discussion.";
export const INVALID_RESPONSE_TEXT_MESSAGE =
  "A response must not be blank and must be at most 2000 characters.";
export const DISCUSSION_NOT_OPEN_MESSAGE = "This discussion is not open.";

export interface DiscussionRecord {
  discussion: string;
  subject: string;
  openedAt: Date;
  open: boolean;
  closedAt?: Date;
}

export interface ResponseRecord {
  response: string;
  discussion: string;
  author: string;
  text: string;
  addedAt: Date;
}

export type ResponseListRow = Omit<ResponseRecord, "discussion">;

export function responseTextAccepted(text: string): boolean {
  return text.trim().length > 0 && text.length <= 2000;
}

export function compareResponses(left: ResponseRecord, right: ResponseRecord): number {
  const byTime = left.addedAt.getTime() - right.addedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.response < right.response ? -1 : left.response > right.response ? 1 : 0;
}
