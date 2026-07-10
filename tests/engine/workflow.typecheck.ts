import { declareVars, Frames, guard, type Vars } from "@sync-engine/engine";

const { amount } = declareVars<{ amount: number }>();

guard(($) => {
  const value: number = $(amount);
  return value > 1000;
});

const legacy = {} as Vars;

guard(($) => {
  // Untyped sync variables intentionally require narrowing before use.
  // @ts-expect-error Legacy Vars bind unknown values.
  return $(legacy.amount) > 1000;
});

// bind() preserves the value type in the returned frame.
{
  const SymA = Symbol("a");
  const frames = new Frames<Record<symbol, number>>();
  const result = frames.bind(SymA, "hello");
  // accessing the bound symbol should yield string, not unknown
  const str: string = result[0][SymA];
  void str;
}

// query() accepts a function returning a single object (not an array).
{
  const SymX = Symbol("x");
  const frames = new Frames();
  frames.query(() => ({ name: "test" }), {}, { name: SymX });
  frames.query(() => Promise.resolve({ name: "test" }), {}, { name: SymX });
}
