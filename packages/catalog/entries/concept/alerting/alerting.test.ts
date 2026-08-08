import { AlertingConcept, AlertNotFound } from "./alerting.ts";

const values = ["failed", "delayed", "other"];
const alerting = new AlertingConcept(() => values.shift() ?? "unexpected");
alerting.raise({ recipient: "Mina", subject: "failed-checkout" });
alerting.raise({ recipient: "Mina", subject: "delayed-deployment" });
alerting.raise({ recipient: "Jo", subject: "other" });
if (alerting._openFor({ recipient: "Mina" }).map(({ alert }) => alert).join(",") !== "failed,delayed") {
  throw new Error("Recipient alerts were not retained in order.");
}
alerting.acknowledge({ alert: "failed" });
try {
  alerting.acknowledge({ alert: "failed" });
  throw new Error("An alert was acknowledged twice.");
} catch (error) {
  if (!(error instanceof AlertNotFound)) throw error;
}
console.log("Alerting principle holds");
