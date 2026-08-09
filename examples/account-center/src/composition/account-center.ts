import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { each, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Notifying, Preferring, Profiling } = concepts;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum;
}

function validator(
  accepts: (value: Record<string, unknown>) => boolean,
  detail: string,
): EndpointValidator {
  return (value) => (record(value) && accepts(value) ? { ok: true } : { ok: false, detail });
}

function preferenceRow(value: unknown): boolean {
  return (
    record(value) &&
    hasOnly(value, ["preference", "scope", "key", "value"]) &&
    boundedString(value.preference, 128) &&
    boundedString(value.scope, 128) &&
    boundedString(value.key, 128) &&
    boundedString(value.value, 4_096)
  );
}

function notificationRow(value: unknown): boolean {
  return (
    record(value) &&
    hasOnly(value, ["notification", "topic", "subject", "message", "read"]) &&
    boundedString(value.notification, 128) &&
    boundedString(value.topic, 128) &&
    boundedString(value.subject, 256) &&
    boundedString(value.message, 4_096) &&
    typeof value.read === "boolean"
  );
}

function accountRow(value: unknown): boolean {
  return (
    record(value) &&
    hasOnly(value, ["profile", "principal", "displayName", "preferences", "notifications"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.principal, 128) &&
    boundedString(value.displayName, 128) &&
    Array.isArray(value.preferences) &&
    value.preferences.every(preferenceRow) &&
    Array.isArray(value.notifications) &&
    value.notifications.every(notificationRow)
  );
}

const createProfileInput = validator(
  (value) =>
    hasOnly(value, ["principal", "displayName"]) &&
    boundedString(value.principal, 128) &&
    boundedString(value.displayName, 128),
  "principal and displayName must be strings between 1 and 128 characters",
);

const renameProfileInput = validator(
  (value) =>
    hasOnly(value, ["profile", "displayName"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.displayName, 128),
  "profile and displayName must be strings between 1 and 128 characters",
);

const setPreferenceInput = validator(
  (value) =>
    hasOnly(value, ["profile", "scope", "key", "value"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.scope, 128) &&
    boundedString(value.key, 128) &&
    boundedString(value.value, 4_096),
  "profile, scope, and key must be 1-128 characters and value 1-4096",
);

const clearPreferenceInput = validator(
  (value) =>
    hasOnly(value, ["profile", "scope", "key"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.scope, 128) &&
    boundedString(value.key, 128),
  "profile, scope, and key must be strings between 1 and 128 characters",
);

const notificationInput = validator(
  (value) =>
    hasOnly(value, ["profile", "notification"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.notification, 128),
  "profile and notification must be strings between 1 and 128 characters",
);

const deliverNotificationInput = validator(
  (value) =>
    hasOnly(value, ["profile", "topic", "subject", "message"]) &&
    boundedString(value.profile, 128) &&
    boundedString(value.topic, 128) &&
    boundedString(value.subject, 256) &&
    boundedString(value.message, 4_096),
  "profile and topic must be 1-128 characters, subject 1-256, and message 1-4096",
);

const accountInput = validator(
  (value) => hasOnly(value, ["principal"]) && boundedString(value.principal, 128),
  "principal must be a string between 1 and 128 characters",
);

const profileOutput = validator(
  (value) => hasOnly(value, ["profile"]) && boundedString(value.profile, 128),
  "response must contain exactly one bounded profile",
);

const preferenceOutput = validator(
  (value) => hasOnly(value, ["preference"]) && boundedString(value.preference, 128),
  "response must contain exactly one bounded preference",
);

const notificationOutput = validator(
  (value) => hasOnly(value, ["notification"]) && boundedString(value.notification, 128),
  "response must contain exactly one bounded notification",
);

const accountOutput = validator(
  (value) => hasOnly(value, ["account"]) && (value.account === null || accountRow(value.account)),
  "response must contain exactly one valid account row or null",
);

const profileNotFound: EndpointValidator = (value) =>
  value === "PROFILE_NOT_FOUND"
    ? { ok: true }
    : { ok: false, detail: 'error must be exactly "PROFILE_NOT_FOUND"' };

const preferenceError: EndpointValidator = (value) =>
  value === "PROFILE_NOT_FOUND" || value === "PREFERENCE_NOT_FOUND"
    ? { ok: true }
    : {
        ok: false,
        detail: 'error must be exactly "PROFILE_NOT_FOUND" or "PREFERENCE_NOT_FOUND"',
      };

/** Join a profile to its preferences and inbox without reordering query rows. */
export const accountCenter = former(
  "the account center of (principal)",
  (
    { principal },
    {
      profile,
      displayName,
      preference,
      scope,
      key,
      value,
      notification,
      topic,
      subject,
      message,
      read,
    },
  ) =>
    where(Profiling._forPrincipal({ principal }).is({ profile, displayName })).form({
      profile,
      principal,
      displayName,
      preferences: each(
        Preferring._all({ owner: profile }).is({ preference, scope, key, value }),
      ).form({ preference, scope, key, value }),
      notifications: each(
        Notifying._inbox({ recipient: profile }).is({
          notification,
          topic,
          subject,
          message,
          read,
        }),
      ).form({ notification, topic, subject, message, read }),
    }),
).optional();

/**
 * Principal and profile inputs are caller claims until a trusted adapter binds
 * them. This boundary provides neither authentication nor authorization.
 */
export const CreateProfile = endpoint(
  "/account/create",
  ({ principal, displayName, profile }) =>
    receive({ principal, displayName })
      .then(Profiling.create({ principal, displayName }).responds({ profile }))
      .then(respond({ profile })),
  {
    input: { required: ["principal", "displayName"] },
    validators: { input: createProfileInput, output: profileOutput },
  },
);

export const RenameProfile = endpoint(
  "/account/rename",
  ({ profile, displayName }) =>
    receive({ profile, displayName })
      .then(Profiling.rename({ profile, displayName }).responds({ profile }))
      .then(respond({ profile })),
  {
    input: { required: ["profile", "displayName"] },
    validators: { input: renameProfileInput, output: profileOutput },
  },
);

export const SetPreference = endpoint(
  "/account/preferences/set",
  ({ profile, scope, key, value, preference }) =>
    receive({ profile, scope, key, value })
      .where(Profiling._get({ profile }))
      .then(Preferring.set({ owner: profile, scope, key, value }).responds({ preference }))
      .then(respond({ preference })),
  {
    input: { required: ["profile", "scope", "key", "value"] },
    validators: { input: setPreferenceInput, output: preferenceOutput },
  },
);

export const RejectUnknownPreferenceOwner = endpoint(
  "/account/preferences/set",
  ({ profile, scope, key, value }) =>
    receive({ profile, scope, key, value })
      .where(no(Profiling._get({ profile })))
      .then(respond({ error: "PROFILE_NOT_FOUND" })),
  { validators: { domainError: profileNotFound } },
);

export const ClearPreference = endpoint(
  "/account/preferences/clear",
  ({ profile, scope, key, preference }) =>
    receive({ profile, scope, key })
      .where(Profiling._get({ profile }))
      .then(Preferring.clear({ owner: profile, scope, key }).responds({ preference }))
      .then(respond({ preference })),
  {
    input: { required: ["profile", "scope", "key"] },
    validators: { input: clearPreferenceInput, output: preferenceOutput },
  },
);

export const RejectUnknownPreferenceClear = endpoint(
  "/account/preferences/clear",
  ({ profile, scope, key }) =>
    receive({ profile, scope, key })
      .where(no(Profiling._get({ profile })))
      .then(respond({ error: "PROFILE_NOT_FOUND" })),
  { validators: { domainError: preferenceError } },
);

/** Trusted service delivery; adapters must bind profile from authorized context. */
export const DeliverNotification = endpoint(
  "/account/notifications/deliver",
  ({ profile, topic, subject, message, notification }) =>
    receive({ profile, topic, subject, message })
      .where(Profiling._get({ profile }))
      .then(
        Notifying.deliver({ recipient: profile, topic, subject, message }).responds({
          notification,
        }),
      )
      .then(respond({ notification })),
  {
    input: { required: ["profile", "topic", "subject", "message"] },
    validators: { input: deliverNotificationInput, output: notificationOutput },
  },
);

export const RejectUnknownNotificationRecipient = endpoint(
  "/account/notifications/deliver",
  ({ profile, topic, subject, message }) =>
    receive({ profile, topic, subject, message })
      .where(no(Profiling._get({ profile })))
      .then(respond({ error: "PROFILE_NOT_FOUND" })),
  { validators: { domainError: profileNotFound } },
);

export const MarkNotificationRead = endpoint(
  "/account/notifications/read",
  ({ profile, notification }) =>
    receive({ profile, notification })
      .then(Notifying.markRead({ recipient: profile, notification }).responds({ notification }))
      .then(respond({ notification })),
  {
    input: { required: ["profile", "notification"] },
    validators: { input: notificationInput, output: notificationOutput },
  },
);

export const DismissNotification = endpoint(
  "/account/notifications/dismiss",
  ({ profile, notification }) =>
    receive({ profile, notification })
      .then(Notifying.dismiss({ recipient: profile, notification }).responds({ notification }))
      .then(respond({ notification })),
  {
    input: { required: ["profile", "notification"] },
    validators: { input: notificationInput, output: notificationOutput },
  },
);

export const GetAccountCenter = endpoint(
  "/account/get",
  ({ principal }) =>
    receive({ principal }).then(respond({ account: accountCenter({ principal }) })),
  {
    input: { required: ["principal"] },
    validators: { input: accountInput, output: accountOutput },
  },
);
