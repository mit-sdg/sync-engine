/**
 * **Channel triggers** — `when` clauses that watch a *posture*, not a
 * particular action.
 *
 * Action records may be **returned**, **refused**, or **faulted**. A channel
 * trigger matches any action in one posture, which lets framework reactions
 * handle refusals and faults without one reaction per endpoint.
 *
 * The pattern is unified against a synthesized mapping:
 *
 *  - `concept` — the concept's name (e.g. `"Profiling"`);
 *  - `action`  — the action's name (e.g. `"deactivate"`);
 *  - `input`   — the occurrence's whole input mapping;
 *  - the posture's payload: `result` (returned), `refusal` (refused), or
 *    `fault` (faulted) — the whole mapping, bindable in one variable;
 *  - `message` (refused only) — the refusal code, available without binding
 *    the complete refusal mapping.
 *
 * As everywhere, a bare variable binds, a literal tests, and unlisted keys
 * cost nothing. `except` lists concepts whose occurrences the channel skips.
 */

import type { ChannelPattern, ChannelPosture, Mapping } from "./types.ts";

const ChannelBrand: unique symbol = Symbol("ChannelBrand");

export interface ChannelOptions {
  /** Concepts (instances, instrumented proxies, or instrumented actions) to skip. */
  except?: readonly object[];
  /** Reaction names whose own asks the channel skips — the provenance loop-guard. */
  exceptBy?: readonly string[];
  /** Match only occurrences asked for by this reaction — the affirmative provenance pin. */
  by?: string;
}

function channel(
  posture: ChannelPosture,
  pattern: Mapping,
  options: ChannelOptions,
): ChannelPattern {
  const clause: ChannelPattern = {
    channel: posture,
    pattern,
    except: options.except ?? [],
    ...(options.exceptBy !== undefined ? { exceptBy: options.exceptBy } : {}),
    ...(options.by !== undefined ? { by: options.by } : {}),
  };
  Object.defineProperty(clause, ChannelBrand, { value: true, enumerable: false });
  return clause;
}

/** Matches any action's success. Payload key: `result`. */
export function returned(pattern: Mapping = {}, options: ChannelOptions = {}): ChannelPattern {
  return channel("returned", pattern, options);
}

/** Matches any action's declared refusal (never a fault). Payload key: `refusal`. */
export function refused(pattern: Mapping = {}, options: ChannelOptions = {}): ChannelPattern {
  return channel("refused", pattern, options);
}

/** Matches a runtime fault from a thrown non-`Refuse`. Payload key: `fault`. */
export function faulted(pattern: Mapping = {}, options: ChannelOptions = {}): ChannelPattern {
  return channel("faulted", pattern, options);
}

/** Whether a value is a channel clause built by this module. */
export function isChannelPattern(value: unknown): value is ChannelPattern {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[ChannelBrand] === true
  );
}
