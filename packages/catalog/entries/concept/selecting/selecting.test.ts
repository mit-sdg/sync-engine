import { SelectingConcept, NoCurrentSelection } from "./selecting.ts";

const values = ["selection-a", "selection-b", "selection-c"];
const selecting = new SelectingConcept(() => values.shift() ?? "unexpected");
selecting.choose({ scope: "workshop", item: "essay-a" });
const current = selecting.choose({ scope: "workshop", item: "essay-b" });
selecting.choose({ scope: "other", item: "essay-c" });
if (selecting._current({ scope: "workshop" })[0]?.selection !== current.selection) {
  throw new Error("The latest scoped selection was not current.");
}
selecting.clear({ scope: "workshop" });
try {
  selecting.clear({ scope: "workshop" });
  throw new Error("An empty scope was cleared twice.");
} catch (error) {
  if (!(error instanceof NoCurrentSelection)) throw error;
}
console.log("Selecting principle holds");
