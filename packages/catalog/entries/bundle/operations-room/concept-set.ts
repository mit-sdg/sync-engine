import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { catalogComputations, catalogRegistrations } from "@catalog/registrations";

export const operationsRoomConcepts = conceptSet(catalogRegistrations, catalogComputations);
export const { concepts, computations, vocabulary } = operationsRoomConcepts;
