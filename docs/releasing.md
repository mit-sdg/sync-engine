# Contributor release procedure

This procedure is for maintainers publishing an approved stable v1 release
after its source changes are reviewed and merged. It does not define public
behavior; use the
[changelog](../CHANGELOG.md), [support policy](../SUPPORT.md), [security
policy](../SECURITY.md), and [Execution semantics](./semantics.md) for those
contracts. Published versions, tags, and tarballs are immutable.

## External settings

Every item in this section is external repository, GitHub organization, GitHub
environment, or npm state. Source changes and workflows do not establish or
prove these settings. Maintainers must configure them manually and recheck them
before every tag:

- Enable GitHub private vulnerability reporting. Security reports must follow
  `SECURITY.md`, not public issues.
- Require full-SHA pinning for third-party GitHub Actions. Dependabot may propose
  GitHub Actions pin updates, but two reviewers, including a code owner, must
  review the resolved SHA and upstream release before merge.
- Protect `main` with pull-request review and only the stable **CI required**
  status context. Require two approving reviews, CODEOWNERS review, dismissal of
  stale approvals, approval after the last push, and administrator enforcement.
  Do not require individual or matrix job names as branch protection contexts.
- Require CODEOWNERS review for workflow, release, support, and security-policy
  files. Apply the rule to administrators and require review of any bypass;
  disable unreviewed administrator or ruleset bypass where the plan permits.
- Protect the stable `v1.x.y` tag namespace against movement, deletion, and
  creation by unapproved actors.
- Keep the GitHub environment identity `npm`. Restrict it to the
  stable `v1.x.y` tag policy, require an independent reviewer, and verify
  `prevent_self_review=true` and `can_admins_bypass=false`.
- Configure npm trusted publishing for packages `@mit-sdg/sync-engine` and
  `@mit-sdg/sync-engine-http`, GitHub organization `mit-sdg`, repository
  `sync-engine`, workflow `.github/workflows/publish.yml`, and environment
  `npm`. Verify each publisher identity before every release.
- Verify npm package and organization ownership, require 2FA for owners and
  maintainers, remove stale owners, and confirm recovery access is controlled.
  Stable publications use the `latest` dist-tag.

Record the independent checks in the release review. A green workflow does not
replace this external-setting verification.

## Prepare the release

### Source checkout

Work from a clean checkout of `origin/main` after all intended changes are
merged. Fetch tags, verify the release commit is on `origin/main`, and do not
publish from disconnected history.

### Registry version

Confirm the exact version is unused with the npm registry and confirm the
intended dist-tag. Stable versions have the canonical form `1.x.y` and use
`latest`. Never reuse an npm version or move an existing release tag.

### Version surfaces

Treat the root `package.json` version, engines, TypeScript dependency, and
`packageManager` as canonical. Run these commands in order:

```sh
bun run release:update
bun install
```

`release:update` projects the canonical facts into every owned package
dependency location:

| Location                                            | Owned version fact                            |
| --------------------------------------------------- | --------------------------------------------- |
| `package.json`                                      | Published version and `publishConfig.tag`     |
| `packages/http/package.json`                        | HTTP package version and compatible core peer |
| `examples/reading-circle/package.json`              | Shipped example dependency                    |
| `examples/operations-room/package.json`             | Shipped example dependency                    |
| `examples/production-http/package.json`             | Shipped example dependency                    |
| `tests/package/application/package.json`            | Standalone packed-application dependency      |
| `tests/package/multi-instance/client/package.json`  | Packed generated-client dependency            |
| `tests/package/multi-instance/backend/package.json` | Independent backend dependency                |

The scaffold keeps placeholders and generation reads the canonical root facts.
The following `bun install` regenerates `bun.lock` from the projected manifests.
Review the lockfile and manifest diffs together. `bun run release:check` rejects
stale projections; review and commit every updated manifest and `bun.lock`
rather than rewriting package metadata during publication. Run frozen
verification only after the lockfile is current; `bun run release:verify` begins
with `bun install --frozen-lockfile`.

### Changelog

Add a dated changelog entry. Every release entry must contain the exact headings
`Compatibility`, `Migration`, `Generated formats`, and `Runtime and security
support`, writing `None` when a section has no items. Include an exact release
link for `v{{version}}` and an exact compare link from the immediately previous
version. Never edit a released entry except to restore it byte-faithfully from
its immutable tag.

### Source enforcement

Run `bun run release:check`. It validates stable v1 syntax and tag policy, every
owned version location, mandatory changelog sections and links, runtime and
toolchain ranges, shipped policies, reviewed workflow pins, and publication
workflow source facts.

### Generated artifacts

Regenerate declarations with `bun run declarations:pin` and example outputs
with `bun scripts/examples.ts pin`. Review every generated diff as a public
contract change. Generated assembly compatibility is governed by the manifest
format and stable package SemVer. The artifact policy accepts stable 1.x core
generator identities and projector provenance with a nonblank package name and
any valid stable SemVer version. Projector versions are not restricted to 1.x;
prerelease generator and projector versions are rejected. Regeneration remains
required so the checked-in outputs and provenance reflect the release.

