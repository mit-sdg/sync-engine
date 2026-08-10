import {
  accountCenter,
  CreateProfile,
  DeliverNotification,
  DismissNotification,
  GetAccountCenter,
  MarkNotificationRead,
  RejectUnknownNotificationRecipient,
  RenameProfile,
} from "@catalog/recipe";

for (const declaration of [
  accountCenter,
  CreateProfile,
  RenameProfile,
  DeliverNotification,
  RejectUnknownNotificationRecipient,
  MarkNotificationRead,
  DismissNotification,
  GetAccountCenter,
]) {
  if (declaration === undefined || declaration === null) {
    throw new Error("An account center declaration is absent.");
  }
}

function accepts(
  validator: ((value: unknown) => { ok: boolean }) | undefined,
  value: unknown,
): boolean {
  if (validator === undefined) throw new Error("An account endpoint validator is absent.");
  return validator(value).ok;
}

if (
  !accepts(CreateProfile.validators?.input, { principal: "principal", displayName: "Mina" }) ||
  accepts(CreateProfile.validators?.input, {
    principal: "principal",
    displayName: "Mina",
    extra: true,
  })
) {
  throw new Error("Profile input validation does not enforce its exact bounded shape.");
}
if (
  !accepts(DeliverNotification.validators?.input, {
    profile: "profile",
    topic: "product",
    subject: "Update",
    message: "Available now.",
  }) ||
  accepts(DeliverNotification.validators?.output, { notification: "n".repeat(129) })
) {
  throw new Error("Notification delivery validation does not enforce its bounds.");
}
if (
  !accepts(GetAccountCenter.validators?.output, { account: null }) ||
  accepts(GetAccountCenter.validators?.output, { account: { profile: "partial" } })
) {
  throw new Error("Account output validation does not enforce the joined shape.");
}
console.log("account-center declarations load");
