<!-- Generated from the Account center assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.8; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.8. -->

# Account center — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Notifying

**Purpose.** Keep retained notification records in delivery order for an in-app inbox, so
each recipient can read and dismiss their own messages without losing history.

**Principle.** Mina receives a build notification and then a deployment notification, with a
notification for Jo delivered between them. Each inbox remains isolated and in
delivery order. Mina marks her build notification read twice and dismisses her
deployment notification twice; both repeated actions have the same result.
Attempts by Jo to change Mina's notification, or to change an unknown
notification, are refused without changing any notification.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `deliver (recipient: Person, topic: Topic, subject: String, message: String) : return (notification: Notification)`

**Authored behavior:**

    then
      append a new notification with recipient, topic, subject, and message
      set its read and dismissed flags to false
      return notification

##### `markRead (notification: Notification, recipient: Person) : return (notification: Notification)`

**Authored behavior:**

    where notification does not identify a notification for recipient
    then
      refuse NOTIFICATION_NOT_FOUND "There is no such notification for this recipient."
      leave state unchanged
    where notification identifies a notification for recipient
    then
      set that notification's read flag to true
      return notification

**Registered refusal codes:** `NOTIFICATION_NOT_FOUND`

##### `dismiss (notification: Notification, recipient: Person) : return (notification: Notification)`

**Authored behavior:**

    where notification does not identify a notification for recipient
    then
      refuse NOTIFICATION_NOT_FOUND "There is no such notification for this recipient."
      leave state unchanged
    where notification identifies a notification for recipient
    then
      set that notification's dismissed flag to true
      return notification

**Registered refusal codes:** `NOTIFICATION_NOT_FOUND`

#### Queries

##### `_get (notification: Notification) : optional (recipient: Person, topic: Topic, subject: String, message: String, read: Flag, dismissed: Flag)`

**Authored behavior:**

    answers no row when notification is unknown
    includes notifications whether read, unread, active, or dismissed

##### `_inbox (recipient: Person) : many (notification: Notification, topic: Topic, subject: String, message: String, read: Flag)`

**Authored behavior:**

    answers only notifications for recipient whose dismissed flag is false
    orders rows by delivery

##### `_unread (recipient: Person) : many (notification: Notification, topic: Topic, subject: String, message: String)`

**Authored behavior:**

    answers only notifications for recipient whose read and dismissed flags are false
    orders rows by delivery

### Profiling

**Purpose.** Associate a display name with one stable profile for each external principal, so
applications can present people consistently without treating profile data as
authentication.

**Principle.** An opaque external principal creates a profile using the display name `  Mina  `.
Both profile lookup and principal lookup return those exact display-name bytes.
A second profile for that principal is refused without changing the first. Mina
renames the profile and both lookups show the new name. Renaming an unknown
profile with a blank name is refused as not found, because existence takes
precedence over display-name validation during rename.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `create (principal: Principal, displayName: String) : return (profile: Profile)`

**Authored behavior:**

    where displayName is empty after trimming
    then
      refuse DISPLAY_NAME_REQUIRED "A display name is required."
    where displayName is not empty after trimming and some profile has principal
    then
      refuse PROFILE_ALREADY_EXISTS "This principal already has a profile."
    where displayName is not empty after trimming and no profile has principal
    then
      add a new profile with principal and the supplied displayName unchanged
      return profile

**Registered refusal codes:** `DISPLAY_NAME_REQUIRED`, `PROFILE_ALREADY_EXISTS`

##### `rename (profile: Profile, displayName: String) : return (profile: Profile)`

**Authored behavior:**

    where profile not in profiles
    then
      refuse PROFILE_NOT_FOUND "There is no such profile."
    where profile in profiles and displayName is empty after trimming
    then
      refuse DISPLAY_NAME_REQUIRED "A display name is required."
    where profile in profiles and displayName is not empty after trimming
    then
      replace its displayName with the supplied displayName unchanged
      return profile

**Registered refusal codes:** `PROFILE_NOT_FOUND`, `DISPLAY_NAME_REQUIRED`

#### Queries

##### `_get (profile: Profile) : optional (principal: Principal, displayName: String)`

**Authored behavior:**

    answers no row for an unknown Profile

##### `_forPrincipal (principal: Principal) : optional (profile: Profile, displayName: String)`

**Authored behavior:**

    answers no row for a Principal without a profile

### RequestBoundary

**Purpose.** Let the outside world ask for things and receive answers, so each authored answer belongs to one pending call and failed waits settle without forging one.

**Principle.** A call arrives and becomes pending. An answer travels back once; timeout or abort ends only the wait, while a quiescent interpreter failure returns an opaque internal error.

