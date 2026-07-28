# Contributor release procedure

This checklist owns repository release mechanics. It does not redefine public
behavior; use the [changelog](../CHANGELOG.md) for compatibility notes and
[execution semantics](./semantics.md) for operational guarantees and limits.

## One-time repository settings

Maintainers must configure these outside the repository before publishing. The
workflow cannot create or enforce them.

- Make `main` the default and approved release branch, and require pull-request
  review and the final CI checks before changes reach it.
- Protect the `v*` tag namespace with a GitHub ruleset so only release
  maintainers can create tags and tags cannot be moved or deleted casually.
- Create a GitHub environment named `npm`. Restrict it to protected release
  tags, add required reviewers, and prevent self-review where the plan allows.
- Configure npm trusted publishing for package `@mit-sdg/sync-engine`, GitHub
  organization `mit-sdg`, repository `sync-engine`, workflow
  `.github/workflows/publish.yml`, and environment `npm`. While only prereleases
  are supported, leave `latest` unset and publish alphas through the `alpha`
  dist-tag. The first stable release establishes `latest`.

Recheck branch, tag, environment, npm trusted-publisher, and repository security
settings before each release. They are external state and are not established
by a reviewed workflow change.

## Prepare the release

1. Work from a clean checkout of `origin/main` after the intended release
   changes are merged. Fetch tags and verify the release commit is on
   `origin/main`; do not publish from a disconnected release history.
2. Confirm the version is unused on npm and select the intended dist-tag. Alpha
   versions have the form `1.0.0-alpha.N` and use `alpha`.
3. Treat the root `package.json` version as canonical. Copy that exact version
   into the package dependency in each other owned location:

| Location                                 | Ownership                                         |
| ---------------------------------------- | ------------------------------------------------- |
| `package.json`                           | Published package version and `publishConfig.tag` |
| `examples/reading-circle/package.json`   | Shipped example dependency                        |
| `examples/operations-room/package.json`  | Shipped example dependency                        |
| `tests/package/application/package.json` | Standalone package fixture dependency             |

The scaffold reads the root manifest at generation time, so its template keeps
`{{version}}` and is not edited for a release. `bun run package:check` rejects
version disagreement in the examples, fixture, and generated scaffold.

4. Add the dated changelog entry, migration notes where needed, and release and
   compare links. Keep release-specific public semantics in the changelog or
   semantics document rather than copying them here.
5. Regenerate declarations with `bun run declarations:pin` and example outputs
   with `bun scripts/examples.ts pin`. Review every generated diff, then run
   `bun run declarations:check` and `bun run examples:check`.

## Final gates

Run the same gates the publish workflow runs, against the final release commit:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run coverage
bun run declarations:check
bun run examples:check
bun run scenario
bun run package:check
bun audit
```

Confirm regeneration leaves no unexplained diff. Wait for every required CI job
on the final `main` commit. `package:check` runs npm's real `prepack` lifecycle,
inspects that tarball, installs it with npm and Bun, and exercises the generated
scaffold and a compiled Node scenario. Review its npm pack listing before
approving the release; `npm publish` recreates the artifact through the same npm
packing machinery.

## Tag and publish

1. Set `VERSION` to the exact manifest version. Verify `HEAD` is an ancestor of
   `origin/main`, create annotated tag `v$VERSION` on that commit, and push only
   the tag. Never move or reuse a release tag.
2. Review the triggered **Publish alpha** run. The job checks the tag/version,
   full-history ancestry against `origin/main`, and all final gates. An
   authorized reviewer must approve its protected `npm` environment before npm
   receives an OIDC token.
3. The workflow publishes with public access, the `alpha` dist-tag, and npm
   provenance. Do not publish the same version manually after a workflow
   failure; determine whether npm accepted it first.
4. Publish a GitHub prerelease from the same tag with the changelog migration
   notes and links to the exact npm version and comparison.

## Verify the registry

- Confirm `npm view @mit-sdg/sync-engine dist-tags versions` shows the new exact
  version under `alpha`. While the project has no stable release, confirm
  `latest` is absent; after the first stable release, confirm it remains on the
  intended stable version.
- Check the npm package page for the GitHub Actions provenance attestation and
  verify the tarball integrity and repository, license, executable, and file
  metadata.
- In clean directories, install the exact registry version with npm and Bun,
  import every public subpath on supported Node versions, and run the documented
  `bunx --package @mit-sdg/sync-engine@$VERSION sync-engine --help` command.
- Scaffold a project from that exact registry version and run its check,
  generation, principle, and scenario commands. Verify an artifact check from a
  copied, application-owned example rather than writing into `node_modules`.

## Bad release response

Stop or reject the environment deployment if publication has not happened. If
npm already has the version, do not retag or overwrite it: mark the GitHub
prerelease and npm version as affected, deprecate the exact version with a clear
message, move `alpha` back to the last known-good version when appropriate, and
publish a new incremented alpha containing the fix. Use npm unpublish only when
the package owners agree it meets npm policy; prefer deprecation because users
may already depend on the tarball. If credentials or publishing provenance may
be compromised, disable the trusted publisher/environment and involve the
repository and npm organization owners before restoring release access.
