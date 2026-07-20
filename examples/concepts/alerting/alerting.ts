import { AlertNotFound } from "./errors.ts";

type Alert = { alert: string; recipient: string; subject: string };

/** Keep open alerts for each recipient until they acknowledge them. */
export class AlertingConcept {
  static readonly queries = { _openFor: "many" } as const;
  private readonly alerts = new Map<string, Alert>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  raise({ recipient, subject }: { recipient: string; subject: string }) {
    const alert = this.freshID();
    this.alerts.set(alert, { alert, recipient, subject });
    return { alert };
  }

  acknowledge({ alert }: { alert: string }) {
    if (!this.alerts.delete(alert)) throw new AlertNotFound("There is no such open alert.");
    return { alert };
  }

  _openFor({ recipient }: { recipient: string }): Alert[] {
    return [...this.alerts.values()].filter((alert) => alert.recipient === recipient);
  }
}