Actions:

- `request (…)`
- `respond (…)` — may refuse `NOT_PENDING`

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

```former
Former "the account center of (principal)" — inputs (principal); bindings (profile, displayName, notification, topic, subject, message, read); promises at most one record — forms:
  a record of
    where Profiling._forPrincipal (principal) has (displayName, profile)
    displayName
    notifications: each Notifying._inbox (recipient: profile) has (message, notification, read, subject, topic)
      form a record of
        message
        notification
        read
        subject
        topic
    principal
    profile
```

## Reactions

### DeliverFaultToAsker

```reaction
when any action is faulted, not asked by DeliverFaultToAsker
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respondFramework (error: "INTERNAL_ERROR", requestId)
```

### DeliverRefusalToAsker

```reaction
when any action is refused (message), except RequestBoundary
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respond (error: message, requestId)
```

### accountCenter.CreateProfile

```reaction
when RequestBoundary.request (displayName, path: "/account/create", principal, requestId)
then
  Profiling.create (displayName, principal)
```

### accountCenter.CreateProfile#2

```reaction
when Profiling.create (displayName, principal, profile), asked by accountCenter.CreateProfile
where
  earlier, RequestBoundary.request (displayName, path: "/account/create", principal, requestId)
then
  RequestBoundary.respond (profile, requestId)
```

### accountCenter.DeliverNotification

```reaction
when RequestBoundary.request (message, path: "/account/notifications/deliver", profile, requestId, subject, topic)
where
  Profiling._get (profile)
then
  Notifying.deliver (message, recipient: profile, subject, topic)
```

### accountCenter.DeliverNotification#2

```reaction
when Notifying.deliver (message, recipient: profile, subject, topic, notification), asked by accountCenter.DeliverNotification
where
  earlier, RequestBoundary.request (message, path: "/account/notifications/deliver", profile, requestId, subject, topic)
then
  RequestBoundary.respond (notification, requestId)
```

### accountCenter.DismissNotification

```reaction
when RequestBoundary.request (notification, path: "/account/notifications/dismiss", profile, requestId)
then
  Notifying.dismiss (notification, recipient: profile)
```

### accountCenter.DismissNotification#2

```reaction
when Notifying.dismiss (notification, recipient: profile), asked by accountCenter.DismissNotification
where
  earlier, RequestBoundary.request (notification, path: "/account/notifications/dismiss", profile, requestId)
then
  RequestBoundary.respond (notification, requestId)
```

### accountCenter.GetAccountCenter

```reaction
when RequestBoundary.request (path: "/account/get", principal, requestId)
then
  RequestBoundary.respond (account: former "the account center of (principal)" with (principal), requestId)
```

### accountCenter.MarkNotificationRead

```reaction
when RequestBoundary.request (notification, path: "/account/notifications/read", profile, requestId)
then
  Notifying.markRead (notification, recipient: profile)
```

### accountCenter.MarkNotificationRead#2

```reaction
when Notifying.markRead (notification, recipient: profile), asked by accountCenter.MarkNotificationRead
where
  earlier, RequestBoundary.request (notification, path: "/account/notifications/read", profile, requestId)
then
  RequestBoundary.respond (notification, requestId)
```

### accountCenter.RejectUnknownNotificationRecipient

```reaction
when RequestBoundary.request (message, path: "/account/notifications/deliver", profile, requestId, subject, topic)
where
  no Profiling._get (profile)
then
  RequestBoundary.respond (error: "PROFILE_NOT_FOUND", requestId)
```

### accountCenter.RenameProfile

```reaction
when RequestBoundary.request (displayName, path: "/account/rename", profile, requestId)
then
  Profiling.rename (displayName, profile)
```

### accountCenter.RenameProfile#2

```reaction
when Profiling.rename (displayName, profile), asked by accountCenter.RenameProfile
where
  earlier, RequestBoundary.request (displayName, path: "/account/rename", profile, requestId)
then
  RequestBoundary.respond (profile, requestId)
```

## Endpoint input contracts

Before recording an action ask, the boundary rejects a body that is not an
object or lacks a required key. The response uses `INVALID_INPUT` and names
the path or missing key. A declared default fills an absent key. Endpoints
not listed here have no explicit input contract.

- `/account/create` — requires `principal`, `displayName`
- `/account/get` — requires `principal`
- `/account/notifications/deliver` — requires `profile`, `topic`, `subject`, `message`
- `/account/notifications/dismiss` — requires `profile`, `notification`
- `/account/notifications/read` — requires `profile`, `notification`
- `/account/rename` — requires `profile`, `displayName`
