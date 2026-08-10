# Contributor release procedure

This procedure is for maintainers publishing an approved v1 beta release
after its source changes are reviewed and merged. It does not define public
behavior; use the
[changelog](../../CHANGELOG.md), [support policy](../../SUPPORT.md), [security
policy](../../SECURITY.md), and [Execution semantics](../user/reference/semantics.md) for those
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
- Protect the `v1.0.0-beta.*` tag namespace against movement, deletion, and
  creation by unapproved actors.
- Keep the GitHub environment identity `npm`. Restrict it to the
  `v1.0.0-beta.*` tag policy, require an independent reviewer, and verify
  `prevent_self_review=true` and `can_admins_bypass=false`.
- Configure npm trusted publishing for `@mit-sdg/sync-engine`,
  `@mit-sdg/sync-engine-analysis`, `@mit-sdg/sync-engine-http`, and
  `@mit-sdg/sync-engine-catalog`. Each publisher uses GitHub organization
  `mit-sdg`, repository `sync-engine`, workflow `.github/workflows/publish.yml`,
  and environment `npm`. Verify every publisher identity before each release.
- Verify npm package and organization ownership, require 2FA for owners and
  maintainers, remove stale owners, and confirm recovery access is controlled.
  Beta publications use the `beta` dist-tag and must not create or move
  `latest`.

Record the independent checks in the release review. A green workflow does not
replace this external-setting verification.

## Prepare the release

### Source checkout

Work from a clean checkout of `origin/main` after all intended changes are
merged. Fetch tags, verify the release commit is on `origin/main`, and do not
publish from disconnected history. Every verified tarball must come from that
exact tagged commit.

### Registry version

Confirm the exact version is unused with the npm registry and confirm the
intended dist-tag. Beta versions have the form `1.0.0-beta.N`, with no leading
zero in `N`, and use `beta`. Never reuse an npm version or move an existing
release tag.

### Version surfaces

Treat the root `package.json` version, engines, TypeScript dependency, and
`packageManager` as canonical. Run these commands in order:

```sh
bun run release:update
bun install
```

`release:update` projects the canonical facts into every owned package
dependency location:

| Location                                     | Owned version fact                      |
| -------------------------------------------- | --------------------------------------- |
| `package.json`                               | Canonical version and publication tag   |
| `packages/*/package.json`                    | Workspace versions and dependencies     |
| `packages/catalog/entries/**/manifest.json`  | Shipped entry requirements              |
| `examples/*/package.json`                    | Shipped example dependencies            |
| `tests/packaging/application/package.json`   | Packed-application dependency           |
| `packages/*/tests/packaging/**/package.json` | Workspace consumer-fixture dependencies |

The following `bun install` regenerates `bun.lock` from the projected
manifests. Review the lockfile and manifest diffs together. `bun run release:check` rejects
stale projections; review and commit every updated manifest and `bun.lock`.
Publication uses that committed package metadata unchanged. Run frozen
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

Run `bun run release:check`. It validates v1 beta syntax and tag policy, every
owned version location, mandatory changelog sections and links, runtime and
toolchain ranges, shipped policies, reviewed workflow pins, and publication
workflow source facts.

### Generated artifacts

Regenerate declarations with `bun run declarations:pin` and example outputs
with `bun scripts/examples.ts pin`. Review every generated diff as a public
contract change. Generated assembly compatibility is governed by the manifest
format and package SemVer. The artifact policy accepts 1.x core generator
identities and projector provenance with a nonblank package name and any valid
SemVer version, including prereleases. Regeneration remains required so the
checked-in outputs and provenance reflect the release.

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
publication job.

Confirm regeneration leaves no unexplained diff and review the npm pack file
listing. `package:check` invokes npm's real pack lifecycle for each workspace;
the root package's `prepack` performs their shared build. The check inspects all
workspace tarballs and policy links, installs packages both independently and
together, exercises each workspace's packed consumer
contract, runs examples and scenarios, and verifies Node and Bun behavior
without workspace links. In the publish workflow, the check exports every npm
workspace tarball. The
unprivileged job records their digests and transfers them unchanged to the
protected publication jobs. The core package
intentionally includes all three complete, independently runnable teaching
examples; file-count, packed-size, and unpacked-size budgets prevent accidental
growth. Wait for **CI required** on the final `main`
commit, then repeat every external-setting check above.

