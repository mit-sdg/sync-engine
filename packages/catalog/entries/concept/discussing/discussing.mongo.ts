import type { Collection, Db } from "mongodb";
import {
  compareResponses,
  DISCUSSION_ALREADY_OPEN_MESSAGE,
  DISCUSSION_NOT_OPEN_MESSAGE,
  DiscussionAlreadyOpen,
  DiscussionNotOpen,
  INVALID_RESPONSE_TEXT_MESSAGE,
  InvalidResponseText,
  responseTextAccepted,
  type DiscussionRecord,
  type ResponseListRow,
  type ResponseRecord,
} from "./discussing.shared.ts";

interface DiscussionDocument extends DiscussionRecord {
  responseRevision: number;
}

function duplicateSubject(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const pattern =
    "keyPattern" in error ? (error as { keyPattern?: unknown }).keyPattern : undefined;
  if (typeof pattern === "object" && pattern !== null) {
    const keys = Object.keys(pattern);
    return keys.length === 1 && keys[0] === "subject";
  }
  return error instanceof Error && error.message.includes("one_open_discussion_per_subject");
}

const indexes = new WeakMap<Db, Promise<void>>();
export function ensureDiscussingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = Promise.all([
      db.collection<DiscussionDocument>("discussing_discussions").createIndexes([
        { key: { discussion: 1 }, name: "discussion_identity", unique: true },
        {
          key: { subject: 1 },
          name: "one_open_discussion_per_subject",
          unique: true,
          partialFilterExpression: { open: true },
        },
      ]),
      db.collection<ResponseRecord>("discussing_responses").createIndexes([
        { key: { response: 1 }, name: "response_identity", unique: true },
        {
          key: { discussion: 1, addedAt: 1, response: 1 },
          name: "responses_in_contract_order",
        },
      ]),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class DiscussingMongoConcept {
  private readonly discussions: Collection<DiscussionDocument>;
  private readonly responses: Collection<ResponseRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.discussions = db.collection("discussing_discussions");
    this.responses = db.collection("discussing_responses");
  }

  async open({ subject, at }: { subject: string; at: Date }) {
    const openedAt = new Date(at.getTime());
    await ensureDiscussingIndexes(this.db);
    if ((await this.discussions.countDocuments({ subject, open: true }, { limit: 1 })) > 0)
      throw new DiscussionAlreadyOpen(DISCUSSION_ALREADY_OPEN_MESSAGE);
    const discussion = this.freshID();
    try {
      await this.discussions.insertOne({
        discussion,
        subject,
        openedAt,
        open: true,
        responseRevision: 0,
      });
    } catch (error) {
      if (duplicateSubject(error)) throw new DiscussionAlreadyOpen(DISCUSSION_ALREADY_OPEN_MESSAGE);
      throw error;
    }
    return { discussion };
  }

  async respond({
    discussion,
    author,
    text,
    at,
  }: {
    discussion: string;
    author: string;
    text: string;
    at: Date;
  }) {
    if (!responseTextAccepted(text)) throw new InvalidResponseText(INVALID_RESPONSE_TEXT_MESSAGE);
    const addedAt = new Date(at.getTime());
    await ensureDiscussingIndexes(this.db);
    if ((await this.discussions.countDocuments({ discussion, open: true }, { limit: 1 })) === 0)
      throw new DiscussionNotOpen(DISCUSSION_NOT_OPEN_MESSAGE);
    const response = this.freshID();
    const record: ResponseRecord = {
      response,
      discussion,
      author,
      text,
      addedAt,
    };
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          const guarded = await this.discussions.updateOne(
            { discussion, open: true },
            { $inc: { responseRevision: 1 } },
            { session },
          );
          if (guarded.matchedCount === 0) throw new DiscussionNotOpen(DISCUSSION_NOT_OPEN_MESSAGE);
          await this.responses.insertOne(record, { session });
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    return { response };
  }

  async close({ discussion, at }: { discussion: string; at: Date }) {
    const closedAt = new Date(at.getTime());
    await ensureDiscussingIndexes(this.db);
    const closed = await this.discussions.updateOne(
      { discussion, open: true },
      { $set: { open: false, closedAt } },
    );
    if (closed.matchedCount === 0) throw new DiscussionNotOpen(DISCUSSION_NOT_OPEN_MESSAGE);
    return { discussion };
  }

  async _openFor({
    subject,
  }: {
    subject: string;
  }): Promise<{ discussion: string; openedAt: Date }[]> {
    const found = await this.discussions.findOne(
      { subject, open: true },
      { projection: { _id: 0, discussion: 1, openedAt: 1 } },
    );
    return found === null
      ? []
      : [{ discussion: found.discussion, openedAt: new Date(found.openedAt.getTime()) }];
  }

  async _responses({ discussion }: { discussion: string }): Promise<ResponseListRow[]> {
    const found = await this.responses
      .find(
        { discussion },
        { projection: { _id: 0, response: 1, discussion: 1, author: 1, text: 1, addedAt: 1 } },
      )
      .toArray();
    return found.sort(compareResponses).map(({ response, author, text, addedAt }) => ({
      response,
      author,
      text,
      addedAt: new Date(addedAt.getTime()),
    }));
  }

  async _response({ response }: { response: string }): Promise<Omit<ResponseRecord, "response">[]> {
    const found = await this.responses.findOne(
      { response },
      { projection: { _id: 0, discussion: 1, author: 1, text: 1, addedAt: 1 } },
    );
    return found === null
      ? []
      : [
          {
            discussion: found.discussion,
            author: found.author,
            text: found.text,
            addedAt: new Date(found.addedAt.getTime()),
          },
        ];
  }
}
