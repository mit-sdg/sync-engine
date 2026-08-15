import { vocabulary } from "@sync-engine/advanced";
import { count, reaction, returned, when, where } from "@sync-engine/language";

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
