/* Async concepts — the Mongo shape: every action and query awaits I/O,
 * refusals arrive as rejections. The engine's other suites run entirely on
 * synchronous concepts, so these tests pin down what instrumentation and
 * matching guarantee when a concept implementation is asynchronous. */

import { describe, expect, test } from "vite-plus/test";
import { Refuse } from "@sync-engine/advanced";
import { vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { quietReacting } from "../../utils/reacting.ts";
import type { Frames } from "@sync-engine/internal/reads/frames.ts";

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

/** Balances behind an async implementation with a read, await, and write window. */
class LedgerConcept {
  private balances = new Map<string, number>();

  async open({ account }: { account: string }) {
    await tick();
    if (this.balances.has(account)) throw new Refuse("ACCOUNT_EXISTS");
    this.balances.set(account, 0);
    return { account };
  }

  async deposit({ account, amount }: { account: string; amount: number }) {
    const current = this.balances.get(account);
    if (current === undefined) throw new Refuse("ACCOUNT_NOT_FOUND");
    await tick(10); // the round-trip between the guard's read and the write
    const balance = current + (amount as number);
    this.balances.set(account, balance);
    return { account, balance };
  }

  async _getBalance({ account }: { account: string }): Promise<{ balance: number }[]> {
    await tick();
    const balance = this.balances.get(account);
    return balance === undefined ? [] : [{ balance }];
  }
}

class AuditConcept {
  entries: { account: string; balance: number }[] = [];
  note({ account, balance }: { account: string; balance: number }) {
    this.entries.push({ account, balance });
    return { account, balance };
  }
}

const refs = vocabulary({ concepts: { Ledger: LedgerConcept, Audit: AuditConcept } }).concepts;

function setup() {
  const reacting = quietReacting();
  const { Ledger, Audit } = reacting.instrument({
    Ledger: new LedgerConcept(),
    Audit: new AuditConcept(),
  });
  const AuditDeposits = ({ account, balance }: Vars) =>
    when(refs.Ledger.deposit({}).responds({ account, balance })).then(
      refs.Audit.note({ account, balance }),
    );
  reacting.register({ AuditDeposits });
  return { Ledger, Audit };
}

describe("engine: async concept actions", () => {
  test("an awaited async action records its output before its reaction fires", async () => {
    const { Ledger, Audit } = setup();
    await Ledger.open({ account: "a" });
    const out = await Ledger.deposit({ account: "a", amount: 7 });
    expect(out).toEqual({ account: "a", balance: 7 });
    expect(Audit.entries).toEqual([{ account: "a", balance: 7 }]);
  });

  test("a rejected Refuse records an error outcome and fires no success reaction", async () => {
    const { Ledger, Audit } = setup();
    await Ledger.open({ account: "a" });
    const refused = await Ledger.open({ account: "a" });
    expect(refused).toHaveProperty("error", "ACCOUNT_EXISTS");
    const missing = await Ledger.deposit({ account: "ghost", amount: 1 });
    expect(missing).toHaveProperty("error", "ACCOUNT_NOT_FOUND");
    expect(Audit.entries).toEqual([]);
  });

  test("a query racing an in-flight async mutation does not poison the cache", async () => {
    const { Ledger } = setup();
    await Ledger.open({ account: "a" });
    await Ledger.deposit({ account: "a", amount: 10 });

    const inFlight = Ledger.deposit({ account: "a", amount: 5 });
    // Read while the deposit sits in its round-trip: pre-write state is fine
    // for this read, but it must not be reused after the write is recorded.
    const during = await Ledger._getBalance({ account: "a" });
    expect(during).toEqual([{ balance: 10 }]);
    await inFlight;

    const after = await Ledger._getBalance({ account: "a" });
    expect(after).toEqual([{ balance: 15 }]);
  });

  test("concurrent asks on one concept run on its serial line: no lost update", async () => {
    const { Ledger } = setup();
    await Ledger.open({ account: "a" });
    await Promise.all([
      Ledger.deposit({ account: "a", amount: 10 }),
      Ledger.deposit({ account: "a", amount: 5 }),
    ]);
    const final = await Ledger._getBalance({ account: "a" });
    expect(final).toEqual([{ balance: 15 }]);
  });

  test("action bodies keep invocation order across differing requested-reaction delays", async () => {
    class OrderedConcept {
      order: string[] = [];

      run({ label }: { label: string }) {
        this.order.push(label);
        return { label };
      }
    }
    class DelayConcept {
      wait(_: Record<string, never>) {
        return {};
      }
    }
    const orderedRefs = vocabulary({
      concepts: { Ordered: OrderedConcept, Delay: DelayConcept },
    }).concepts;

    const reacting = quietReacting();
    const raw = new OrderedConcept();
    const { Ordered } = reacting.instrument({
      Ordered: raw,
      Delay: new DelayConcept(),
    });
    reacting.register({
      DelaySlowRequest: () =>
        when(orderedRefs.Ordered.run({ label: "slow" }))
          .where(async (frames: Frames) => {
            await tick(20);
            return frames;
          })
          .then(orderedRefs.Delay.wait({})),
    });

    await Promise.all([Ordered.run({ label: "slow" }), Ordered.run({ label: "fast" })]);

    expect(raw.order).toEqual(["slow", "fast"]);
  });

  test("same-concept requested consequences make progress in body arrival order", async () => {
    class ReentrantConcept {
      order: string[] = [];

      root(_: Record<string, never>) {
        this.order.push("root");
        return {};
      }

      middle(_: Record<string, never>) {
        this.order.push("middle");
        return {};
      }

      leaf(_: Record<string, never>) {
        this.order.push("leaf");
        return {};
      }
    }
    const { Reentrant: ReentrantRef } = vocabulary({
      concepts: { Reentrant: ReentrantConcept },
    }).concepts;

    const reacting = quietReacting();
    const raw = new ReentrantConcept();
    const { Reentrant } = reacting.instrument({ Reentrant: raw });
    reacting.register({
      ContinueRoot: () => when(ReentrantRef.root({})).then(ReentrantRef.middle({})),
      ContinueMiddle: () => when(ReentrantRef.middle({})).then(ReentrantRef.leaf({})),
    });

    await Reentrant.root({});

    expect(raw.order).toEqual(["root", "middle", "leaf"]);
  });
});
