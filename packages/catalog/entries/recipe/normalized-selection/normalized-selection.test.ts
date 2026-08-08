import { GatheringNameBecomesInitialSelection } from "@catalog/recipe";

if (typeof GatheringNameBecomesInitialSelection !== "function") {
  throw new Error("The normalized initial selection reaction was not declared.");
}
console.log("normalized-selection declaration loads");
