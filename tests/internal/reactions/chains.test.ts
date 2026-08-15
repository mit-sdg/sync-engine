import { describe, expect, test } from "vite-plus/test";
import { Refuse } from "@sync-engine/advanced";
import { vocabulary } from "@sync-engine/advanced";
import { reaction, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { quietReacting } from "../../utils/reacting.ts";
import type { Empty } from "@sync-engine/internal/reactions/types";
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

const refs = vocabulary({
  concepts: {
    Button: ButtonConcept,
    Decision: DecisionConcept,
    Failing: FailingConcept,
    Recorder: RecorderConcept,
  },
}).concepts;

function setup() {
  const reacting = quietReacting();
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
      Route: reaction(({ kind, route }: Vars) =>
        when(refs.Button.clicked({ kind }).responds())
          .then(refs.Decision.decide({ kind }).responds({ route }))
          .then(refs.Recorder.record({ tag: route })),
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
      Try: reaction(({ message }: Vars) =>
        when(refs.Button.clicked({ kind: "go" }).responds())
          .then(refs.Failing.fail({}).refuses({ message }))
          .then(refs.Recorder.record({ tag: message })),
      ),
    });

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["TIMEOUT"]);

    // A refusal nobody asked for does not continue the pinned chain.
    await Failing.fail({});
    expect(Recorder.order).toEqual(["TIMEOUT"]);
  });

  test("an error outcome stops the asking pipeline; recovery is the chain's", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Try: reaction((_: Vars) =>
        when(refs.Button.clicked({ kind: "go" }).responds())
          .then(refs.Recorder.record({ tag: "before" }))
          .then(refs.Failing.fail({}))
          .then(refs.Recorder.record({ tag: "unreachable" })),
      ),
    });

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["before"]);
  });
});
