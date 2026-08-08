import {
  ChooseOperationsItem,
  CreateOperationsRoom,
  GetOperationsRoom,
  JoinOperationsRoom,
  operationsDashboard,
} from "@catalog/recipe";

for (const declaration of [
  ChooseOperationsItem,
  CreateOperationsRoom,
  GetOperationsRoom,
  JoinOperationsRoom,
  operationsDashboard,
]) {
  if (declaration === undefined || declaration === null) {
    throw new Error("An operations dashboard declaration is absent.");
  }
}
console.log("operations-dashboard declarations load");
