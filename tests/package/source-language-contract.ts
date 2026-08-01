import {
  each,
  form,
  former,
  reaction,
  returned,
  view,
  vocabulary,
  when,
  where,
  whether,
} from "@sync-engine/language";
import type { Former, RelationView } from "@sync-engine/language";

class OneAnswer {
  start(_: Record<string, never>) {
    return {};
  }

  record({ value }: { value: number }) {
    return { value };
  }

  acceptCard({ card }: { card: { value: number } }) {
    return card;
  }

  acceptLookup({ card }: { card: { key: string; value: string } }) {
    return card;
  }

  acceptMaybeLookup({ card }: { card: { key: string; value: string | null } }) {
    return card;
  }

  choose({ kind }: { kind: "number" | "text" }): { number: number } | { text: string } {
    return kind === "number" ? { number: 1 } : { text: "one" };
  }

  _answer(_: Record<string, never>): { value: number } {
    return { value: 1 };
  }
}

class ManyAnswers {
  async _answers(_: Record<string, never>): Promise<{ value: number }[]> {
    return [{ value: 1 }];
  }
}

interface LookupInput {
  key: string;
}

interface LookupRow {
  value: string;
}

class QueriedConcept {
  _answer({ key }: LookupInput): LookupRow[] {
    return key === "present" ? [{ value: key }] : [];
  }

  _nested(_: { filter: { key: string; limit: number } }): LookupRow[] {
    return [];
  }

  _items(_: { items: { id: string }[] }): LookupRow[] {
    return [];
  }

  _choice(_: {
    choice: { kind: "text"; text: string } | { kind: "count"; count: number };
  }): LookupRow[] {
    return [];
  }

  _nestedOutput(_: Record<string, never>): { payload: { key: string; limit: number } }[] {
    return [];
  }
}

class UnionAnswers {
  _answers(_: Record<string, never>): { value: string | number }[] {
    return [];
  }
}

class InvalidAnswer {
  _answer(_: Record<string, never>): number {
    return 1;
  }
}

class InvalidCallableAnswer {
  _answer(_: Record<string, never>): () => void {
    return () => {};
  }
}

class InvalidNestedRows {
  _answer(_: Record<string, never>): { value: number }[][] {
    return [[{ value: 1 }]];
  }
}

class ArrayPromisedAsOne {
  _answer(_: Record<string, never>): { value: number }[] {
    return [{ value: 1 }];
  }
}

class RecordPromisedAsOptional {
  _answer(_: Record<string, never>): { value: number } {
    return { value: 1 };
  }
}

class AsyncRecordPromisedAsMany {
  static readonly queries = { _answer: "many" } as const;

  async _answer(_: Record<string, never>): Promise<{ value: number }> {
    return { value: 1 };
  }
}

const words = vocabulary({
  concepts: {
    OneAnswer: { class: OneAnswer, queries: { _answer: "one" } },
    ManyAnswers,
    QueriedConcept: { class: QueriedConcept, queries: { _answer: "optional" } },
    UnionAnswers,
  },
  computations: {},
});
const { OneAnswer: Answering } = words.concepts;
const {
  ManyAnswers: Listing,
  QueriedConcept: Looking,
  UnionAnswers: UnionListing,
} = words.concepts;

const lookedUpValue = view("the value for (key)", (inputs, outputs, _bindings) => {
  const key = inputs("key");
  const value = outputs("value");
  return where(Looking._answer({ key }).is({ value }));
}).optional();

const typedLookup: RelationView<{ key: string }, { value: string }, "optional"> = lookedUpValue;
void typedLookup;
lookedUpValue({ key: "present" }).is({ value: "one" });
// @ts-expect-error Inferred view inputs retain their query-slot type.
lookedUpValue({ key: 1 });
// @ts-expect-error Inferred view calls require every declared input.
lookedUpValue({});
// @ts-expect-error Inferred view outputs retain the aliased query-row type.
lookedUpValue({ key: "present" }).is({ value: 1 });
const nestedKey = Symbol("nested-key");
// @ts-expect-error Recursive input patterns retain required nested members.
Looking._nested({ filter: { key: nestedKey } });
// @ts-expect-error Nested values are literals; logic variables bind complete top-level slots only.
Looking._nested({ filter: { key: nestedKey, limit: 1 } });
// @ts-expect-error Nested literal inputs reject undeclared members.
Looking._nested({ filter: { key: "present", limit: 1, extra: true } });
// @ts-expect-error Deep exactness checks objects inside array literals.
Looking._items({ items: [{ id: "one", extra: true }] });
Looking._choice({ choice: { kind: "text", text: "one" } });
Looking._choice({ choice: { kind: "count", count: 1 } });
// @ts-expect-error Deep exactness checks the selected member of an object union.
Looking._choice({ choice: { kind: "text", text: "one", count: 1 } });
// @ts-expect-error Output slot patterns use the same deep exactness contract.
Looking._nestedOutput({}).is({ payload: { key: "one", limit: 1, extra: true } });

