# Authenticating password-verifier strategy

Authenticating delegates password derivation and checking to an injected
`PasswordVerifierStrategy`. This file describes implementation security configuration;
the algorithm and cost are not part of the [concept specification](spec.md) or
its observable behavior.

## Shipped strategy

The default `argon2idPasswordVerifier` uses `@node-rs/argon2` 2.0.2. The catalog
pins that dependency because its N-API build loads on the supported Bun 1.3 and
Node.js 24 runtime lines and supplies binaries for the Linux, macOS, and Windows
platforms used by this project's CI. An application must verify that one of the
package's published native targets covers its deployment platform.

The current adapter writes Argon2id version 19 PHC strings with 19,456 KiB of
memory, two passes, one lane, a 32-byte output, and a fresh 16-byte salt. These
values are the current source configuration, not a compatibility promise. A
catalog release may raise them after runtime benchmarking. The copied source is
application-owned and is not updated automatically when the catalog package is
upgraded.

Password derivation consumes memory and CPU. The host must bound request bodies,
concurrent authentication work, and attempt rates. Authenticating does not
provide those controls.

## Injection contract

Pass dependencies when constructing the implementation:

```ts
const authenticating = new AuthenticatingMemoryConcept({
  passwordVerifier,
  freshSalt,
});
```

`freshSalt` must return a new, unpredictable salt for every call. A strategy must
satisfy these rules:

- `create` returns a one-way, versioned verifier and must not retain the password.
- `verify` accepts `credential: undefined`. In that case it must perform one
  password-verification workload against a configured dummy verifier and return
  `false`. This prevents an unknown username from taking a trivial no-KDF path.
- `verify` returns only whether the supplied password matches. It must fail closed
  for malformed or unsupported verifier records.
- `needsUpgrade` identifies a successfully checked verifier that `create` would
  replace with the current format or cost.
- The strategy must not log passwords, salts, verifier strings, or dummy inputs.

The shipped strategy follows these rules. Tests may inject a deterministic,
inexpensive strategy; such a test strategy is not suitable for credential
storage.

## Verifier upgrades

A replacement strategy must continue to verify every stored format until those
records have been migrated. Its `create` method writes only the new format, and
`needsUpgrade` returns `true` for an accepted old format. After a successful
`authenticate`, the implementation derives a fresh verifier and conditionally
replaces the exact salt and verifier that were checked. A concurrent password
change or unregister prevents that maintenance write from replacing newer
state. `changePassword` also writes the current format with a fresh salt.

Do not remove old-format verification until storage inspection shows that no old
records remain. If the new strategy cannot verify an old format, users need a
separate credential-reset procedure; Authenticating deliberately does not define
password recovery or reset.
