import { test } from "vite-plus/test";
import { NotifyingConcept, NotificationNotFound } from "./notifying.ts";

function expectNotFound(action: () => unknown, failure: string) {
  try {
    action();
  } catch (error) {
    if (error instanceof NotificationNotFound) return;
    throw error;
  }
  throw new Error(failure);
}

test("Notifying principle holds", () => {
  const values = ["mina-build", "jo-build", "mina-deploy"];
  const notifying = new NotifyingConcept(() => values.shift() ?? "unexpected");
  const first = notifying.deliver({
    recipient: "Mina",
    topic: "build",
    subject: "Build finished",
    message: "Version 7 is ready.",
  });
  const other = notifying.deliver({
    recipient: "Jo",
    topic: "build",
    subject: "Build failed",
    message: "Version 8 needs attention.",
  });
  const second = notifying.deliver({
    recipient: "Mina",
    topic: "deployment",
    subject: "Deployment delayed",
    message: "The rollout is waiting.",
  });

  if (
    first.notification !== "mina-build" ||
    other.notification !== "jo-build" ||
    second.notification !== "mina-deploy"
  ) {
    throw new Error("Injected notification identities were not returned.");
  }

  const minaInbox = notifying._inbox({ recipient: "Mina" });
  if (
    JSON.stringify(minaInbox) !==
    JSON.stringify([
      {
        notification: "mina-build",
        topic: "build",
        subject: "Build finished",
        message: "Version 7 is ready.",
        read: false,
      },
      {
        notification: "mina-deploy",
        topic: "deployment",
        subject: "Deployment delayed",
        message: "The rollout is waiting.",
        read: false,
      },
    ])
  ) {
    throw new Error("The inbox did not retain recipient delivery order.");
  }
  if (notifying._inbox({ recipient: "Jo" })[0]?.notification !== "jo-build") {
    throw new Error("Recipient inboxes were not isolated.");
  }
  if (
    notifying
      ._unread({ recipient: "Mina" })
      .map(({ notification }) => notification)
      .join(",") !== "mina-build,mina-deploy"
  ) {
    throw new Error("Unread notifications did not retain recipient delivery order.");
  }

  const snapshot = () =>
    JSON.stringify({
      first: notifying._get({ notification: "mina-build" }),
      other: notifying._get({ notification: "jo-build" }),
      second: notifying._get({ notification: "mina-deploy" }),
      minaInbox: notifying._inbox({ recipient: "Mina" }),
      minaUnread: notifying._unread({ recipient: "Mina" }),
      joInbox: notifying._inbox({ recipient: "Jo" }),
    });

  notifying.markRead({ notification: "mina-build", recipient: "Mina" });
  const readState = notifying._get({ notification: "mina-build" })[0];
  if (readState?.read !== true || readState.dismissed) {
    throw new Error("Reading did not update only the read flag.");
  }
  if (
    notifying
      ._unread({ recipient: "Mina" })
      .map(({ notification }) => notification)
      .join(",") !== "mina-deploy"
  ) {
    throw new Error("The unread query did not exclude the read notification.");
  }

  const afterRead = snapshot();
  if (
    notifying.markRead({ notification: "mina-build", recipient: "Mina" }).notification !==
      "mina-build" ||
    snapshot() !== afterRead
  ) {
    throw new Error("Marking a notification read was not idempotent.");
  }

  const beforeWrongRecipient = snapshot();
  expectNotFound(
    () => notifying.markRead({ notification: "mina-deploy", recipient: "Jo" }),
    "A wrong recipient marked a notification read.",
  );
  expectNotFound(
    () => notifying.dismiss({ notification: "mina-deploy", recipient: "Jo" }),
    "A wrong recipient dismissed a notification.",
  );
  if (snapshot() !== beforeWrongRecipient) {
    throw new Error("A wrong-recipient refusal changed notification state.");
  }

  notifying.dismiss({ notification: "mina-deploy", recipient: "Mina" });
  const dismissedState = notifying._get({ notification: "mina-deploy" })[0];
  if (dismissedState?.dismissed !== true || dismissedState.read) {
    throw new Error("Dismissing did not update only the dismissed flag.");
  }
  if (
    notifying
      ._inbox({ recipient: "Mina" })
      .map(({ notification }) => notification)
      .join(",") !== "mina-build" ||
    notifying._unread({ recipient: "Mina" }).length !== 0
  ) {
    throw new Error("Dismissed notifications remained active in inbox queries.");
  }

  const afterDismiss = snapshot();
  if (
    notifying.dismiss({ notification: "mina-deploy", recipient: "Mina" }).notification !==
      "mina-deploy" ||
    snapshot() !== afterDismiss
  ) {
    throw new Error("Dismissing a notification was not idempotent.");
  }

  expectNotFound(
    () => notifying.markRead({ notification: "missing", recipient: "Mina" }),
    "An unknown notification was marked read.",
  );
  expectNotFound(
    () => notifying.dismiss({ notification: "missing", recipient: "Mina" }),
    "An unknown notification was dismissed.",
  );
  if (notifying._get({ notification: "missing" }).length !== 0 || snapshot() !== afterDismiss) {
    throw new Error("An unknown-notification refusal changed notification state.");
  }

  const colliding = new NotifyingConcept(() => "same-notification");
  colliding.deliver({ recipient: "Mina", topic: "build", subject: "First", message: "First" });
  const collisionState = JSON.stringify(colliding._get({ notification: "same-notification" }));
  try {
    colliding.deliver({ recipient: "Jo", topic: "build", subject: "Second", message: "Second" });
    throw new Error("A duplicate generated notification identity was accepted.");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Generated notification identity already exists."
    ) {
      throw error;
    }
  }
  if (
    JSON.stringify(colliding._get({ notification: "same-notification" })) !== collisionState ||
    colliding._inbox({ recipient: "Jo" }).length !== 0
  ) {
    throw new Error("A generated identity collision changed notification state.");
  }

  const invalidIdentity = new NotifyingConcept(() => "n".repeat(129));
  try {
    invalidIdentity.deliver({
      recipient: "Mina",
      topic: "build",
      subject: "Build",
      message: "Done",
    });
    throw new Error("An oversized generated notification identity was accepted.");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Generated notification identity must be 1-128 characters."
    ) {
      throw error;
    }
  }
  if (invalidIdentity._inbox({ recipient: "Mina" }).length !== 0) {
    throw new Error("An invalid generated identity changed notification state.");
  }
});
