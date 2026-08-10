import {
  AlertCauseConflict,
  AlertNotOpenForRecipient,
  type AlertDetails,
  type AlertRecord,
  type OpenAlertRecord,
} from "./alerting.shared.ts";

function pairKey(recipient: string, cause: string): string {
  return JSON.stringify([recipient, cause]);
}

function compareAlerts(left: AlertRecord, right: AlertRecord): number {
  const byTime = left.raisedAt.getTime() - right.raisedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.alert < right.alert ? -1 : left.alert > right.alert ? 1 : 0;
}

function openRow(record: AlertRecord): OpenAlertRecord {
  return {
    alert: record.alert,
    subject: record.subject,
    cause: record.cause,
    raisedAt: new Date(record.raisedAt),
  };
}

function details(record: AlertRecord): AlertDetails {
  return {
    recipient: record.recipient,
    subject: record.subject,
    cause: record.cause,
    raisedAt: new Date(record.raisedAt),
    open: record.open,
  };
}

export class AlertingMemoryConcept {
  private readonly alerts = new Map<string, AlertRecord>();
  private readonly alertByRecipientAndCause = new Map<string, string>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  raise({
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
    const key = pairKey(recipient, cause);
    const existingID = this.alertByRecipientAndCause.get(key);
    if (existingID !== undefined) {
      const existing = this.alerts.get(existingID);
      if (existing === undefined) throw new Error("Alerting identity index is inconsistent.");
      if (existing.subject !== subject)
        throw new AlertCauseConflict(
          "This alert cause is already associated with another subject for the recipient.",
        );
      return { alert: existing.alert };
    }

    const alert = this.freshID();
    this.alerts.set(alert, {
      alert,
      recipient,
      subject,
      cause,
      raisedAt: new Date(at),
      open: true,
    });
    this.alertByRecipientAndCause.set(key, alert);
    return { alert };
  }

  acknowledge({ alert, recipient }: { alert: string; recipient: string }) {
    const existing = this.alerts.get(alert);
    if (existing === undefined || !existing.open || existing.recipient !== recipient)
      throw new AlertNotOpenForRecipient("There is no such open alert for this recipient.");
    this.alerts.set(alert, { ...existing, open: false });
    return { alert };
  }

  _openFor({ recipient }: { recipient: string }): OpenAlertRecord[] {
    return [...this.alerts.values()]
      .filter((record) => record.recipient === recipient && record.open)
      .sort(compareAlerts)
      .map(openRow);
  }

  _get({ alert }: { alert: string }): AlertDetails[] {
    const found = this.alerts.get(alert);
    return found === undefined ? [] : [details(found)];
  }
}
