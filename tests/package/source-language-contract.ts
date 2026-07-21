import { reaction, vocabulary, when, where } from "@sync-engine/language";

class OneAnswer {
  start(_: Record<string, never>) {
    return {};
  }

  record({ value }: { value: number }) {
    return { value };
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

const words = vocabulary({
  concepts: {
    OneAnswer: { class: OneAnswer, queries: { _answer: "one" } },
    ManyAnswers,
    QueriedConcept: { class: QueriedConcept, queries: { _answer: "optional" } },
  },
  computations: {},
});
const { OneAnswer: Answering } = words.concepts;

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
