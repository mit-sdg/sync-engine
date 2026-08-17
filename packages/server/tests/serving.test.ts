import { expect, test } from "vite-plus/test";
import {
  ServiceNotOpen,
  ServingMemoryConcept,
  WithdrawalAlreadyBegan,
} from "../src/serving/serving.ts";

test("Serving withdraws without owning work handed beyond its interactions", () => {
  const serving = new ServingMemoryConcept();
  serving.open({ service: "public", interface: "Browser", address: "http://localhost:3000" });
  serving.admit({ service: "public", admission: "stream" });
  serving.withdraw({ service: "public" });

  expect(serving._get({ service: "public" })).toEqual([
    {
      interface: "Browser",
      address: "http://localhost:3000",
      state: "withdrawing",
      active: 1,
    },
  ]);
  expect(() => serving.admit({ service: "public", admission: "late" })).toThrow(ServiceNotOpen);
  expect(() => serving.withdraw({ service: "public" })).toThrow(WithdrawalAlreadyBegan);

  serving.finish({ admission: "stream" });
  expect(serving._get({ service: "public" })[0]).toMatchObject({ state: "closed", active: 0 });
});
