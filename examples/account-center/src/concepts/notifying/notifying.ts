export class NotificationNotFound extends Error {}

type Notification = {
  notification: string;
  recipient: string;
  topic: string;
  subject: string;
  message: string;
  read: boolean;
  dismissed: boolean;
};

type NotificationDetails = Omit<Notification, "notification">;
type InboxNotification = Pick<
  Notification,
  "notification" | "topic" | "subject" | "message" | "read"
>;
type UnreadNotification = Omit<InboxNotification, "read">;

function generatedNotification(freshID: () => string): string {
  const notification = freshID();
  if (notification.length < 1 || notification.length > 128) {
    throw new Error("Generated notification identity must be 1-128 characters.");
  }
  return notification;
}

/** Retain ordered in-app notifications and their recipient-owned status. */
export class NotifyingConcept {
  private readonly notifications = new Map<string, Notification>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  deliver({
    recipient,
    topic,
    subject,
    message,
  }: {
    recipient: string;
    topic: string;
    subject: string;
    message: string;
  }) {
    const notification = generatedNotification(this.freshID);
    if (this.notifications.has(notification)) {
      throw new Error("Generated notification identity already exists.");
    }
    this.notifications.set(notification, {
      notification,
      recipient,
      topic,
      subject,
      message,
      read: false,
      dismissed: false,
    });
    return { notification };
  }

  markRead({ notification, recipient }: { notification: string; recipient: string }) {
    const found = this.#forRecipient(notification, recipient);
    if (found === undefined) throw new NotificationNotFound();
    found.read = true;
    return { notification };
  }

  dismiss({ notification, recipient }: { notification: string; recipient: string }) {
    const found = this.#forRecipient(notification, recipient);
    if (found === undefined) throw new NotificationNotFound();
    found.dismissed = true;
    return { notification };
  }

  _get({ notification }: { notification: string }): NotificationDetails[] {
    const found = this.notifications.get(notification);
    return found === undefined
      ? []
      : [
          {
            recipient: found.recipient,
            topic: found.topic,
            subject: found.subject,
            message: found.message,
            read: found.read,
            dismissed: found.dismissed,
          },
        ];
  }

  _inbox({ recipient }: { recipient: string }): InboxNotification[] {
    return [...this.notifications.values()]
      .filter((notification) => notification.recipient === recipient && !notification.dismissed)
      .map(({ notification, topic, subject, message, read }) => ({
        notification,
        topic,
        subject,
        message,
        read,
      }));
  }

  _unread({ recipient }: { recipient: string }): UnreadNotification[] {
    return [...this.notifications.values()]
      .filter(
        (notification) =>
          notification.recipient === recipient && !notification.read && !notification.dismissed,
      )
      .map(({ notification, topic, subject, message }) => ({
        notification,
        topic,
        subject,
        message,
      }));
  }

  #forRecipient(notification: string, recipient: string): Notification | undefined {
    const found = this.notifications.get(notification);
    return found?.recipient === recipient ? found : undefined;
  }
}
