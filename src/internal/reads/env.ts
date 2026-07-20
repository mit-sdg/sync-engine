/**
 * The read environment: how IR-shaped nodes reach live state at evaluation.
 *
 * A registered node carries names — `{ concept, query }`, a computation's
 * vocabulary name, or a view or fragment sentence. The environment resolves
 * those names through the engine registry. Registration validates each name,
 * so evaluation expects every lookup to succeed.
 */

import type { InstrumentedQuery } from "../reactions/types.ts";
import type { ComputationRef } from "./computations.ts";
import type { FormerRef } from "./former-nodes.ts";
import type { QueryRefIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";

export interface ReadEnv {
  /** The instrumented query a `{ concept, query }` reference names. */
  query(ref: QueryRefIR, site: string): InstrumentedQuery;
  /** The installed computation a vocabulary name resolves to. */
  computation(name: string, site: string): ComputationRef;
  /** A registered view, by name. */
  viewByName(name: string, site: string): RelationView;
  /** A registered former, by sentence. */
  formerByName(name: string, site: string): FormerRef;
}
