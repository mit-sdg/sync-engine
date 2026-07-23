import type { ComputationRef } from "../reads/computations.ts";
import type { InstrumentedAction, InstrumentedQuery, Mapping } from "./types.ts";
import type { ActionPattern, ActionPosture } from "./types.ts";
import { flow } from "./matching.ts";

function diagnosticSite(site: string): string {
  return /^(?:Reaction|View|Former) "/.test(site) ? site : `Reaction "${site}"`;
}

/** Resolves vocabulary names against one assembly's installed referents. */
export class NameResolver {
  constructor(
    private readonly concepts: Map<string, object>,
    private readonly computations: Map<string, ComputationRef>,
  ) {}

  concept(name: string, site: string): object {
    const concept = this.concepts.get(name);
    if (concept === undefined) {
      throw new Error(
        `${diagnosticSite(site)}: no instrumented concept is named "${name}" — instrument it before registering reactions.`,
      );
    }
    return concept;
  }

  action(
    conceptName: string,
    actionName: string,
    input: Mapping,
    output: Mapping | undefined,
    site: string,
    posture?: ActionPosture,
    by?: string,
  ): ActionPattern {
    const concept = this.concept(conceptName, site);
    const action = Reflect.get(concept, actionName) as InstrumentedAction | undefined;
    if (typeof action !== "function" || action.concept === undefined) {
      throw new Error(`${diagnosticSite(site)}: ${conceptName}.${actionName} is not an action.`);
    }
    return {
      concept: action.concept,
      action,
      input,
      ...(output !== undefined ? { output } : {}),
      flow,
      ...(posture !== undefined ? { posture } : {}),
      ...(by !== undefined ? { by } : {}),
    };
  }

  query(conceptName: string, queryName: string, site: string): InstrumentedQuery {
    const query = Reflect.get(this.concept(conceptName, site), queryName) as InstrumentedQuery;
    if (typeof query !== "function" || query.queryName === undefined) {
      throw new Error(`${diagnosticSite(site)}: ${conceptName}.${queryName} is not a query.`);
    }
    return query;
  }

  computation(name: string, site: string, vocabularyOnly = false): ComputationRef {
    const computation = this.computations.get(name);
    if (computation === undefined) {
      throw new Error(`${diagnosticSite(site)}: computation "${name}" is not registered.`);
    }
    if (vocabularyOnly && computation.source !== "vocabulary") {
      throw new Error(`${diagnosticSite(site)}: computation "${name}" is not vocabulary-owned.`);
    }
    return computation;
  }
}
