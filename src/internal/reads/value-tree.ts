/**
 * The one definition of the value tree every pass walks: arrays and plain
 * string-keyed mappings branch; everything else — primitives, symbols,
 * matchers, class instances — is a leaf. Callers see every node first and
 * decide what is theirs; returning {@link DESCEND} hands the node back to
 * the structural walk. That pre-order handshake is what lets one caller
 * treat a fused former as a leaf (replace it whole) while another descends
 * into its slot mapping (collect its variables).
 */

import { isPlainMapping } from "./matchers.ts";
import type { Mapping } from "../reactions/types.ts";

/** Returned by a caller's handler to decline a node and let the walk descend. */
export const DESCEND: unique symbol = Symbol("descend");

/**
 * Depth-first structural map. `mapLeaf` sees every node pre-order; any value
 * other than {@link DESCEND} replaces the node whole. Branches are rebuilt
 * fresh, so the result never aliases the source's containers.
 */
export function mapValueTree(value: unknown, mapLeaf: (node: unknown) => unknown): unknown {
  const mapped = mapLeaf(value);
  if (mapped !== DESCEND) return mapped;
  if (Array.isArray(value)) return value.map((item) => mapValueTree(item, mapLeaf));
  if (isPlainMapping(value)) {
    const out: Mapping = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapValueTree(item, mapLeaf);
    return out;
  }
  return value;
}

/** {@link mapValueTree} with an async handler, awaited in mapping order. */
export async function mapValueTreeAsync(
  value: unknown,
  mapLeaf: (node: unknown) => Promise<unknown> | unknown,
): Promise<unknown> {
  const mapped = await mapLeaf(value);
  if (mapped !== DESCEND) return mapped;
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => mapValueTreeAsync(item, mapLeaf)));
  }
  if (isPlainMapping(value)) {
    const out: Mapping = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = await mapValueTreeAsync(item, mapLeaf);
    }
    return out;
  }
  return value;
}

/**
 * Depth-first read-only visit. `visit` sees every node pre-order; returning
 * `false` skips the node's children.
 */
export function walkValueTree(
  value: unknown,
  visit: (node: unknown) => boolean | undefined | void,
): void {
  if (visit(value) === false) return;
  if (Array.isArray(value)) {
    for (const item of value) walkValueTree(item, visit);
    return;
  }
  if (isPlainMapping(value)) {
    for (const item of Object.values(value)) walkValueTree(item, visit);
  }
}
