import { SelectionOpensDiscussion } from "@catalog/recipe";

if (typeof SelectionOpensDiscussion !== "function") {
  throw new Error("The selection discussion reaction was not declared.");
}
console.log("selection-opens-discussion declaration loads");
