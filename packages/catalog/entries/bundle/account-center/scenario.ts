import { FrameworkErrorCode } from "@mit-sdg/sync-engine/boundary";
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { AccountCenterWire } from "../generated/wire.ts";
import { buildAccountCenter } from "./edge.ts";

type AccountCenterError =
  | (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode]
  | "DISPLAY_NAME_REQUIRED"
  | "NOTIFICATION_NOT_FOUND"
  | "PREFERENCE_NOT_FOUND"
  | "PROFILE_ALREADY_EXISTS"
  | "PROFILE_NOT_FOUND";

function fail(operation: string, error: AccountCenterError): never {
  switch (error) {
    case "ABORTED":
    case "DISPLAY_NAME_REQUIRED":
    case "INTERNAL_ERROR":
    case "INVALID_INPUT":
    case "NOTIFICATION_NOT_FOUND":
    case "NOT_FOUND":
    case "PREFERENCE_NOT_FOUND":
    case "PROFILE_ALREADY_EXISTS":
    case "PROFILE_NOT_FOUND":
    case "TIMED_OUT":
    case "TRANSPORT_ERROR":
    case "UNAVAILABLE":
    case "UNKNOWN_ERROR":
      throw new Error(`${operation} failed: ${error}`);
  }
  const unhandled: never = error;
  throw new Error(`${operation} failed with an unknown error: ${String(unhandled)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const principal = "principal_7f3a9c";
const originalDisplayName = "Avery Chen";
const renamedDisplayName = "Avery Morgan";

const { gateway } = buildAccountCenter();
const operations = createLocalClient<AccountCenterWire>({ invoker: gateway });

const missing = await operations.account.get({ principal: "principal_missing" });
if ("error" in missing) fail("read missing account", missing.error);
assert(missing.account === null, "An unknown principal returned an account.");

const created = await operations.account.create({ principal, displayName: originalDisplayName });
if ("error" in created) fail("create profile", created.error);
const profile = created.profile;

const duplicate = await operations.account.create({
  principal,
  displayName: "Attempted replacement",
});
if (!("error" in duplicate)) throw new Error("A duplicate profile creation was accepted.");
if (duplicate.error !== "PROFILE_ALREADY_EXISTS") fail("refuse duplicate profile", duplicate.error);

const themeSet = await operations.account.preferences.set({
  profile,
  scope: "appearance",
  key: "theme",
  value: "dark",
});
if ("error" in themeSet) fail("set theme preference", themeSet.error);

const digestSet = await operations.account.preferences.set({
  profile,
  scope: "communication",
  key: "digest-frequency",
  value: "weekly",
});
if ("error" in digestSet) fail("set digest preference", digestSet.error);

const unknownPreference = await operations.account.preferences.set({
  profile: "profile_missing",
  scope: "appearance",
  key: "theme",
  value: "light",
});
if (!("error" in unknownPreference)) throw new Error("An unknown profile received a preference.");
if (unknownPreference.error !== "PROFILE_NOT_FOUND") {
  fail("refuse unknown preference owner", unknownPreference.error);
}

const product = await operations.account.notifications.deliver({
  profile,
  topic: "product-updates",
  subject: "New account features",
  message: "Your account center now supports retained notification state.",
});
if ("error" in product) fail("deliver product notification", product.error);

const security = await operations.account.notifications.deliver({
  profile,
  topic: "security",
  subject: "Security notice",
  message: "A new recovery method was added.",
});
if ("error" in security) fail("deliver security notification", security.error);

const unknownDelivery = await operations.account.notifications.deliver({
  profile: "profile_missing",
  topic: "product-updates",
  subject: "Not delivered",
  message: "An unknown profile must not receive an inbox item.",
});
if (!("error" in unknownDelivery)) throw new Error("An unknown profile received a notification.");
if (unknownDelivery.error !== "PROFILE_NOT_FOUND") {
  fail("refuse unknown notification recipient", unknownDelivery.error);
}

const renamed = await operations.account.rename({ profile, displayName: renamedDisplayName });
if ("error" in renamed) fail("rename profile", renamed.error);

const joined = await operations.account.get({ principal });
if ("error" in joined) fail("read joined account", joined.error);
assert(joined.account !== null, "The joined account was not found.");
assert(joined.account.displayName === renamedDisplayName, "The joined account was not renamed.");
assert(
  joined.account.preferences.map(({ scope, key, value }) => `${scope}/${key}=${value}`).join(",") ===
    "appearance/theme=dark,communication/digest-frequency=weekly",
  "The joined account did not preserve first-set preference order.",
);
assert(
  joined.account.notifications.map(({ notification }) => notification).join(",") ===
    `${product.notification},${security.notification}`,
  "The joined account did not preserve notification delivery order.",
);
assert(
  joined.account.notifications.every(({ read }) => read === false),
  "A delivered notification did not start unread.",
);

const wrongReader = await operations.account.notifications.read({
  profile: "profile_other",
  notification: product.notification,
});
if (!("error" in wrongReader)) throw new Error("Another profile marked a notification read.");
if (wrongReader.error !== "NOTIFICATION_NOT_FOUND") fail("refuse wrong reader", wrongReader.error);

const markedRead = await operations.account.notifications.read({
  profile,
  notification: product.notification,
});
if ("error" in markedRead) fail("mark notification read", markedRead.error);

const readBack = await operations.account.get({ principal });
if ("error" in readBack) fail("read marked notification", readBack.error);
assert(readBack.account !== null, "The account disappeared after marking a notification read.");
assert(
  readBack.account.notifications[0]?.read === true &&
    readBack.account.notifications[1]?.read === false,
  "Reading one notification changed the wrong inbox state.",
);

const cleared = await operations.account.preferences.clear({
  profile,
  scope: "communication",
  key: "digest-frequency",
});
if ("error" in cleared) fail("clear digest preference", cleared.error);
assert(cleared.preference === digestSet.preference, "Clear returned the wrong preference.");

const repeatedClear = await operations.account.preferences.clear({
  profile,
  scope: "communication",
  key: "digest-frequency",
});
if (!("error" in repeatedClear)) throw new Error("A missing preference was cleared twice.");
if (repeatedClear.error !== "PREFERENCE_NOT_FOUND") {
  fail("refuse missing preference clear", repeatedClear.error);
}

for (const notification of [product.notification, security.notification]) {
  const dismissed = await operations.account.notifications.dismiss({ profile, notification });
  if ("error" in dismissed) fail("dismiss notification", dismissed.error);
}

const finalResult = await operations.account.get({ principal });
if ("error" in finalResult) fail("read final account", finalResult.error);
assert(finalResult.account !== null, "The final account was not found.");
assert(finalResult.account.preferences.length === 1, "The final account did not have one preference.");
assert(
  finalResult.account.preferences[0]?.preference === themeSet.preference &&
    finalResult.account.preferences[0].scope === "appearance" &&
    finalResult.account.preferences[0].key === "theme" &&
    finalResult.account.preferences[0].value === "dark",
  "The final account did not retain only the theme preference.",
);
assert(finalResult.account.notifications.length === 0, "The final inbox was not empty.");

console.log(
  JSON.stringify(
    {
      missingAccount: missing.account,
      duplicateCreate: duplicate.error,
      unknownPreferenceOwner: unknownPreference.error,
      unknownNotificationRecipient: unknownDelivery.error,
      displayName: finalResult.account.displayName,
      preferenceOrder: ["appearance/theme=dark", "communication/digest-frequency=weekly"],
      notificationOrderPreserved: true,
      wrongReader: wrongReader.error,
      missingPreferenceClear: repeatedClear.error,
      finalPreferences: ["appearance/theme=dark"],
      finalInboxSize: finalResult.account.notifications.length,
    },
    null,
    2,
  ),
);