const nestedView = view("a nested filter", (inputs, _outputs, _bindings) => {
  const filter = inputs("filter");
  return where(Looking._nested({ filter }));
}).holds();
nestedView({ filter: { key: "present", limit: 1 } });
// @ts-expect-error View calls reject undeclared nested input members.
nestedView({ filter: { key: "present", limit: 1, extra: true } });

const nestedCard = former("a nested card", (inputs, _bindings) => {
  const filter = inputs("filter");
  return where(Looking._nested({ filter })).form({ filter });
});
nestedCard({ filter: { key: "present", limit: 1 } });
// @ts-expect-error Former calls reject undeclared nested input members.
nestedCard({ filter: { key: "present", limit: 1, extra: true } });
// @ts-expect-error Explicit former contracts cannot hide nested broad input leaves.
const nestedUnknownInput: Former<
  { filter: { key: unknown; limit: number } },
  { filter: { key: string; limit: number } }
> = nestedCard;
void nestedUnknownInput;

const mixedValue = view("a mixed value", (_inputs, outputs, _bindings) => {
  const value = outputs("value");
  return [
    where(Answering._answer({}).is({ value })),
    where(Looking._answer({ key: "present" }).is({ value })),
  ];
});
const typedMixedValue: RelationView<
  Record<string, never>,
  { value: string | number },
  "many"
> = mixedValue;
void typedMixedValue;
// @ts-expect-error Alternative output types form a union rather than collapsing to one member.
const stringOnlyMixedValue: RelationView<
  Record<string, never>,
  { value: string },
  "many"
> = mixedValue;
void stringOnlyMixedValue;

const nullableAlternative = view("a nullable alternative", (_inputs, outputs, _bindings) => {
  const value = outputs("value");
  return [
    where(Looking._answer({ key: "present" }).is({ value })),
    where(whether(Looking._answer({ key: "missing" }).is({ value }))),
  ];
});
const typedNullableAlternative: RelationView<
  Record<string, never>,
  { value: string | null },
  "many"
> = nullableAlternative;
void typedNullableAlternative;
// @ts-expect-error Nullable facts from one alternative remain visible in the output contract.
const requiredAlternative: RelationView<
  Record<string, never>,
  { value: string },
  "many"
> = nullableAlternative;
void requiredAlternative;

const numberCard = former("the number card", (_inputs, bindings) => {
  const value = bindings("value");
  return where(Answering._answer({}).is({ value })).form({ value });
});

const optionalNumberCard = former("the optional number card", (_inputs, bindings) => {
  const value = bindings("value");
  return where(Answering._answer({}).is({ value })).form({ value });
}).optional();

const lookupCard = former("the lookup card for (key)", (inputs, bindings) => {
  const key = inputs("key");
  const value = bindings("value");
  return where(Looking._answer({ key }).is({ value })).form({ value });
}).optional();

const lookupEnvelope = former("the lookup envelope for (key)", (inputs, _bindings) => {
  const key = inputs("key");
  return form({ key }).splicing(lookupCard({ key }));
});

const maybeLookupEnvelope = former("the maybe lookup envelope for (key)", (inputs, _bindings) => {
  const key = inputs("key");
  return form({ key }).splicing(whether(lookupCard({ key })));
});

const answerRows = former("all answer rows", (_inputs, bindings) => {
  const value = bindings("value");
  return form({
    rows: each(Listing._answers({}).is({ value })).form({ value }),
    first: each(Listing._answers({}).is({ value })).first(value),
    distinct: each(Listing._answers({}).is({ value })).distinct(value),
  });
});

const unionCard = former("a union-valued card", (_inputs, bindings) => {
  const value = bindings("value");
  return where(UnionListing._answers({}).is({ value })).form({ value });
});

const maybeLookupCard = former("a nullable lookup card for (key)", (inputs, bindings) => {
  const key = inputs("key");
  const value = bindings("value");
  return where(whether(Looking._answer({ key }).is({ value }))).form({ value });
});

const dollarLookup = former("the lookup card for ($)", (inputs, bindings) => {
  const key = inputs("$");
  const value = bindings("value");
  return where(Looking._answer({ key }).is({ value })).form({ value });
});

