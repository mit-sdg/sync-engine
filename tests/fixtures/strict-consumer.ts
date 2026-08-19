import { vocabulary } from "../../dist/advanced/index.js";
import { each, former, reaction, view, when, where } from "../../dist/language/index.js";

class Records {
  add({ value }: { value: string }) {
    return { id: value };
  }
  _all({ scope }: { scope: string }) {
    return [{ id: scope, value: scope }];
  }
}

const RecordsRef = vocabulary({
  concepts: { Records: { class: Records, queries: { _all: "many" } } },
  computations: {},
}).concepts.Records;

const allRecords = view("all records in (scope)", ({ scope }, { id }, { value }) =>
  where(RecordsRef._all({ scope }).is({ id, value })),
).many();

const recordValues = former("record values in (scope)", ({ scope }, { id, value }) =>
  each(RecordsRef._all({ scope }).is({ id, value })).form({ id, value }),
);

reaction(({ scope, id, value }) =>
  when(RecordsRef.add({ value }).responds({ id }))
    .where(allRecords({ scope }).is({ id }))
    .then(RecordsRef.add({ value: recordValues({ scope }) })),
);
