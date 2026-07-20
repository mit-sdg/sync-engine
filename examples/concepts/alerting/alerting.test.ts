import { describe, expect, test } from "vite-plus/test";
import { AlertingConcept } from "./alerting.ts";
import { AlertNotFound } from "./errors.ts";

const ids = (...values: string[]) => {
  const remaining = [...values];
  return () => remaining.shift() ?? "unexpected";
};

describe("Alerting", () => {
  test("its principle: keep each recipient's alerts in order until acknowledged", () => {
    const alerting = new AlertingConcept(ids("first", "second", "other"));
    alerting.raise({ recipient: "Mina", subject: "selection-1" });
    alerting.raise({ recipient: "Mina", subject: "selection-2" });
    alerting.raise({ recipient: "Jo", subject: "selection-3" });

    expect(alerting._openFor({ recipient: "Mina" })).toEqual([
      { alert: "first", recipient: "Mina", subject: "selection-1" },
      { alert: "second", recipient: "Mina", subject: "selection-2" },
    ]);
    expect(alerting.acknowledge({ alert: "first" })).toEqual({ alert: "first" });
    expect(alerting._openFor({ recipient: "Mina" })).toEqual([
      { alert: "second", recipient: "Mina", subject: "selection-2" },
    ]);
    expect(alerting._openFor({ recipient: "Jo" })).toHaveLength(1);
    const repeatedAcknowledgement = () => alerting.acknowledge({ alert: "first" });
    expect(repeatedAcknowledgement).toThrow(AlertNotFound);
    expect(repeatedAcknowledgement).toThrow("There is no such open alert.");
  });
});