Answering.acceptCard({ card: numberCard({}) });
Answering.acceptLookup({ card: lookupEnvelope({ key: "present" }) });
Answering.acceptMaybeLookup({ card: maybeLookupEnvelope({ key: "missing" }) });
// @ts-expect-error Inferred former calls require the input discovered from nested use.
lookupEnvelope({});
// @ts-expect-error Inferred former inputs retain their nested former's input type.
lookupEnvelope({ key: 1 });
// @ts-expect-error Optional formed values cannot fill a required non-null action input.
Answering.acceptCard({ card: optionalNumberCard({}) });
// @ts-expect-error A formed object is checked against the complete action-input slot type.
Answering.record({ value: numberCard({}) });
void answerRows;
void maybeLookupEnvelope;
dollarLookup({ $: "present" });
// @ts-expect-error A literal dollar binding retains its inferred slot type.
dollarLookup({ $: 1 });
// @ts-expect-error A literal dollar binding remains a required input.
dollarLookup({});
// @ts-expect-error A literal dollar binding does not make the input mapping open.
dollarLookup({ $: "present", extra: true });
const nullableLookup: Former<{ key: string }, { value: string | null }> = maybeLookupCard;
void nullableLookup;
// @ts-expect-error whether(...) makes newly bound result leaves nullable.
const requiredLookup: Former<{ key: string }, { value: string }> = maybeLookupCard;
void requiredLookup;
// @ts-expect-error A union-valued inferred leaf must not collapse to one member.
const stringOnlyUnion: Former<Record<string, never>, { value: string }> = unionCard;
void stringOnlyUnion;
const nullableEnvelope: Former<{ key: string }, { key: string; value: string | null }> =
  maybeLookupEnvelope;
void nullableEnvelope;
// @ts-expect-error A whether-spliced leaf is nullable, not never.
const impossibleEnvelope: Former<{ key: string }, { key: string; value: never }> =
  maybeLookupEnvelope;
void impossibleEnvelope;

const explicitCard: Former<{ key: string }, { key: string }> = former(
  "an explicitly typed card",
  (inputs, _bindings) => {
    const key = inputs("key");
    return form({ key });
  },
);
explicitCard({ key: "one" });
// @ts-expect-error Explicit former input declarations remain enforced.
explicitCard({ key: 1 });
// @ts-expect-error An explicitly empty input contract remains closed.
numberCard({ extra: true });

// @ts-expect-error A declared former result must agree with the inferred formed tree.
const malformedExplicitCard: Former<{ key: string }, { display: string }> = former(
  "a malformed explicitly typed card",
  (inputs, _bindings) => {
    const key = inputs("key");
    return form({ key });
  },
);
void malformedExplicitCard;

// @ts-expect-error Known inferred leaves cannot be changed by an explicit contract.
const malformedKnownCard: Former<Record<string, never>, { value: string }> = numberCard;
void malformedKnownCard;

// @ts-expect-error An annotation cannot widen an inferred former's accepted input domain.
const widenedFormerInput: Former<{ key: string | number }, { key: string; value: string }> =
  lookupEnvelope;
void widenedFormerInput;
// @ts-expect-error An annotation cannot make a runtime-required former input optional.
const optionalFormerInput: Former<{ key?: string }, { key: string; value: string }> =
  lookupEnvelope;
void optionalFormerInput;
const narrowedFormerInput: Former<{ key: "present" }, { key: string; value: string }> =
  lookupEnvelope;
void narrowedFormerInput;
// @ts-expect-error An explicit contract cannot widen a known input to unknown.
const unknownFormerInput: Former<{ key: unknown }, { key: string; value: string }> = lookupEnvelope;
void unknownFormerInput;
// biome-ignore lint/suspicious/noExplicitAny: this contract test verifies that explicit any cannot bypass input checking.
type ExplicitAny = any;
// @ts-expect-error An explicit contract cannot use any to bypass a known input type.
const anyFormerInput: Former<{ key: ExplicitAny }, { key: string; value: string }> = lookupEnvelope;
void anyFormerInput;
// @ts-expect-error The two-argument Former contract describes a required former.
const requiredOptionalCard: Former<Record<string, never>, { value: number }> = optionalNumberCard;
void requiredOptionalCard;

const explicitlyOptionalCard = explicitCard.optional();
const explicitWhetherEntry = former("an explicit whether entry for (key)", (inputs, _bindings) => {
  const key = inputs("key");
  return form({ card: whether(explicitlyOptionalCard({ key })) });
});
const typedExplicitWhetherEntry: Former<
  { key: string },
  { card: { key: string } | { key: null } }
