import type { Collection, Db } from "mongodb";
import {
  AlertCauseConflict,
  AlertNotOpenForRecipient,
  type AlertDetails,
  type AlertRecord,
  type OpenAlertRecord,
} from "./alerting.shared.ts";

function duplicateKeyOn(error: unknown, fields: readonly string[]): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const pattern = (error as { keyPattern?: unknown }).keyPattern;
  if (typeof pattern !== "object" || pattern === null || Array.isArray(pattern)) return false;
  const keys = Object.keys(pattern);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureAlertingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const alerts = db.collection<AlertRecord>("alerts");
    ready = Promise.all([
      alerts.createIndex({ alert: 1 }, { name: "alert_identity", unique: true }),
      alerts.createIndex(
        { recipient: 1, cause: 1 },
        { name: "one_alert_per_recipient_cause", unique: true },
      ),
      alerts.createIndex(
        { recipient: 1, open: 1, raisedAt: 1, alert: 1 },
        { name: "open_alerts_for_recipient" },
      ),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class AlertingMongoConcept {
  private readonly db: Db;
  private readonly alerts: Collection<AlertRecord>;
  private readonly freshID: () => string;

  constructor({ db, freshID = () => crypto.randomUUID() }: { db: Db; freshID?: () => string }) {
    this.db = db;
    this.alerts = db.collection("alerts");
    this.freshID = freshID;
  }

  async raise({
    recipient,
    subject,
    cause,
    at,
  }: {
    recipient: string;
    subject: string;
    cause: string;
    at: Date;
  }) {
    await ensureAlertingIndexes(this.db);
    const alert = this.freshID();
    try {
      await this.alerts.insertOne({
        alert,
        recipient,
        subject,
        cause,
        raisedAt: new Date(at),
        open: true,
      });
      return { alert };
    } catch (error) {
      if (!duplicateKeyOn(error, ["recipient", "cause"])) throw error;
      const existing = await this.alerts.findOne(
        { recipient, cause },
        { readPreference: "primary" },
      );
      if (existing === null) throw error;
      if (existing.subject !== subject)
        throw new AlertCauseConflict(
          "This alert cause is already associated with another subject for the recipient.",
        );
      return { alert: existing.alert };
    }
  }

  async acknowledge({ alert, recipient }: { alert: string; recipient: string }) {
    await ensureAlertingIndexes(this.db);
    const found = await this.alerts.findOneAndUpdate(
      { alert, recipient, open: true },
      { $set: { open: false } },
      { projection: { _id: 0, alert: 1 }, returnDocument: "after" },
    );
    if (found === null)
      throw new AlertNotOpenForRecipient("There is no such open alert for this recipient.");
    return { alert: found.alert };
  }

  async _openFor({ recipient }: { recipient: string }): Promise<OpenAlertRecord[]> {
    const found = await this.alerts
      .find({ recipient, open: true })
      .sort({ raisedAt: 1, alert: 1 })
      .toArray();
    return found.map((record) => ({
      alert: record.alert,
      subject: record.subject,
      cause: record.cause,
      raisedAt: record.raisedAt,
    }));
  }

  async _get({ alert }: { alert: string }): Promise<AlertDetails[]> {
    const found = await this.alerts.findOne({ alert });
    return found === null
      ? []
      : [
          {
            recipient: found.recipient,
            subject: found.subject,
            cause: found.cause,
            raisedAt: found.raisedAt,
            open: found.open,
          },
        ];
  }
}
