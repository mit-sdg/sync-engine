import {
  assemble,
  conceptSet,
  registerConcept,
  type Assembly,
  type RegisteredConcept,
  type RegisteredConceptSet,
} from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";
import { reaction, when } from "@mit-sdg/sync-engine/language";
import effectsSpecification from "../design/concepts/Effects.md" with { type: "text" };
import entriesSpecification from "../design/concepts/Entries.md" with { type: "text" };
import faultingSpecification from "../design/concepts/Faulting.md" with { type: "text" };

export class Conflict extends Error {}

class EntriesContract {
  create({ operationId, name }: { operationId: string; name: string }) {
    return { entryId: `contract-${operationId}`, name };
  }
}

class EffectsContract {
  record(_: { operationId: string; entryId: string }) {
    return { recorded: true };
  }
}

class FaultingContract {
  crash(_: { operationId: string }): { reached: boolean } {
    throw new Error("contract-only fault");
  }
}

const entries: RegisteredConcept<typeof EntriesContract> = registerConcept({
  class: EntriesContract,
  spec: entriesSpecification,
  refusals: { CONFLICT: Conflict },
});
const effects: RegisteredConcept<typeof EffectsContract> = registerConcept({
  class: EffectsContract,
  spec: effectsSpecification,
});
const faulting: RegisteredConcept<typeof FaultingContract> = registerConcept({
  class: FaultingContract,
  spec: faultingSpecification,
});

type MultiInstanceRegistrations = {
  Entries: RegisteredConcept<typeof EntriesContract>;
  Effects: RegisteredConcept<typeof EffectsContract>;
  Faulting: RegisteredConcept<typeof FaultingContract>;
};

export const multiInstanceConcepts: RegisteredConceptSet<MultiInstanceRegistrations> = conceptSet({
  Entries: entries,
  Effects: effects,
  Faulting: faulting,
});
const { concepts } = multiInstanceConcepts;
export const vocabulary: typeof multiInstanceConcepts.vocabulary = multiInstanceConcepts.vocabulary;

const { Effects, Entries, Faulting } = concepts;

const RecordCreation = reaction(({ operationId, entryId }) =>
  when(Entries.create({ operationId }).responds({ entryId })).then(
    Effects.record({ operationId, entryId }),
  ),
);

const CreateEntry = endpoint(
  "/entries/create",
  ({ operationId, name, entryId }) =>
    receive({ operationId, name })
      .then(Entries.create({ operationId, name }).responds({ entryId }))
      .then(respond({ entryId, name })),
  { input: { required: ["operationId", "name"] } },
);

const CreateThenFault = endpoint(
  "/entries/create-then-fault",
  ({ operationId, name, entryId }) =>
    receive({ operationId, name })
      .then(Entries.create({ operationId, name }).responds({ entryId }))
      .then(Faulting.crash({ operationId }).responds())
      .then(respond({ entryId, name })),
  { input: { required: ["operationId", "name"] } },
);

export const composition: Record<string, unknown> = {
  CreateEntry,
  CreateThenFault,
  RecordCreation,
};

export const multiInstanceHttpPolicy = httpPolicy({
  publicOrigin: "https://multi-instance.test",
  basePath: "/api",
  publicErrors: { CONFLICT: "CONFLICT" },
});

export function assembleMultiInstanceContract(): Assembly<{
  Entries: typeof EntriesContract;
  Effects: typeof EffectsContract;
  Faulting: typeof FaultingContract;
}> {
  return assemble({
    vocabulary,
    instances: multiInstanceConcepts.implementations(),
    composition,
  });
}
