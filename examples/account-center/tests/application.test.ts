import { readFile } from "node:fs/promises";
import { createLocalClient } from "@mit-sdg/sync-engine/client";
import { describe, expect, test } from "vite-plus/test";
import type { AccountCenterWire } from "../generated/wire.ts";
import { NotifyingConcept } from "../src/concepts/notifying/notifying.ts";
import { PreferringConcept } from "../src/concepts/preferring/preferring.ts";
import { ProfilingConcept } from "../src/concepts/profiling/profiling.ts";
import { buildAccountCenter } from "../src/edge.ts";
import { runScenario } from "../src/scenario.ts";

describe("account-center application", () => {
  test("the typed client runs the complete asserting scenario", async () => {
    await expect(runScenario()).resolves.toEqual({
      missingAccount: null,
      duplicateCreate: "PROFILE_ALREADY_EXISTS",
      unknownPreferenceOwner: "PROFILE_NOT_FOUND",
      unknownNotificationRecipient: "PROFILE_NOT_FOUND",
      displayName: "Avery Morgan",
      preferenceOrder: ["appearance/theme=dark", "communication/digest-frequency=weekly"],
      notificationOrderPreserved: true,
      wrongReader: "NOTIFICATION_NOT_FOUND",
      missingPreferenceClear: "PREFERENCE_NOT_FOUND",
      finalPreferences: ["appearance/theme=dark"],
      finalInboxSize: 0,
    });
  });

  test("the assembly accepts application-owned concept implementations", async () => {
    const profileIDs = ["profile-1"];
    const preferenceIDs = ["preference-1"];
    const notificationIDs = ["notification-1"];
    const { gateway } = buildAccountCenter({
      Profiling: new ProfilingConcept(() => profileIDs.shift() ?? "unexpected-profile"),
      Preferring: new PreferringConcept(() => preferenceIDs.shift() ?? "unexpected-preference"),
      Notifying: new NotifyingConcept(() => notificationIDs.shift() ?? "unexpected-notification"),
    });
    const account = createLocalClient<AccountCenterWire>({ invoker: gateway });

    const created = await account.account.create({ principal: "principal-1", displayName: "Mina" });
    if ("error" in created) throw new Error(created.error);
    await account.account.preferences.set({
      profile: created.profile,
      scope: "appearance",
      key: "theme",
      value: "dark",
    });
    await account.account.notifications.deliver({
      profile: created.profile,
      topic: "product",
      subject: "Available",
      message: "The account center is ready.",
    });

    await expect(account.account.get({ principal: "principal-1" })).resolves.toEqual({
      account: {
        profile: "profile-1",
        principal: "principal-1",
        displayName: "Mina",
        preferences: [
          {
            preference: "preference-1",
            scope: "appearance",
            key: "theme",
            value: "dark",
          },
        ],
        notifications: [
          {
            notification: "notification-1",
            topic: "product",
            subject: "Available",
            message: "The account center is ready.",
            read: false,
          },
        ],
      },
    });
  });

  test("the local gateway rejects fields outside the exact endpoint shape", async () => {
    const { gateway } = buildAccountCenter();

    await expect(
      gateway.invoke("/account/create", {
        principal: "principal-1",
        displayName: "Mina",
        privileged: true,
      } as never),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "framework", code: "INVALID_INPUT" },
    });
  });

  test("the rendered design has no unwritten concept prose", async () => {
    const spec = await readFile(new URL("../generated/account-center.md", import.meta.url), "utf8");
    expect(spec).not.toContain("[unwritten");
  });
});
