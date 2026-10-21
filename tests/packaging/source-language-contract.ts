import { vocabulary } from "@sync-engine/advanced";
import { conceptSet, registerConcept } from "@sync-engine/assembly";
import type { ConceptRegistration, RegisteredConcept } from "@sync-engine/assembly";
import {
  compute,
  count,
  form,
  former,
  now,
  reaction,
  returned,
  when,
  where,
} from "@sync-engine/language";

class OneAnswer {
  start(_: Record<string, never>) {
    return {};
  }

  record({ value }: { value: number }) {
    return { value };
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

class QueriedConcept {
  _answer({ key }: { key: string }): { value: string }[] {
    return key === "present" ? [{ value: key }] : [];
  }

  _numberKey(_: { key: number }): { value: string }[] {
    return [];
  }
}

class GenericValue<Value> {
  _values(_: Record<string, never>): Array<{ value: Value }> {
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
  },
  computations: {},
});
const { OneAnswer: Answering } = words.concepts;
const { QueriedConcept: Looking } = words.concepts;

const specializedWords = vocabulary({
  concepts: { StringValues: GenericValue<string> },
  computations: {},
});
specializedWords.concepts.StringValues._values({}).is({ value: "typed" });
// @ts-expect-error A TypeScript instantiation expression preserves the selected external value type.
specializedWords.concepts.StringValues._values({}).is({ value: 42 });

function registeredGenericContract(
  registration: RegisteredConcept<typeof GenericValue<string>>,
): void {
  const registeredWords = conceptSet({ StringValues: registration });
  registeredWords.concepts.StringValues._values({}).is({ value: "typed" });
  // @ts-expect-error conceptSet preserves a registration's specialized constructor type.
  registeredWords.concepts.StringValues._values({}).is({ value: 42 });
}
void registeredGenericContract;

const calculations = vocabulary({
  concepts: {},
  computations: {
    describe: ({ value }: { value: number }) => ({ label: String(value), doubled: value * 2 }),
  },
}).computations;
const computationLabel = Symbol("computation-label");
const computationDoubled = Symbol("computation-doubled");
compute(
  calculations.describe,
  { value: 2 },
  { label: computationLabel, doubled: computationDoubled },
);
// @ts-expect-error Projected computation outputs reject fields absent from the return type.
compute(calculations.describe, { value: 2 }, { missing: computationLabel });

const arrayCalculation = vocabulary({
  concepts: {},
  computations: { list: () => [{ label: "item" }] },
}).computations.list;
// @ts-expect-error A top-level array result must be bound whole to one variable.
compute(arrayCalculation, {}, [{ label: computationLabel }]);

former("literal fields ()", () =>
  form({ status: "unknown", retryable: false, policy: { mode: "safe" }, tags: [] }),
);
// @ts-expect-error Former literals must be portable JSON data.
former("nonportable literal ()", () => form({ createdAt: new Date() }));

const countResult = Symbol("count-result");
count(Looking._answer, { key: "present" }, countResult);
// @ts-expect-error Count requires every query input.
count(Looking._answer, {}, countResult);
// @ts-expect-error Count rejects undeclared query inputs.
count(Looking._answer, { key: "present", extra: true }, countResult);
const unionCountQuery = (true as boolean) ? Looking._answer : Looking._numberKey;
// @ts-expect-error A union query cannot use one member's string input contract.
count(unionCountQuery, { key: "present" }, countResult);
// @ts-expect-error A union query cannot use one member's numeric input contract.
count(unionCountQuery, { key: 1 }, countResult);

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
  when(Answering.start({}).responds()).where(now(value)).then(Answering.record({ value })),
);

// @ts-expect-error now binds exactly one logic variable.
now("value");

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

reaction(({ value }) =>
  when(Answering.start({}).responds())
    .afterFlowSettles()
    .where(Answering._answer({}).is({ value }))
    .then(Answering.record({ value }))
    .afterFlowSettles()
    .where(Answering._answer({}).is({ value }))
    .then(Answering.record({ value })),
);

reaction(() =>
  when(Answering.start({}).responds())
    .afterFlowSettles()
    // @ts-expect-error A deferred where states at least one condition.
    .where()
    .then(Answering.record({ value: 1 })),
);

