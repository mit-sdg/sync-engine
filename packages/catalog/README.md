# @mit-sdg/catalog

`@mit-sdg/catalog` copies curated concepts, computations, and composition
recipes into a sync-engine application. It does not copy an application shell,
assembly, gateway, artifact configuration, or runnable scenario. Complete
runnable configurations live under [`examples/`](../../examples/README.md).

The package exposes the `catalog` executable and no JavaScript import surface.
Copied source belongs to the receiving application and has no runtime dependency
on the catalog package.

## Install the Account Center recipe

Start in a Bun and TypeScript package that declares the exact matching core
beta. The Account Center recipe uses Profiling, Preferring, and Notifying;
Profiling has more than one implementation, so this installation selects its
process-local `memory` variant explicitly.

```sh
mkdir account-center
cd account-center
bun init -y
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8
bun add --dev "typescript@>=6 <7"
bunx --package @mit-sdg/catalog@beta catalog init recipe/account-center --variant concept/profiling=memory
```

`init` writes `catalog.lock`, copies the recipe and its three concept
dependencies, and creates three generated integration files. It does not create
`src/concept-set.ts`, `src/assembly.ts`, `generated.config.ts`, or another
application shell file.

The default destinations are:

| Content or reference              | Default path                             | Created by `init` |
| --------------------------------- | ---------------------------------------- | ----------------- |
| Concept source                    | `src/concepts/`                          | As needed         |
| Computation source                | `src/computations/`                      | As needed         |
| Recipe source                     | `src/composition/`                       | As needed         |
| Application concept-set reference | `src/concept-set.ts`                     | No                |
| Markdown import declaration       | `src/catalog/text.generated.d.ts`        | Yes               |
| Registrations and computations    | `src/catalog/registrations.generated.ts` | Yes               |
| Recipe composition                | `src/catalog/composition.generated.ts`   | Yes               |

The configured concept-set path is an import target used while rendering copied
recipes. It is a reference to an application-owned file, not a catalog output.
All three source roots, the concept-set reference, and all three generated-file
paths can be changed only during `catalog init`. Later commands read the paths
from `catalog.lock`.

### Add the concept set

Create `src/concept-set.ts` from the generated records:

```ts
import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { catalogComputations, catalogRegistrations } from "./catalog/registrations.generated.ts";

export const applicationConcepts = conceptSet(catalogRegistrations, catalogComputations);

export const { concepts, vocabulary } = applicationConcepts;
```

An existing application merges its own records explicitly:

```ts
conceptSet(
  { ...applicationRegistrations, ...catalogRegistrations },
  { ...applicationComputations, ...catalogComputations },
);
```

Those names must be disjoint. JavaScript object spread silently replaces an
earlier property with a later property; the catalog cannot detect a collision
with records defined outside `catalog.lock`. The installer does reject two
tracked catalog entries that register the same concept or computation name.

### Add the recipe to the assembly

Spread the generated recipe members into the application's composition record:

```ts
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { catalogComposition } from "./catalog/composition.generated.ts";
import { applicationConcepts, vocabulary } from "./concept-set.ts";

export function assembleApplication() {
  return assemble({
    vocabulary,
    instances: applicationConcepts.implementations(),
    composition: catalogComposition,
  });
}
```

An existing application instead uses
`composition: { ...applicationComposition, ...catalogComposition }`.
Composition member names must be disjoint. The installer rejects duplicate
member names among tracked recipes, but it cannot inspect the application-owned
record.

`catalogComposition` uses named imports for only the members listed in each
recipe manifest. Other exports from a copied recipe remain directly importable
from that recipe module, but they are not placed in the assembled composition.
For example, `browserSessionHttpPolicy` is imported from
`src/composition/browser-session.ts`; it is not a composition member.

The self-contained [Account Center example](../../examples/account-center/README.md)
contains an assembly, gateway, generated artifacts, tests, and an asserting
scenario. It also documents the recipe's identity, persistence, delivery, and
runtime-validation boundaries.

The copied Account Center endpoints validate shapes but do not authenticate
`principal` or authorize `profile`. Its notification delivery route is a trusted
service operation, not external message delivery. The selected memory variants
lose profiles, preferences, and notifications on restart.

## Install the Browser Session recipe

The Browser Session recipe composes Authenticating, Profiling, and Sessioning.
For beta.8, a direct installation requires these declarations:

- `@mit-sdg/sync-engine` exactly `1.0.0-beta.8`;
- `@mit-sdg/sync-engine-http` exactly `1.0.0-beta.8`;
- `@types/node` with the literal range `^24.0.0` for the memory variants;
- TypeScript `>=6 <7` for supported type checking.

