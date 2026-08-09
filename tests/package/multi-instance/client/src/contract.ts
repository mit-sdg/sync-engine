import {
  assemble,
  conceptSet,
  registerConcept,
  type Assembly,
  type RegisteredConcept,
  type RegisteredConceptSet,
} from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { httpPolicy } from "@mit-sdg/sync-engine-http/server";
import { reaction, when } from "@mit-sdg/sync-engine/language";

const entriesSpecification = `# Entries

## Purpose

Create durable entries once per domain operation while keeping names unique.

## Principle

An operation returns its original entry when retried. Another operation cannot
claim an existing name.

## State

\`\`\`state
a set of Entries with
  an entryId String
  an operationId String
  a unique name String
\`\`\`

## Actions

\`\`\`actions
create (operationId: String, name: String) : return (entryId: String, name: String)
  where operationId identifies an entry with name
  then
    return its entryId and name
  where operationId or name belongs to a different entry
  then
    refuse CONFLICT "The operation or name is already committed differently."
  where operationId and name are new
  then
    add an entry for operationId and name
    return its entryId and name
\`\`\`
`;

const effectsSpecification = `# Effects

## Purpose

Observe successful entry actions as an instance-local surrounding effect.

## Principle

Every successful entry action can be observed, including an idempotent retry.

## State

\`\`\`state
a sequence of Observations with
  an operationId String
  an entryId String
\`\`\`

## Actions

\`\`\`actions
record (operationId: String, entryId: String) : return (recorded: Flag)
  then
    append an observation
    return recorded true
\`\`\`
`;

const faultingSpecification = `# Faulting

## Purpose

Exercise an unexpected fault after an earlier domain action commits.

## Principle

A requested fault throws rather than returning a domain refusal.

## State

\`\`\`state
no durable state
\`\`\`

## Actions

\`\`\`actions
crash (operationId: String) : return (reached: Flag)
  then
    fault unexpectedly
\`\`\`
`;

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
  origin: "https://multi-instance.test",
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
