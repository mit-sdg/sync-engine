import { describe, expect, test } from "vite-plus/test";
import {
  request,
  Logging,
  reaction,
  Refuse,
  refused,
  Reacting,
  type Empty,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
import { ButtonConcept, RecorderConcept } from "./mocks.ts";

class DecisionConcept {
  decide({ kind }: { kind: string }) {
    return { route: kind === "approve" ? "approved" : "rejected" };
  }
}

class FailingConcept {
  fail(_: Empty): Record<string, never> {
    throw new Refuse("TIMEOUT", { detail: "late" });
  }
}

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    Button: new ButtonConcept(),
    Decision: new DecisionConcept(),
    Failing: new FailingConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

// Conditioning on what an ask produced is a `when` on the ask's outcome,
// pinned to its asker with `{ by }` — one reaction per outcome, conditions
// stated exclusively, no ordering deciding anything.
describe("outcome-conditioned chains", () => {
  test("an output-pattern reaction pinned by provenance fires only for its asker", async () => {
    const { reacting, Button, Decision, Recorder } = setup();
    reacting.register({
      Route: reaction(({ kind }: Vars) =>
        when(Button.clicked, { kind }).then(request(Decision.decide, { kind })),
      ),
      Approved: reaction((_: Vars) =>
        when(Decision.decide, {}, { route: "approved" }, { by: "Route", posture: "returned" }).then(
          request(Recorder.record, { tag: "approved" }),
        ),
      ),
      Declined: reaction((_: Vars) =>
        when(Decision.decide, {}, { route: "rejected" }, { by: "Route" }).then(
          request(Recorder.record, { tag: "rejected" }),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);

    // The same action called by nobody's ask: a pinned chain never continues
    // from a look-alike record.
    await Decision.decide({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);

    await Button.clicked({ kind: "reject" });
    expect(Recorder.order).toEqual(["approved", "rejected"]);
  });

  test("a refusal chains through the refused channel pinned to its asker", async () => {
    const { reacting, Button, Failing, Recorder } = setup();
    reacting.register({
      Try: reaction((_: Vars) =>
        when(Button.clicked, { kind: "go" }).then(request(Failing.fail, {})),
      ),
      Recover: reaction(({ message }: Vars) =>
        when(refused({ action: "fail", message }, { by: "Try" })).then(
          request(Recorder.record, { tag: message }),
        ),
      ),
    });

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["TIMEOUT"]);

    // A refusal nobody asked for does not continue the pinned chain.
    await Failing.fail({});
    expect(Recorder.order).toEqual(["TIMEOUT"]);
  });

  test("an error outcome stops the asking pipeline; recovery is the chain's", async () => {
    const { reacting, Button, Failing, Recorder } = setup();
    reacting.register({
      Try: reaction((_: Vars) =>
        when(Button.clicked, { kind: "go" }).then(
          request(Recorder.record, { tag: "before" }),
          request(Failing.fail, {}),
          request(Recorder.record, { tag: "unreachable" }),
        ),
      ),
    });

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["before"]);
  });
});