reaction(() =>
  when(Answering.start({}).responds())
    .then(Answering.record({ value: 1 }))
    .afterFlowSettles()
    // @ts-expect-error A chained deferred where states at least one condition.
    .where()
    .then(Answering.record({ value: 2 })),
);

const internalTiming = Answering.record({ value: 1 });
// @ts-expect-error Deferred timing is authored through afterFlowSettles().
internalTiming.deferred = true;

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

class BatchedShelf {
  async _title(inputs: readonly { id: string }[]): Promise<{ title: string }[][]> {
    return inputs.map(({ id }) => [{ title: id }]);
  }

  async _book(inputs: { id: string }[]): Promise<{ title: string }[]> {
    return inputs.map(({ id }) => ({ title: id }));
  }
}

class ListTakingShelf {
  async _byIds(ids: string[]): Promise<{ title: string }[]> {
    return ids.map((title) => ({ title }));
  }

  async _byRecords(records: { id: string }[]): Promise<{ title: string }[]> {
    return records.map(({ id }) => ({ title: id }));
  }
}

// A query that takes a list but is not named under `batched` keeps its own types.
const unbatchedWords = vocabulary({ concepts: { Listed: ListTakingShelf }, computations: {} });
unbatchedWords.concepts.Listed._byIds(["a"]);
unbatchedWords.concepts.Listed._byRecords([{ id: "a" }]);
// @ts-expect-error An unbatched list-taking query is not asked with one input.
unbatchedWords.concepts.Listed._byRecords({ id: "a" });

function registeredBatchedContract(spec: string): void {
  const registration = registerConcept({ class: BatchedShelf, spec, batched: ["_title"] });
  const set = conceptSet({ Shelf: registration });
  set.concepts.Shelf._title({ id: "a" }).is({ title: "a" });
  // @ts-expect-error A query the registration does not name keeps its list form.
  set.concepts.Shelf._book({ id: "a" });
  // @ts-expect-error batched names only the class's queries.
  registerConcept({ class: BatchedShelf, spec, batched: ["_missing"] });
}
void registeredBatchedContract;

function annotatedRegistrationContract(spec: string): void {
  // A registration typed with the public descriptor registers as it did before `batched`.
  const annotated: ConceptRegistration<typeof ListTakingShelf> = { class: ListTakingShelf, spec };
  const registered = registerConcept(annotated);
  conceptSet({ Listed: registered }).concepts.Listed._byRecords([{ id: "a" }]);
  const wrap = <C extends new () => object>(registration: ConceptRegistration<C>) =>
    registerConcept(registration);
  void wrap;
  const withBatched: ConceptRegistration<typeof BatchedShelf> = {
    class: BatchedShelf,
    spec,
    // @ts-expect-error A registration typed with the public descriptor names no batched queries.
    batched: ["_title"],
  };
  void withBatched;
  // @ts-expect-error A registration written out as RegisteredConcept<C> names no batched queries.
  const widened: RegisteredConcept<typeof BatchedShelf> = registerConcept({
    class: BatchedShelf,
    spec,
    batched: ["_title"],
  });
  void widened;
  const names: string[] = ["_title"];
  // @ts-expect-error Batched names are literals, so the types can follow them.
  registerConcept({ class: BatchedShelf, spec, batched: names });
}
void annotatedRegistrationContract;

class DefaultedShelf {
  async _title(inputs: readonly { id: string }[] = []): Promise<{ title: string }[]> {
    return inputs.map(({ id }) => ({ title: id }));
  }

  async _book(inputs?: { id: string }[]): Promise<{ title: string }[]> {
    return (inputs ?? []).map(({ id }) => ({ title: id }));
  }
}

function defaultedBatchedContract(): void {
  const shelf = vocabulary({
    concepts: { Shelf: { class: DefaultedShelf, batched: ["_title", "_book"] } },
    computations: {},
  }).concepts.Shelf;
  // A list parameter with a default, or optional, is still asked with one input.
  shelf._title({ id: "a" }).is({ title: "a" });
  shelf._book({ id: "a" }).is({ title: "a" });
  // @ts-expect-error A batched query with a defaulted list is never asked with a list.
  shelf._title([{ id: "a" }]);
}
void defaultedBatchedContract;

