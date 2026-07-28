/** Normalize authored action references into occurrence patterns. */

import { flow } from "../context.ts";
import type { ActionPattern, InstrumentedAction, Mapping } from "../types.ts";
import { isActionRef } from "./references.ts";

export function actionPattern(
  action: InstrumentedAction,
  input: Mapping,
  output?: Mapping,
): ActionPattern {
  const concept = action.concept;
  if (concept === undefined) {
    if (isActionRef(action)) {
      return { concept: action, action, input, flow, ...(output ? { output } : {}) };
    }
    throw new Error(`Action ${action.name} is not instrumented.`);
  }
  return { concept, action, input, flow, ...(output ? { output } : {}) };
}