## Final gates

Run the same verification as the publish workflow against the final release
commit:

```sh
bun run release:verify
```

`release:verify` runs the listed publish gates sequentially in a shell-independent
Bun script and stops at the first failure. `declarations:check` performs the
shared build; the release-only scenario gate reuses it, while the public
`bun run scenario` command remains self-contained. The publish workflow keeps
the gates as separate steps so GitHub identifies the failing gate and so
`package:check` can receive the verified-tarball output directory used by the
publication jobs.

Confirm regeneration leaves no unexplained diff and review the npm pack file
listing. `package:check` invokes npm's real pack lifecycle for each workspace;
the root package's `prepack` performs their shared build. The check inspects both
tarballs and policy links, installs core alone and both packages together,
exercises the generated scaffold and examples, compiles a separate generated
client/backend topology, and runs a Node scenario. In the publish workflow it
exports both exact verified tarballs; the unprivileged job records their digests
and transfers them to the protected publication job. The core package
intentionally includes all three complete, independently runnable teaching
examples; file-count, packed-size, and unpacked-size budgets prevent accidental
growth. Wait for **CI required** on the final `main`
commit, then repeat every external-setting check above.

## Tag and publish

Core and HTTP are independently published. Each release publishes core first and
publishes HTTP only after core succeeds. HTTP declares the compatible core peer
range projected from the release version.
The workflow never overwrites an npm version or moves or reuses a release tag or
tarball.

1. Set `VERSION` to the exact manifest version. Verify the commit is an ancestor
   of `origin/main`, then create and push one annotated `v$VERSION` tag. Never
   move or reuse a release tag.
2. Review the triggered **Publish stable** workflow. It accepts stable `v1.x.y`
   tags only. Its unprivileged `verify` job checks exact tag equality, canonical
   stable version syntax, `origin/main`
   ancestry, release facts, all gates, and the audit. It has no environment and
   no OIDC permission.
3. Approve the protected `npm` environment only after `verify` succeeds and an
   independent reviewer has repeated the source and external-setting checks.
   The two publication jobs are the only jobs with the `npm` environment and
   `id-token: write`. Each checks out the same commit, refetches and verifies the
   live annotated tag and main ancestry, downloads the verified tarballs, and
   checks their recorded digests. The core job publishes under `latest`; the
   HTTP job runs only after core succeeds and also publishes under `latest`.
   Neither job installs dependencies or rebuilds a package.
4. Do not publish manually after a workflow failure until npm confirms the
   version was not accepted. The workflow does not create a GitHub release.
   After npm verification, manually create a GitHub release from the same
   immutable tag using the changelog entry and exact comparison.

## Verify the registry

- Retire each unsupported prerelease with guidance to the exact stable release or
  `latest`:

  ```sh
  npm deprecate @mit-sdg/sync-engine@$PRERELEASE_VERSION "Unsupported; install @mit-sdg/sync-engine@$VERSION or use @latest."
  ```

  Review every older version that already has a deprecation message pointing to
  `@alpha` or `@beta` and replace that message with the same exact stable/latest
  guidance. Expand and review the registry version list, then deprecate every
  exact core and HTTP prerelease version with guidance to `$VERSION` or
  `@latest`; prerelease support ended when the stable release was published. Do not
  deprecate a supported stable line or use an unreviewed range. Published
  releases are immutable: never
  overwrite an existing tag or tarball.

- Confirm `npm view @mit-sdg/sync-engine dist-tags versions` shows the new exact
  version under `latest`.
- Confirm `npm view @mit-sdg/sync-engine-http dist-tags versions` shows its new
  exact independently published version under `latest`.
- Confirm `npm view @mit-sdg/sync-engine versions deprecated --json` and the
  corresponding HTTP query show alpha and beta versions as unsupported, with
  every historical message pointing at the current stable release or `@latest`.
- Check the npm package page for GitHub Actions provenance and verify tarball
  integrity, repository, license, executable, policy files, and file metadata.
- In clean directories, install the exact registry version with npm and Bun,
  import every public subpath under the supported Node major, and typecheck with
  the supported TypeScript major.
- Run `bunx --package @mit-sdg/sync-engine@$VERSION sync-engine --help` and
  scaffold a project from that exact version. Run its generation, check,
  principle, and scenario commands. Check artifacts from an application-owned
  copy rather than writing inside `node_modules`.
- Reconfirm the npm trusted publisher identity, ownership/2FA, GitHub
  environment controls, protected tag, and private vulnerability reporting
  after publication.

## Bad release response

Stop or reject the environment deployment if publication has not happened. If
npm accepted either package version, do not retag, overwrite, recreate, or
republish it. Mark any GitHub release and npm version as affected, deprecate the
exact version with a clear message, and publish a new incremented stable version
containing the fix and migration notes. If core succeeded but HTTP failed, do
not rerun or manually replace core; use new versions for the corrected release.
Use npm unpublish only when package owners agree it meets npm policy; prefer
deprecation because consumers may already depend on the immutable tarball. If
credentials or provenance may be compromised, disable the trusted publisher
and environment and involve repository and npm organization owners before
restoring release access.