> = explicitWhetherEntry;
void typedExplicitWhetherEntry;
const explicitWhetherSplice = former(
  "an explicit whether splice for (key)",
  (inputs, _bindings) => {
    const key = inputs("key");
    return form({}).splicing(whether(explicitlyOptionalCard({ key })));
  },
);
const typedExplicitWhetherSplice: Former<{ key: string }, { key: string | null }> =
  explicitWhetherSplice;
void typedExplicitWhetherSplice;

const recordInput: Parameters<typeof Answering.record>[0] = { value: 1 };
const recordOutput: ReturnType<typeof Answering.record> = { value: 1 };
void recordInput;
void recordOutput;

// @ts-expect-error A vocabulary action ref is not assignable as its implementation function.
const recordImplementation: (input: { value: number }) => { value: number } = Answering.record;
void recordImplementation;

const authoredRecord = Answering.record({ value: 1 });
// @ts-expect-error Calling an action ref produces an authored line, not the implementation result.
const calledRecord: { value: number } = authoredRecord;
void calledRecord;

// @ts-expect-error The implementation anchor's required never argument cannot be supplied.
Answering.record({ value: 1 }, undefined);

Answering.choose({ kind: "number" }).responds({ number: 1 });
Answering.choose({ kind: "text" }).responds({ text: "one" });
// @ts-expect-error Variant output fields retain their declared value types.
Answering.choose({ kind: "number" }).responds({ number: "one" });
// @ts-expect-error Output patterns reject fields absent from every return variant.
Answering.choose({ kind: "number" }).responds({ number: 1, unknown: true });

reaction(({ value }) =>
  when(Answering.start({}).responds()).then(
    where(Answering._answer({}).is({ value: 1 }))
      .then(Answering.record({ value: 1 }))
      .named("one"),
    where(Answering._answer({}).is.not({ value: 1 }))
      .then(Answering.record({ value }))
      .named("other"),
  ),
);

reaction(() =>
  when(Answering.start({}).responds())
    // @ts-expect-error Siblings require stable trailing labels.
    .then(Answering.record({ value: 1 }), Answering.record({ value: 2 })),
);

reaction(({ value }) => when(Answering.record({}).responds({ value })).then(Answering.start({})));

reaction(() => when(returned({ action: "start" })).then(Answering.start({})));

reaction(() =>
  when(Answering.start({}).responds()).then(
    // @ts-expect-error A consequence supplies every required action input.
    Answering.record({}),
  ),
);

reaction(() =>
  when(Answering.start({}).responds())
    .then(Answering.record({ value: 1 }))
    // @ts-expect-error The same completeness rule holds after an earlier consequence.
    .then(Answering.record({})),
);

reaction(() =>
  when(Answering.start({}).responds()).then(
    where(Answering._answer({}).is({ value: 1 }))
      // @ts-expect-error A branch-local stage has exactly one consequence.
      .then(Answering.record({ value: 1 }), Answering.record({ value: 2 }))
      .named("many"),
  ),
);

reaction(() =>
  when(Answering.start({}).responds()).then(
    where(Answering._answer({}).is({ value: 1 }))
      // @ts-expect-error A branch-local action is labeled only at the path endpoint.
      .then(Answering.record({ value: 1 }).named("inner"))
      .named("outer"),
  ),
);

reaction(() =>
  when(Answering.start({}).responds()).then(
    where(Answering._answer({}).is({ value: 1 }))
      .then(Answering.record({ value: 1 }))
      .named("done")
      // @ts-expect-error A named branch is terminal and cannot grow another stage.
      .then(Answering.record({ value: 2 })),
  ),
);

reaction(() =>
  when(Answering.start({}).responds()).then(
    where(Answering._answer({}).is({ value: 1 }))
      // @ts-expect-error A qualified consequence also supplies every required action input.
      .then(Answering.record({}))
      .named("incomplete"),
  ),
);

// @ts-expect-error A query returns one record or an array of records.
vocabulary({ concepts: { InvalidAnswer }, computations: {} });

// @ts-expect-error A callable value is not a query record.
vocabulary({ concepts: { InvalidCallableAnswer }, computations: {} });

// @ts-expect-error Each member of a many answer must be a record, not another array.
vocabulary({ concepts: { InvalidNestedRows }, computations: {} });

// @ts-expect-error A one query returns one record, not an array.
vocabulary({ concepts: { Invalid: { class: ArrayPromisedAsOne, queries: { _answer: "one" } } } });

vocabulary({
  concepts: {
    // @ts-expect-error An optional query returns an array containing zero or one record.
    Invalid: { class: RecordPromisedAsOptional, queries: { _answer: "optional" } },
  },
});

// @ts-expect-error A many query returns an array, including when the method is asynchronous.
vocabulary({ concepts: { Invalid: AsyncRecordPromisedAsMany } });
