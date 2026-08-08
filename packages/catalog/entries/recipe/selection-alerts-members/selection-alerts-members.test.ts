import { SelectionAlertsMembers } from "@catalog/recipe";

if (typeof SelectionAlertsMembers !== "function") {
  throw new Error("The member alert reaction was not declared.");
}
console.log("selection-alerts-members declaration loads");