## Tag and publish

Npm workspaces are published independently in registry build order. Package
manifests own their dependency contracts. The workflow never overwrites an npm
version or moves or reuses a release tag or tarball.

1. Set `VERSION` to the exact manifest version. Verify the commit is an ancestor
   of `origin/main`, then create and push one annotated `v$VERSION` tag. Never
   move or reuse a release tag.
2. Review the triggered **Publish beta** workflow. It accepts
   `v1.0.0-beta.N` tags only. Its unprivileged `verify` job checks exact tag
   equality, canonical beta version syntax, `origin/main`
   ancestry, release facts, all gates, and the audit. It has no environment and
   no OIDC permission.
3. Approve the protected `npm` environment only after `verify` succeeds and an
   independent reviewer has repeated the source and external-setting checks.
   The single publication job is the only job with the `npm` environment and
   `id-token: write`, so this is one approval for the complete package set. It
   checks out the same commit, refetches and verifies the live annotated tag and
   main ancestry, downloads the verified tarballs, checks every recorded digest,
   and binds each packed `package.json` name and version to the validated source
   manifest. It rejects an artifact directory that is not exactly the reviewed
   tarball/checksum set. It then publishes each npm workspace in catalog build
   order under `beta` with public access, stopping at the first failure. No publication
   step installs dependencies, runs Bun, packs, prepackages, or rebuilds a
   package.
4. Do not publish manually after a workflow failure until npm confirms the
   version was not accepted. The workflow does not create a GitHub release.
   After npm verification, manually create a GitHub prerelease from the same
   immutable tag using the changelog entry and exact comparison.

## Verify the registry

- Retire the unsupported alpha without moving `latest`:

  ```sh
  npm deprecate @mit-sdg/sync-engine@$PRERELEASE_VERSION "Unsupported; install @mit-sdg/sync-engine@$VERSION or use @beta."
  ```

  Review every older version that already has a deprecation message pointing to
  `@alpha` and replace that message with the same exact beta guidance. Do not
  deprecate a supported beta or use an unreviewed range. Published releases are
  immutable: never
  overwrite an existing tag or tarball.

- Confirm `npm view @mit-sdg/sync-engine dist-tags versions` shows the new exact
  version under `beta` and that `latest` did not move.
- Confirm `npm view @mit-sdg/sync-engine-analysis dist-tags versions` shows its
  new matching exact version under `beta` and that `latest` did not move.
- Confirm `npm view @mit-sdg/sync-engine-http dist-tags versions` shows its new
  matching exact version under `beta` and that `latest` did not move.
- Confirm `npm view @mit-sdg/sync-engine-catalog dist-tags versions` shows its
  new matching exact version under `beta` and that `latest` did not move.
- Confirm `npm view @mit-sdg/sync-engine versions deprecated --json` shows alpha
  versions as unsupported, with historical messages pointing at the exact beta
  or `@beta`, never `@alpha`.
- Check each npm package page for GitHub Actions provenance and verify tarball
  integrity, repository, license, executable, policy files, and file metadata.
- In clean directories, install every exact registry version with npm and Bun,
  exercise each package's documented public entrypoints or command, and
  typecheck with the supported TypeScript major.
- Run the core command help and setup flow, then run the generated application's
  generation, check, and start commands. Run each package-owned registry smoke
  test documented by its README. Leave `node_modules` unchanged while checking
  generated artifacts.
- Reconfirm the npm trusted publisher identity, ownership/2FA, GitHub
  environment controls, protected tag, and private vulnerability reporting
  after publication.

## Bad release response

Stop or reject the environment deployment if publication has not happened. If
npm accepted any package version, do not retag, overwrite, recreate, or
republish it. Mark any GitHub release and npm version as affected, deprecate the
exact version with a clear message, move `beta` back to the last known-good beta
when appropriate, and publish a new incremented beta
containing the fix and migration notes. If any earlier package succeeded but a
later package failed, do not rerun or manually replace the accepted package; use
new versions for the corrected release.
Use npm unpublish only when package owners agree it meets npm policy; prefer
deprecation because consumers may already depend on the immutable tarball. If
credentials or provenance may be compromised, disable the trusted publisher
and environment and involve repository and npm organization owners before
restoring release access.