In a new package, install the requirements and recipe directly:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8 @mit-sdg/sync-engine-http@1.0.0-beta.8
bun add --dev "@types/node@^24.0.0" "typescript@>=6 <7"
bunx --package @mit-sdg/catalog@beta catalog init recipe/browser-session --variant concept/profiling=memory
```

Authenticating and Sessioning each have one `memory` variant and select it
automatically. Profiling still requires the explicit selection. In a project
already initialized with the Account Center command above, use `catalog add
recipe/browser-session`; the tracked Profiling selection is retained.

The generated composition adds six endpoint declarations:

| Member           | Route                  | Effect                                                                |
| ---------------- | ---------------------- | --------------------------------------------------------------------- |
| `Register`       | `/auth/register`       | Register credentials, create or resume a profile, and start a session |
| `SignIn`         | `/auth/sign-in`        | Verify credentials, require a profile, and start a session            |
| `CurrentSession` | `/auth/session`        | Resolve the current session and profile                               |
| `RotateSession`  | `/auth/session/rotate` | Replace the current session credential                                |
| `SignOut`        | `/auth/sign-out`       | End the current session                                               |
| `SignOutAll`     | `/auth/sign-out-all`   | End all sessions for the resolved principal                           |

### Use the HTTP policy helper

Import the helper directly from the copied recipe and pass its result as the
unified `policy` used by the handler:

```ts
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/server";
import { assembleApplication } from "./assembly.ts";
import { browserSessionHttpPolicy } from "./composition/browser-session.ts";

const origin = "https://accounts.example";
const policy = browserSessionHttpPolicy({ origin });
const application = assembleApplication();
const gateway = createGateway({ application });

export const handler = createHttpHandler({ application, gateway, policy });
```

The helper fixes the protected input field to `session`. It issues the cookie on
registration, sign-in, and rotation; hides `session` and `expiresAt` from those
HTTP responses; and clears the cookie on both sign-out routes. With the HTTPS
origin above, defaults produce a `__Host-session` cookie with `Secure`,
`HttpOnly`, `SameSite=Strict`, and `Path=/`.

The default public errors map malformed registration values to
`INVALID_REQUEST`, duplicate credentials or profiles to `CONFLICT`, and invalid
credentials, missing profiles, or unknown sessions to `UNAUTHORIZED`. Supplied
`publicErrors` replace individual defaults or add application codes.

By default, every request handled under this cookie policy must contain an
`Origin` header exactly equal to the policy origin. This check does not implement
CORS and the handler does not answer preflight requests or emit CORS headers.
The helper accepts a nonempty cookie `origins` allowlist for a separate frontend
origin, but deliberately does not expose the lower-level `origins: false`
opt-out.

Cookie name, `SameSite`, path, parent domain, allowed origins, API base path, and
public-error mappings are customizable without changing the recipe's protected
field or issue and clear routes:

```ts
const policy = browserSessionHttpPolicy({
  origin: "https://api.example.com",
  basePath: "/api",
  cookie: {
    name: "browser_session",
    sameSite: "None",
    path: "/api",
    domain: "example.com",
    origins: ["https://app.example.com"],
  },
});
```

`SameSite=None` requires HTTPS. A domain or non-root path changes the secure
prefix from `__Host-` to `__Secure-`. See the [HTTP policy
contract](../http/public-surface.md) for validation, Origin, cookie, response,
and host behavior.

### Security and recovery limits

This recipe is not a complete production authentication system.

- The supplied Authenticating, Profiling, and Sessioning implementations keep
  state in one process. Restart loses credentials, profiles, and sessions, and
  separate processes do not share or serialize that state.
- Credential registration, profile creation, and session creation are separate
  owner actions, not one transaction. Repeating the same registration can resume
  after an interruption. A session issued before response loss can remain active
  until expiry or later revocation.
- Rotation invalidates the old session before the response is delivered. If the
  response is lost, sign-in is the recovery path to obtain another session.
- The recipe provides no rate limiting, account lockout, credential recovery,
  email verification, multi-factor authentication, or credential-change
  endpoint. Hosts must also supply traffic and denial-of-service controls.
- A valid session establishes only its opaque principal and profile. It does not
  authorize access to application resources or operations. Resource owners and
  trusted adapters must enforce that policy.

The [Production HTTP example](../../examples/production-http/README.md) shows the
same `HttpPolicy` value used by a handler and generated HTTP wire, with runtime
validation, limits, correlation, and host responsibilities. It is transport
evidence, not a complete authentication deployment.

## Discover and add entries

```sh
bunx --package @mit-sdg/catalog@beta catalog list
bunx --package @mit-sdg/catalog@beta catalog show recipe/browser-session
bunx --package @mit-sdg/catalog@beta catalog add concept/profiling --variant concept/profiling=repository
```

The current package contains five concepts and two recipes. It contains no
computation entry, although computations remain a supported entry kind.

## Copy ownership and collisions

Copied concepts, computations, recipes, specifications, and tests are
application-owned immediately. Catalog commands do not update, merge,
overwrite, or delete them. A destination collision aborts the operation before
any planned file is retained. For one explicitly requested recipe, `--file
alternative.ts` renames its module and paired test when their default names
collide.

`catalog.lock` records dependency edges, package requirements, selected
variants, copied destinations, source provenance, and original content hashes.
Commit it. The lock and the three generated integration files remain
catalog-managed; `add` and `forget` refuse to continue if a managed file was
edited or removed.

```sh
bunx --package @mit-sdg/catalog@beta catalog diff
bunx --package @mit-sdg/catalog@beta catalog forget recipe/account-center
```

`diff` compares application-owned files with the catalog package currently
being invoked and never writes. `forget` removes tracking and generated imports
but leaves copied files and package dependencies in place.

The [catalog public surface](public-surface.md) is the exact command, manifest,
path, lock, generated-file, package-check, and failure contract. Entry authors
use the package-local [contribution guide](CONTRIBUTING.md).
