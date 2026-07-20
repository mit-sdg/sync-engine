import { lineOf } from "@sync-engine/internal/reads/lines";
/** Standard delivery of concept refusals and runtime faults to boundary requests. */

import { describe, expect, test } from "vite-plus/test";
import {
  actionNameOf,
  request,
  former,
  Logging,
  Refuse,
  Reacting,
  vocabulary,
  where,
  when,
} from "@sync-engine/internal/reactions";
import type { Empty, Vars } from "@sync-engine/internal/reactions";
import {
  assemble,
  endpoint,
  FAULT_REPLY,
  FAULT_REACTION,
  receive,
  refusalFunnel,
  Requesting,
  respond,
} from "@sync-engine/internal/boundary";
import type { InvocationResult } from "@sync-engine/internal/boundary";

const faultSentinels = {
  message: "mongodb://boundary-user:boundary-password@example.test/private",
  detail: "boundary-detail-sentinel",
  code: "boundary-code-sentinel",
  cause: "boundary-cause-sentinel",
};

class SeatingConcept {
  private taken = new Set<string>();

  claim({ seat }: { seat: string }) {
    if (this.taken.has(seat)) {
      throw new Refuse("SEAT_TAKEN", { detail: `Seat ${seat} is already taken` });
    }
    this.taken.add(seat);
    return { seat };
  }

  audit(_: Empty): Record<string, unknown> {
    const error = new Error(faultSentinels.message, {
      cause: new Error(faultSentinels.cause),
    });
    Object.assign(error, { detail: faultSentinels.detail, code: faultSentinels.code });
    throw error;
  }
}

function setup() {
  const words = vocabulary({ concepts: { Seating: SeatingConcept }, computations: {} });
  const { Seating } = words.concepts;

  // The endpoints declare only success responses. Standard boundary reactions
  // deliver concept refusals and runtime faults.
  const composition = {
    Claim: endpoint("/seats/claim", ({ seat }: Vars) =>
      receive({ seat }).then(request(Seating.claim, { seat }), respond({ seat })),
    ),
    DoubleFirst: endpoint("/seats/double", ({ seat }: Vars) =>
      receive({ seat }).then(request(Seating.claim, { seat })),
    ),
    DoubleSecond: endpoint("/seats/double", ({ seat }: Vars) =>
      receive({ seat }).then(request(Seating.claim, { seat })),
    ),
    Audit: endpoint("/seats/audit", () =>
      receive().then(request(Seating.audit, {}), respond({ ok: true })),
    ),
  };
  const app = assemble({ vocabulary: words, composition });
  return { reaction: app.engine, invoker: app.invoker, Seating: app.concepts.Seating };
}

