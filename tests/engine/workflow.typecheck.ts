import { declareVars, guard, type Vars } from "@sync-engine/engine";

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
