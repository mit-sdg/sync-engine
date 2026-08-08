import {
  AddMemberContribution,
  MemberMayContribute,
  MemberMayNotContribute,
  RejectNonmemberContribution,
} from "@catalog/recipe";

for (const declaration of [
  AddMemberContribution,
  MemberMayContribute,
  MemberMayNotContribute,
  RejectNonmemberContribution,
]) {
  if (declaration === undefined || declaration === null) {
    throw new Error("A membership policy declaration is absent.");
  }
}
console.log("member-contributions declarations load");
