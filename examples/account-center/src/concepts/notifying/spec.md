# Notifying

## Purpose

Keep retained notification records in delivery order for an in-app inbox, so
each recipient can read and dismiss their own messages without losing history.

## Principle

Mina receives a build notification and then a deployment notification, with a
notification for Jo delivered between them. Each inbox remains isolated and in
delivery order. Mina marks her build notification read twice and dismisses her
deployment notification twice; both repeated actions have the same result.
Attempts by Jo to change Mina's notification, or to change an unknown
notification, are refused without changing any notification.

## State

```state
a seq of Notifications with
  a notification Notification
  a recipient Person
  a topic Topic
  a subject String
  a message String
  a read Flag
  a dismissed Flag
```

Each notification identifies exactly one entry. New entries have false read and
dismissed flags. Reading or dismissing an entry does not remove it or change its
delivery position.

## Actions

```actions
deliver (recipient: Person, topic: Topic, subject: String, message: String) : return (notification: Notification)
  then
    append a new notification with recipient, topic, subject, and message
    set its read and dismissed flags to false
    return notification

markRead (notification: Notification, recipient: Person) : return (notification: Notification)
  where notification does not identify a notification for recipient
  then
    refuse NOTIFICATION_NOT_FOUND "There is no such notification for this recipient."
    leave state unchanged
  where notification identifies a notification for recipient
  then
    set that notification's read flag to true
    return notification

dismiss (notification: Notification, recipient: Person) : return (notification: Notification)
  where notification does not identify a notification for recipient
  then
    refuse NOTIFICATION_NOT_FOUND "There is no such notification for this recipient."
    leave state unchanged
  where notification identifies a notification for recipient
  then
    set that notification's dismissed flag to true
    return notification
```

`markRead` and `dismiss` are idempotent for the notification's recipient,
including after their respective flag is already true.

## Queries

```queries
_get (notification: Notification) : optional (recipient: Person, topic: Topic, subject: String, message: String, read: Flag, dismissed: Flag)
  answers no row when notification is unknown
  includes notifications whether read, unread, active, or dismissed
_inbox (recipient: Person) : many (notification: Notification, topic: Topic, subject: String, message: String, read: Flag)
  answers only notifications for recipient whose dismissed flag is false
  orders rows by delivery
_unread (recipient: Person) : many (notification: Notification, topic: Topic, subject: String, message: String)
  answers only notifications for recipient whose read and dismissed flags are false
  orders rows by delivery
```

Notifying owns retained inbox state; it does not send email or push messages,
choose recipients or content, or expose notifications as endpoints. Every
`deliver` call creates a distinct notification, so Notifying does not deduplicate
requests or guarantee exactly-once delivery. `_get` is an internal identity
lookup, not an authorization boundary. The memory variant is process-local;
applications that require restart durability must provide persistent storage
while preserving this contract. An injected identity source must return fresh
notification identities between 1 and 128 characters. An invalid or colliding
generated identity is an internal host failure and leaves notification state
unchanged.
