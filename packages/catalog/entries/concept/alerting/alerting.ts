export class AlertNotFound extends Error {}

type Alert = { alert: string; recipient: string; subject: string };

/** Keep open alerts for each recipient until acknowledgement. */
export class AlertingConcept {
  private readonly alerts = new Map<string, Alert>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  raise({ recipient, subject }: { recipient: string; subject: string }) {
    const alert = this.freshID();
    this.alerts.set(alert, { alert, recipient, subject });
    return { alert };
  }

  acknowledge({ alert }: { alert: string }) {
    if (!this.alerts.delete(alert)) throw new AlertNotFound();
    return { alert };
  }

  _openFor({ recipient }: { recipient: string }): Alert[] {
    return [...this.alerts.values()].filter((alert) => alert.recipient === recipient);
  }
}
