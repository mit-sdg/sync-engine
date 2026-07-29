/**
 * Channel triggers: `when` clauses that watch a posture — returned, refused,
 * or faulted — instead of one action's identity. The pattern unifies against
 * a synthesized mapping (concept/action names, the whole input, the
 * posture's payload); `except` skips listed concepts; consumption works
 * exactly as for identity-matched clauses.
 */

import { describe, expect, test } from "vite-plus/test";
import { faulted, Refuse } from "@sync-engine/advanced";
import { earlier, refused, returned, vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { quietReacting } from "../../utils/reacting.ts";
import type { Empty } from "@sync-engine/internal/reactions/types";
import { ButtonConcept, RecorderConcept } from "./mocks.ts";

class MixedConcept {
  succeed({ value }: { value: string }) {
    return { value };
  }
  refuse(_: Empty): Record<string, unknown> {
    throw new Refuse("NOPE", { detail: "declared refusal" });
  }
  crash(_: Empty): Record<string, unknown> {
    throw new Error("boom");
  }
}

const refs = vocabulary({
  concepts: { Button: ButtonConcept, Mixed: MixedConcept, Recorder: RecorderConcept },
}).concepts;

function setup() {
  const reacting = quietReacting();
  const concepts = reacting.instrument({
    Button: new ButtonConcept(),
    Mixed: new MixedConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

describe("channel triggers", () => {
  test("returned() binds concept, action, and the result payload", async () => {
    const { reacting, Mixed, Recorder } = setup();
    reacting.register({
      OnAnySuccess: ({ concept, action }: Vars) =>
        when(returned({ concept, action }, { except: [Recorder] })).then(
          refs.Recorder.record({ tag: action }),
        ),
    });

    await Mixed.succeed({ value: "x" });
    expect(Recorder.order).toEqual(["succeed"]);
  });

  test("refused() sees declared refusals but never faults", async () => {
    const { reacting, Mixed, Recorder } = setup();
    reacting.register({
      OnAnyRefusal: ({ refusal }: Vars) =>
        when(refused({ refusal })).then(refs.Recorder.record({ tag: refusal })),
    });

    await Mixed.refuse({});
    await expect(Mixed.crash({})).rejects.toThrow("boom");
    expect(Recorder.order).toEqual([{ error: "NOPE", detail: "declared refusal" }]);
  });

  test("faulted() sees faults but never declared refusals", async () => {
    const { reacting, Mixed, Recorder } = setup();
    reacting.register({
      OnAnyFault: ({ concept, action }: Vars) =>
        when(faulted({ concept, action })).then(refs.Recorder.record({ tag: action })),
    });

    await Mixed.refuse({});
    await expect(Mixed.crash({})).rejects.toThrow("boom");
    expect(Recorder.order).toEqual(["crash"]);
  });

  test("a literal in the pattern narrows the channel", async () => {
    const { reacting, Button, Mixed, Recorder } = setup();
    reacting.register({
      OnMixedSuccess: ({ result }: Vars) =>
        when(returned({ concept: "Mixed", result }, { except: [Recorder] })).then(
          refs.Recorder.record({ tag: result }),
        ),
    });

    await Button.clicked({ kind: "ignored" });
    await Mixed.succeed({ value: "seen" });
    expect(Recorder.order).toEqual([{ value: "seen" }]);
  });

  test("except skips a concept's occurrences", async () => {
    const { reacting, Button, Mixed, Recorder } = setup();
    reacting.register({
      OnOtherSuccess: ({ action }: Vars) =>
        when(returned({ action }, { except: [Button, Recorder] })).then(
          refs.Recorder.record({ tag: action }),
        ),
    });

    await Button.clicked({ kind: "skipped" });
    await Mixed.succeed({ value: "x" });
    expect(Recorder.order).toEqual(["succeed"]);
  });

  test("a channel clause joins identity clauses within one flow", async () => {
    const { reacting, Button, Mixed, Recorder } = setup();
    reacting.register({
      Pipeline: (_: Vars) =>
        when(refs.Button.clicked({ kind: "go" }).responds()).then(refs.Mixed.refuse({})),
      RefusalInFlow: ({ kind, refusal }: Vars) =>
        when(refused({ refusal }, { except: [Recorder] }))
          .where(earlier(refs.Button.clicked, { kind }))
          .then(refs.Recorder.record({ tag: kind })),
    });

    // A lone refusal outside any clicked flow does not fire the joined reaction.
    await Mixed.refuse({});
    expect(Recorder.order).toEqual([]);

    await Button.clicked({ kind: "go" });
    expect(Recorder.order).toEqual(["go"]);
  });
});