function wideBatchedContract(
  names: ("_title" | "_book")[],
  either: ["_title"] | ["_book"],
  records: ("_byIds" | "_byRecords")[],
): void {
  vocabulary({
    // @ts-expect-error A batched list wider than a literal tuple names no query, so list forms fail to type.
    concepts: { Shelf: { class: BatchedShelf, batched: names } },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A union of tuples names no query either.
    concepts: { Shelf: { class: BatchedShelf, batched: either } },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A wide list is refused even when every list form would type as unbatched.
    concepts: { Listed: { class: ListTakingShelf, batched: records } },
    computations: {},
  });
}

function wideRegistrationContract(spec: string, names: ("_title" | "_book")[]): void {
  // @ts-expect-error registerConcept refuses a batched list wider than a literal tuple.
  registerConcept({ class: BatchedShelf, spec, batched: names });
  registerConcept({ class: BatchedShelf, spec, batched: ["_title"] });
}
void wideRegistrationContract;
void wideBatchedContract;

// The types follow `batched` only when its type names one list of queries for
// every value it admits; every other form is refused where it is written.
function batchedFormsContract(spec: string, on: boolean, anyNames: any): void {
  const names = ["_book"];
  vocabulary({
    // @ts-expect-error A list in a variable is a string[], which names no query the types can follow.
    concepts: { Shelf: { class: BatchedShelf, batched: names } },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A list that may be left out names queries only sometimes.
    concepts: { Shelf: { class: BatchedShelf, batched: on ? (["_book"] as const) : undefined } },
    computations: {},
  });
  vocabulary({
    concepts: {
      // @ts-expect-error A conditional spread may leave the list out.
      Shelf: { class: BatchedShelf, ...(on ? { batched: ["_book"] as const } : {}) },
    },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A name chosen by a condition names one query or another.
    concepts: { Shelf: { class: BatchedShelf, batched: [on ? "_title" : "_book"] as const } },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A name may appear once.
    concepts: { Shelf: { class: BatchedShelf, batched: ["_book", "_book"] } },
    computations: {},
  });
  vocabulary({
    // @ts-expect-error A list typed any names nothing the types can read.
    concepts: { Shelf: { class: BatchedShelf, batched: anyNames } },
    computations: {},
  });

  // @ts-expect-error A registration that may leave batched out says nothing sure.
  registerConcept({ class: BatchedShelf, spec, batched: on ? ["_book"] : undefined });
  // @ts-expect-error One list or an empty one is one of several lists.
  registerConcept({ class: BatchedShelf, spec, batched: on ? ["_book"] : [] });
  conceptSet({
    // @ts-expect-error One list or another is one of several lists.
    Shelf: registerConcept({ class: BatchedShelf, spec, batched: on ? ["_title"] : ["_book"] }),
  });
  conceptSet({
    // @ts-expect-error A name chosen by a condition names one query or another.
    Shelf: registerConcept({ class: BatchedShelf, spec, batched: [on ? "_title" : "_book"] }),
  });
  const rest: readonly ["_book", ..."_title"[]] = ["_book"];
  conceptSet({
    // @ts-expect-error A rest element leaves the list's names open.
    Shelf: registerConcept({ class: BatchedShelf, spec, batched: rest }),
  });
  const batchedShelf = registerConcept({ class: BatchedShelf, spec, batched: ["_book"] });
  const plainShelf = registerConcept({ class: ListTakingShelf, spec });
  // @ts-expect-error Choosing between registrations chooses between lists.
  conceptSet({ Shelf: on ? batchedShelf : plainShelf });
  const annotatedWide: RegisteredConcept<
    typeof BatchedShelf,
    Record<never, never>,
    readonly ("_title" | "_book")[]
  > = registerConcept({ class: BatchedShelf, spec, batched: ["_book"] });
  // @ts-expect-error An annotation wider than the list given hides its names.
  conceptSet({ Shelf: annotatedWide });
  const leftOut = { class: BatchedShelf, spec } as ConceptRegistration<
    typeof BatchedShelf,
    Record<never, never>,
    readonly ["_book"]
  >;
  // @ts-expect-error A registration whose type names batched queries must give them.
  registerConcept(leftOut);

  // These name their queries surely, so the types follow them.
  const FIRST = ["_title"] as const;
  const SECOND = ["_book"] as const;
  const surely = conceptSet({
    Constant: registerConcept({ class: BatchedShelf, spec, batched: FIRST }),
    Spread: registerConcept({ class: BatchedShelf, spec, batched: [...FIRST, ...SECOND] }),
    Empty: registerConcept({ class: ListTakingShelf, spec, batched: [] }),
    None: registerConcept({ class: ListTakingShelf, spec }),
  }).concepts;
  surely.Constant._title({ id: "a" });
  surely.Spread._book({ id: "a" });
  surely.Empty._byIds(["a"]);
  surely.None._byIds(["a"]);
  const forward = <
    C extends new () => object,
    const B extends readonly [
      Extract<keyof InstanceType<C>, `_${string}`>,
      ...Extract<keyof InstanceType<C>, `_${string}`>[],
    ],
  >(
    cls: C,
    batched: B,
  ) => registerConcept({ class: cls, spec, batched });
  conceptSet({ Forwarded: forward(BatchedShelf, ["_title"]) }).concepts.Forwarded._title({
    id: "a",
  });
  conceptSet({
    // @ts-expect-error A wrapper that forwards a choice of lists is refused where the set meets it.
    Forwarded: forward(BatchedShelf, on ? ["_title"] : ["_book"]),
  });
}
void batchedFormsContract;

