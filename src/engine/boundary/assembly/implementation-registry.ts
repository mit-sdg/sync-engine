import { globalRegistry } from "@engine/utils/global-registry";

type FloorHint = string | null;
type HintsByConcept = Map<string, Set<FloorHint>>;
type HintRegistry = WeakMap<object, HintsByConcept>;

const mapHints = globalRegistry<HintRegistry>(
  "@mit-sdg/sync-engine/implementation-map-registry",
  () => new WeakMap(),
  (value): value is HintRegistry => value instanceof WeakMap,
);
const instanceHints = globalRegistry<HintRegistry>(
  "@mit-sdg/sync-engine/implementation-instance-registry",
  () => new WeakMap(),
  (value): value is HintRegistry => value instanceof WeakMap,
);

function remember(
  registry: HintRegistry,
  key: object,
  concept: string,
  floor: FloorHint,
  preferNamed = false,
): void {
  let byConcept = registry.get(key);
  if (byConcept === undefined) {
    byConcept = new Map();
    registry.set(key, byConcept);
  }
  let hints = byConcept.get(concept);
  if (hints === undefined) {
    hints = new Set();
    byConcept.set(concept, hints);
  }
  if (preferNamed && floor !== null) hints.delete(null);
  hints.add(floor);
}

/** Associate a generated implementation map and each value without changing either. */
export function rememberImplementations(
  implementations: Record<string, object>,
  floor?: string,
): void {
  const hint = floor ?? null;
  for (const [concept, instance] of Object.entries(implementations)) {
    remember(mapHints, implementations, concept, hint, true);
    remember(instanceHints, instance, concept, hint);
  }
}

function floorHint(
  registry: HintRegistry,
  key: object,
  concept: string,
): { known: boolean; floor?: string } {
  const hints = registry.get(key)?.get(concept);
  if (hints === undefined) return { known: false };
  if (hints.size !== 1) return { known: true };
  const [hint] = hints;
  return hint === null ? { known: true } : { known: true, floor: hint };
}

/** Recover a floor from the exact map first, then from a safely spread instance. */
export function implementationFloorOf(
  implementations: object,
  concept: string,
  instance: object,
): string | undefined {
  const fromMap = floorHint(mapHints, implementations, concept);
  if (fromMap.known) return fromMap.floor;
  return floorHint(instanceHints, instance, concept).floor;
}
