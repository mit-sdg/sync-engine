import { normalizeLabel } from "./normalize-label.ts";

if (normalizeLabel({ label: "  Restart   Service  " }) !== "restart service") {
  throw new Error("The label was not normalized.");
}
if (normalizeLabel({ label: "already-stable" }) !== "already-stable") {
  throw new Error("A stable label changed unexpectedly.");
}
console.log("normalizeLabel evidence holds");