class HalfConvertedShelf {
  async _title(inputs: readonly { id: string }[]): Promise<{ title: string }[]> {
    return inputs.map(({ id }) => ({ title: id }));
  }

  async _paged({ id }: { id: string; page?: number }): Promise<{ title: string }[]> {
    return [{ title: id }];
  }
}

function singleFormContract(spec: string): void {
  vocabulary({
    // @ts-expect-error A query whose method takes one input cannot be batched.
    concepts: { Shelf: { class: HalfConvertedShelf, batched: ["_paged"] } },
    computations: {},
  });
  conceptSet({
    // @ts-expect-error The same holds for a registration.
    Shelf: registerConcept({ class: HalfConvertedShelf, spec, batched: ["_paged"] }),
  });
  const optionalSecond = ["_title", "_book"] as ["_title", "_book"?];
  vocabulary({
    // @ts-expect-error A name that may be left out of the list is refused.
    concepts: { Shelf: { class: BatchedShelf, batched: optionalSecond } },
    computations: {},
  });
  conceptSet({
    Shelf: registerConcept({ class: HalfConvertedShelf, spec, batched: ["_title"] }),
  }).concepts.Shelf._title({ id: "a" });
  vocabulary({
    // @ts-expect-error batched names only the class's queries, in vocabulary as in registerConcept.
    concepts: { Shelf: { class: BatchedShelf, batched: ["_missing"] } },
    computations: {},
  });
}
void singleFormContract;

class StaticallyBatchedShelf extends ListTakingShelf {
  static batched = ["_byIds"] as const;
}
// The runtime reads batched only from a declaration, so a class's own static is not followed.
vocabulary({
  concepts: { Listed: StaticallyBatchedShelf },
  computations: {},
}).concepts.Listed._byIds(["a"]);

const batchedWords = vocabulary({
  concepts: { Shelf: { class: BatchedShelf, batched: ["_title", "_book"] } },
  computations: {},
});
const { Shelf: Shelving } = batchedWords.concepts;
// A batched query reads like its single form: one input, one answer's rows.
Shelving._title({ id: "a" }).is({ title: "a" });
Shelving._book({ id: "a" }).is({ title: "a" });
// @ts-expect-error A batched query is still asked with one input, never a list.
Shelving._title([{ id: "a" }]);
// @ts-expect-error A batched query's rows keep their declared field types.
Shelving._title({ id: "a" }).is({ title: 1 });
// @ts-expect-error A batched query's input keeps its declared field types.
Shelving._book({ id: 1 });
const batchedAnswer: ReturnType<typeof Shelving._title> = Promise.resolve([{ title: "a" }]);
void batchedAnswer;
