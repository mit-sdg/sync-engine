# Browser Session Recipe

## Boundary

This recipe composes Authenticating, Profiling, and Sessioning into six POST
endpoint declarations:

- `Register` at `/auth/register` accepts exactly `identifier`, `secret`, and
  `displayName`, then registers credentials, creates the principal's profile,
  and starts a session. Repeating the exact credential resumes profile creation
  after an interruption or signs into the existing profile without replacing
  its display name.
- `SignIn` at `/auth/sign-in` accepts exactly `identifier` and `secret`, verifies
  them, requires the returned principal to have a profile, and starts a session.
- `CurrentSession` at `/auth/session` requires `session`, resolves its principal
  through Sessioning, and returns the profile, display name, and absolute expiry.
- `RotateSession` at `/auth/session/rotate` requires `session`, verifies that its
  principal still has a profile, atomically rotates it through Sessioning, and
  returns the same identity fields with the new expiry.
- `SignOut` at `/auth/sign-out` requires `session` and ends that session.
- `SignOutAll` at `/auth/sign-out-all` requires `session`, derives its principal,
  and ends every active session for that principal with an explicit count.

All endpoint validators enforce exact object keys. Registration validates
identifier and display-name inputs as 1 to 128 non-trim-empty characters and
secrets as 8 to 1024 characters. Sign-in deliberately passes all string
credentials to Authenticating so malformed and incorrect credentials share its
generic refusal and dummy verification path. Protected endpoint contracts
declare `session` as required and pass any string, or the HTTP adapter's `null`
missing-cookie sentinel, to Sessioning for one generic unknown-session response.
No endpoint accepts a principal or profile claim from the caller.

## HTTP Policy

`browserSessionHttpPolicy(options)` calls the first-party unified `httpPolicy`.
It fixes the cookie input and issued fields to `session` and `expiresAt`, issues
on register, sign-in, and rotation, and clears on both sign-out routes. Callers
may set the public origin, base path, public-error overrides, and cookie name,
SameSite mode, path, domain, and a nonempty allowed-origin list without replacing
those field or route bindings. The helper intentionally does not expose the
lower-level Origin-check opt-out. The default logical cookie name is `session`;
the HTTP package applies its secure host-cookie behavior.

The default public mapping exposes malformed registration values as invalid
requests, duplicate registration/profile state as conflicts, and credential,
profile-on-sign-in, or session failures as unauthorized. Unmapped owner or host
failures remain internal.

## Scope

This is identifier-and-secret authentication and a same-origin, server-side
browser session boundary. It does not normalize identifiers, place identity in
client-controlled request fields, decide what a principal may do, or provide a
durable deployment. The supplied memory variants are process-local and must be
replaced by complete application-owned persistence contracts when restart or
multi-process continuity is required.

Registering credentials, creating a profile, and starting a session are separate
owner actions, not one transaction. Same-credential registration is resumable,
so a failure before profile creation does not permanently strand the identifier;
an undisclosed session created before a response fault expires normally and can
be revoked after signing in again. Applications requiring one atomic durable
bootstrap must implement that invariant in one storage owner. Rotation checks
the profile before invalidating the old session, but response loss after a
successful rotation can still leave the replacement undisclosed; signing in
again is the recovery path.

This focused recipe does not provide credential change endpoints, credential
recovery, email verification, multi-factor authentication, rate limiting, or
resource authorization. Authenticating exposes owner-level secret replacement;
recovery and verification require separate trusted concepts and application
policy.
