/**
 * Action results and declared refusals. Any returned object is a result,
 * including one with an `error` property. An action refuses only by throwing
 * `Refuse`.
 */

import { describe, expect, test } from "vite-plus/test";
import {
  contractOf,
  Logging,
  type OutcomeContracts,
  Refuse,
  Reacting,
} from "@sync-engine/internal/reactions";

class ContractedConcept {
  static readonly outcomes: OutcomeContracts = {
    check: { refusals: ["OUT_OF_RANGE"] },
  };

  check({ value }: { value: number }) {
    if (value < 0) throw new Refuse("OUT_OF_RANGE", { detail: `${value} is negative` });
    if (value > 100) throw new Refuse("TOO_BIG"); // deliberately undeclared
    return { error: "none", value };
  }

  returnErrorField({ value }: { value: number }) {
    return { error: "IN_BODY", value };
  }
}

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const { Contracted } = reacting.instrument({ Contracted: new ContractedConcept() });
  return { reacting, Contracted };
}

describe("declared outcomes", () => {
  test("contractOf finds a declared action and misses the rest", () => {
    const concept = new ContractedConcept();
    expect(contractOf(concept, "check")).toEqual({ refusals: ["OUT_OF_RANGE"] });
    expect(contractOf(concept, "returnErrorField")).toBeUndefined();
    expect(contractOf({}, "anything")).toBeUndefined();
  });

  test("a contracted action's error-keyed return is a result, not a refusal", async () => {
    const { reacting, Contracted } = setup();
    await Contracted.check({ value: 7 });
    const [record] = [...reacting.Action.actions.values()];
    expect(record?.outcome).toEqual({ kind: "result", value: { error: "none", value: 7 } });
  });

  test("a contracted action refuses only via Refuse, checked against its declaration", async () => {
    const { reacting, Contracted } = setup();
    const declared = await Contracted.check({ value: -1 });
    expect(declared).toEqual({ error: "OUT_OF_RANGE", detail: "-1 is negative" });
    // An undeclared code remains a refusal; the check warns rather than vetoing it.
    const undeclared = await Contracted.check({ value: 101 });
    expect(undeclared).toEqual({ error: "TOO_BIG" });
    const outcomes = [...reacting.Action.actions.values()].map((r) => r.outcome?.kind);
    expect(outcomes).toEqual(["error", "error"]);
  });

  test("an action without declared refusals may return an object with an error property", async () => {
    const { reacting, Contracted } = setup();
    // The object is recorded as a result because it was returned rather than thrown.
    await Contracted.returnErrorField({ value: 1 });
    const [record] = [...reacting.Action.actions.values()];
    expect(record?.outcome).toEqual({ kind: "result", value: { error: "IN_BODY", value: 1 } });
  });
});
