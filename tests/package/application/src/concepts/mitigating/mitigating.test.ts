import { MitigatingConcept } from "./mitigating.ts";

const mitigating = new MitigatingConcept();
const investigation = mitigating.choose({ room: "checkout", mitigation: "investigate" });
const retry = mitigating.choose({ room: "payments", mitigation: "retry" });

if (mitigating._current({ room: "checkout" })[0]?.selection !== investigation.selection) {
  throw new Error("The initial checkout mitigation was not current.");
}

const rollback = mitigating.choose({ room: "checkout", mitigation: "rollback" });
const checkout = mitigating._current({ room: "checkout" });
if (
  checkout.length !== 1 ||
  checkout[0]?.selection !== rollback.selection ||
  checkout[0].mitigation !== "rollback"
) {
  throw new Error("Choosing a replacement did not leave exactly one current room mitigation.");
}
if (checkout[0].selection === investigation.selection) {
  throw new Error("The superseded mitigation remained current.");
}

const payments = mitigating._current({ room: "payments" });
if (
  payments.length !== 1 ||
  payments[0]?.selection !== retry.selection ||
  payments[0].mitigation !== "retry"
) {
  throw new Error("Replacing one room's mitigation changed another room.");
}
