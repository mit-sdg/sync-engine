import { compute, reaction, when } from "@mit-sdg/sync-engine/language";
import { computations, concepts } from "@catalog/concepts";

const { Gathering, Selecting } = concepts;
const { normalizeLabel } = computations;

/** Give a new gathering an initial selection derived from its human name. */
export const GatheringNameBecomesInitialSelection = reaction(({ name, gathering, item }) =>
  when(Gathering.create({ name }).responds({ gathering }))
    .where(compute(normalizeLabel, { label: name }, item))
    .then(Selecting.choose({ scope: gathering, item })),
);
