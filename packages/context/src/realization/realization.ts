import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import { bindInterface, type InterfaceDefinition } from "@mit-sdg/sync-engine/boundary";
import {
  compileContext,
  resolveContextAsk,
  type FormedContext,
} from "@mit-sdg/sync-engine-rendering/compiled";
import type { RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

/**
 * The answer to one submitted ask: the action's accepted result, or its
 * refusal. A fault in the invoked action throws instead; the edge records it
 * as call evidence rather than treating it as a refusal.
 */
export type ContextAskAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refusal: { readonly error: string; readonly detail?: string } };

/**
 * One opened deliberative unit. The unit is identified by its root renderer
 * invocation; reformation revises this same holder, and an ask crossing a
 * reformation resolves against the current formation, exactly as a browser
 * ask does against its live page.
 */
export interface ContextUnit {
  readonly holder: string;
  formed(): FormedContext;
  /** Subscribe to revised formations; the returned function unsubscribes. */
  reformed(listener: (formed: FormedContext) => void): () => void;
  submit(askId: string, blanks: Readonly<Record<string, string>>): Promise<ContextAskAnswer>;
  close(): void;
}

export interface ContextRealization {
  readonly interface: string;
  /** Open one deliberative unit from its root renderer invocation. */
  open(invocation: RendererInvocation): Promise<ContextUnit>;
  /** Close every open unit and detach from settled-change observation. */
  close(): void;
}

/**
 * Realize the context-family renderers of one interface for in-process
 * participant edges. The realization maintains each opened unit's formation
 * and admits resolved asks through the ordinary assembled boundary; the
 * connected edge owns whether and when to deliberate.
 */
export function realize(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
}): ContextRealization {
  const selected = bindInterface(options);
  const rendering = compileContext(selected);
  const reader = {
    async read(read: { concept: string; query: string }, input: Record<string, unknown>) {
      const concept = options.system.concepts[read.concept];
      const query = (concept as Record<string, unknown> | undefined)?.[read.query];
      if (typeof query !== "function") {
        throw new TypeError(`Unknown renderer read ${read.concept}.${read.query}.`);
      }
      return await query.call(concept, input);
    },
  };

  interface HeldUnit {
    readonly invocation: RendererInvocation;
    formed: FormedContext;
    refreshing: boolean;
    requestedSequence: number;
    processedSequence: number;
    readonly listeners: Set<(formed: FormedContext) => void>;
  }
  const holders = new Set<HeldUnit>();

  const unobserve = options.system.observeSettledChanges((change) => {
    for (const held of holders) {
      const affected = held.formed.reads.some(({ concept }) => change.concepts.includes(concept));
      // A formation can discover a nested read the previous value did not
      // contain; conservatively revisit a holder whose dependency boundary is
      // moving.
      if (!affected && !held.refreshing) continue;
      held.requestedSequence = change.sequence;
      if (held.refreshing) continue;
      held.refreshing = true;
      void (async () => {
        try {
          while (held.processedSequence < held.requestedSequence) {
            const sequence = held.requestedSequence;
            const previous = held.formed;
            const formed = await rendering.form(held.invocation, reader);
            held.formed = formed;
            if (formed.revision !== previous.revision) {
              for (const listener of held.listeners) {
                try {
                  listener(formed);
                } catch {
                  // A throwing listener cannot disrupt other listeners.
                }
              }
            }
            held.processedSequence = sequence;
          }
        } finally {
          held.refreshing = false;
        }
      })().catch(() => undefined);
    }
  });

  const submit = async (
    held: HeldUnit,
    askId: string,
    blanks: Readonly<Record<string, string>>,
  ): Promise<ContextAskAnswer> => {
    let resolved: ReturnType<typeof resolveContextAsk>;
    try {
      resolved = resolveContextAsk(held.formed, askId, blanks);
    } catch (error) {
      return {
        ok: false,
        refusal: { error: "INVALID_ASK", detail: error instanceof Error ? error.message : "" },
      };
    }
    const concept = options.system.concepts[resolved.ask.concept];
    const action = (concept as Record<string, unknown> | undefined)?.[resolved.ask.action];
    if (typeof action !== "function") {
      return { ok: false, refusal: { error: "UNKNOWN_ACTION" } };
    }
    const result = await (action as (input: unknown) => Promise<unknown>).call(
      concept,
      resolved.input,
    );
    if (
      typeof result === "object" &&
      result !== null &&
      typeof (result as { error?: unknown }).error === "string"
    ) {
      return { ok: false, refusal: result as { error: string; detail?: string } };
    }
    return { ok: true, value: result };
  };

  let closed = false;
  return Object.freeze({
    interface: selected.identity,
    async open(invocation: RendererInvocation): Promise<ContextUnit> {
      if (closed) throw new TypeError("Context.realize: this realization is closed.");
      const formed = await rendering.form(invocation, reader);
      const held: HeldUnit = {
        invocation,
        formed,
        refreshing: false,
        requestedSequence: 0,
        processedSequence: 0,
        listeners: new Set(),
      };
      holders.add(held);
      return Object.freeze({
        holder: formed.holder,
        formed: () => held.formed,
        reformed(listener: (formed: FormedContext) => void) {
          held.listeners.add(listener);
          return () => held.listeners.delete(listener);
        },
        submit: (askId: string, blanks: Readonly<Record<string, string>>) =>
          submit(held, askId, blanks),
        close() {
          held.listeners.clear();
          holders.delete(held);
        },
      });
    },
    close() {
      closed = true;
      for (const held of holders) held.listeners.clear();
      holders.clear();
      unobserve();
    },
  });
}