describe("refusalFunnel", () => {
  test("leaves the success path alone", async () => {
    const { invoker } = setup();
    const result = (await invoker.invoke("/seats/claim", {
      seat: "A1",
    } as never)) as InvocationResult<{ seat: string }>;
    expect(result).toEqual({ ok: true, value: { seat: "A1" } });
  });

  test("returns a concept refusal without an explicit endpoint error branch", async () => {
    const { invoker } = setup();
    await invoker.invoke("/seats/claim", { seat: "A1" } as never);

    const result = await invoker.invoke("/seats/claim", { seat: "A1" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("domain");
      if (result.error.kind === "domain") {
        // The caller receives the registered error code. Diagnostic detail
        // remains on the action record.
        expect(result.error.value).toBe("SEAT_TAKEN");
      }
    }
  });

  test("delivers a generic failure when a concept implementation faults", async () => {
    const { reaction, invoker } = setup();
    const result = await invoker.invoke("/seats/audit", {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toEqual(FAULT_REPLY);
    }
    const retained = JSON.stringify([...reaction.Action.actions.values()]);
    const publicResult = JSON.stringify(result);
    for (const sentinel of Object.values(faultSentinels)) {
      expect(retained).not.toContain(sentinel);
      expect(publicResult).not.toContain(sentinel);
    }
  });

  test("the first refusal answers; a second in the same flow cannot", async () => {
    const { reaction, invoker } = setup();
    await invoker.invoke("/seats/claim", { seat: "B1" } as never);

    // Both sibling reactions refuse, but the request boundary accepts one response.
    const result = await invoker.invoke("/seats/double", { seat: "B1" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "domain") {
      expect(result.error.value).toBe("SEAT_TAKEN");
    }

    const refusals = [...reaction.Action.actions.values()].filter(
      (r) => r.outcome?.kind === "error" && actionNameOf(r.action) === "claim",
    );
    expect(refusals.length).toBe(2);
    // Each refusal starts one delivery reaction. The request boundary returns
    // the first response and refuses later responses with NOT_PENDING.
    expect(reaction._getFirings("DeliverRefusalToAsker")).toHaveLength(2);
    const doubleFlow = [...reaction.Action.actions.values()].find(
      (r) => r.input?.path === "/seats/double",
    )?.flow;
    const responds = [...reaction.Action.actions.values()].filter(
      (r) => actionNameOf(r.action) === "respond" && r.flow === doubleFlow,
    );
    expect(responds.filter((r) => r.outcome?.kind === "result")).toHaveLength(1);
    const refusedResponds = responds.filter((r) => r.outcome?.kind === "error");
    expect(refusedResponds.length).toBeGreaterThanOrEqual(1);
    for (const refusedRespond of refusedResponds) {
      expect(
        refusedRespond.outcome?.kind === "error" && refusedRespond.outcome.error,
      ).toMatchObject({ error: "NOT_PENDING" });
    }
  });

  test("the funnel's reactions lower to data", () => {
    const { reaction } = setup();
    const app = reaction.exportReactions();
    const funnelReactions = app.reactions.filter((reaction) => reaction.name.startsWith("Deliver"));
    expect(funnelReactions).toHaveLength(2);
    for (const reaction of funnelReactions) {
      expect(reaction.when).toHaveLength(1);
      expect(reaction.when[0].kind).toBe("channel");
      expect(reaction.where[0]).toMatchObject({
        op: "earlier",
        when: { concept: "RequestBoundary", action: "request" },
      });
    }
    // The exported reaction excludes asks made by the fault-delivery reaction itself.
    const faultReaction = funnelReactions.find((reaction) => reaction.name === FAULT_REACTION);
    expect(faultReaction?.when[0]).toMatchObject({ kind: "channel", exceptBy: [FAULT_REACTION] });
  });
});

// ── Faults while forming response input ───────────────────────────────────

/** Returns two rows despite declaring an at-most-one query. */
class DoubledProfilingConcept {
  static readonly queries = { _ofOwner: "optional" } as const;
  _ofOwner(_: { owner: string }): { profile: string; bio: string }[] {
    return [
      { profile: "p1", bio: "first" },
      { profile: "p2", bio: "second" },
    ];
  }
}

describe("faults while forming response input", () => {
  function faultSetup() {
    const words = vocabulary({
      concepts: { Profiling: { class: DoubledProfilingConcept } },
      computations: {},
    });
    const { Profiling } = words.concepts;

    const card = former("the card of (owner)", ({ owner, profile, bio }) =>
      where(lineOf({ query: Profiling._ofOwner }, { owner }).is({ profile, bio })).form({
        profile,
        bio,
      }),
    );

    const composition = {
      Card: endpoint("/profiles/card", ({ owner }: Vars) =>
        receive({ owner }).then(respond({ card: card(owner) })),
      ),
      card,
    };
    const app = assemble({ vocabulary: words, composition });
    return { reaction: app.engine, invoker: app.invoker };
  }

  test("a former fault while forming respond's argument answers the asker", async () => {
    const { reaction, invoker } = faultSetup();
    const result = await invoker.invoke("/profiles/card", { owner: "priya" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toBe(FAULT_REPLY);
    }

    // The faulted response record retains the former reference that could not
    // be evaluated.
    const records = [...reaction.Action.actions.values()];
    const faultedRespond = records.find(
      (r) => actionNameOf(r.action) === "respond" && r.fault !== undefined,
    );
    expect(faultedRespond).toBeDefined();
    expect(JSON.stringify(faultedRespond?.input)).toContain("the card of (owner)");

    // The standard fault-delivery response is the only successful response.
    const delivered = records.filter(
      (r) => actionNameOf(r.action) === "respond" && r.outcome?.kind === "result",
    );
    expect(delivered).toHaveLength(1);
    expect(reaction._getFirings(FAULT_REACTION)).toHaveLength(1);
  });

  test("the fault reaction skips its own asks — one delivery attempt, no recursion", async () => {
    // This boundary always faults while responding. The delivery reaction skips
    // the response it asked for itself, preventing recursion.
    class FailingBoundary extends Requesting {
      override respond(_: { requestId: string }): { requestId: string } {
        throw new Error("concept unavailable");
      }
    }
    const reaction = new Reacting();
    reaction.logging = Logging.OFF;
    const boundary = new FailingBoundary();
    const instrumented = reaction.instrumentConcept(boundary, "RequestBoundary");
    const { Seating } = reaction.instrument({ Seating: new SeatingConcept() });
    const Audit = ({ requestId }: Vars) =>
      when(instrumented.request, { path: "/seats/audit", requestId }).then(
        request(Seating.audit, {}),
        request(instrumented.respond, { ok: true, requestId }),
      );
    reaction.register({
      Audit,
      ...refusalFunnel(instrumented),
    });

    const reqFn = instrumented.request as unknown as (
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    await reqFn({ path: "/seats/audit", requestId: crypto.randomUUID(), input: {} });

    // The audit fault starts one delivery attempt. The failed response asked
    // by DeliverFaultToAsker does not start another.
    expect(reaction._getFirings(FAULT_REACTION)).toHaveLength(1);
    const faultedResponds = [...reaction.Action.actions.values()].filter(
      (r) => actionNameOf(r.action) === "respond" && r.fault !== undefined,
    );
    expect(faultedResponds).toHaveLength(1);
  });
});
