# Contributor release procedure

This procedure is for maintainers publishing an approved beta after its source
changes are reviewed and merged. It does not define public behavior; use the
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
  GitHub Actions pin updates, but both code owners must review the resolved SHA
  and upstream release before merge.
- Protect `main` with pull-request review and only the stable **CI required**
  status context. Do not require individual or matrix job names as branch
  protection contexts.
- Require CODEOWNERS review for workflow, release, support, and security-policy
  files. Apply the rule to administrators and require review of any bypass;
  disable unreviewed administrator or ruleset bypass where the plan permits.
- Protect the `v1.0.0-beta.*` tag namespace against movement, deletion, and
  creation by unapproved actors.
- Keep the GitHub environment identity `npm`. Restrict it to the
  `v1.0.0-beta.*` tag policy, require an independent reviewer, and verify
  `prevent_self_review=true` and `can_admins_bypass=false`.
- Configure npm trusted publishing for package `@mit-sdg/sync-engine`, GitHub
  organization `mit-sdg`, repository `sync-engine`, workflow
  `.github/workflows/publish.yml`, and environment `npm`. Verify the publisher
  identity before every release.
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
publish from disconnected history.

### Registry version

Confirm the exact version is unused with the npm registry and confirm the
intended dist-tag. Beta versions have the form `1.0.0-beta.N`, with no leading
zero in `N`, and use `beta`. Never reuse an npm version or move an existing
release tag.

### Version surfaces

Treat the root `package.json` version, engines, TypeScript dependency, and
`packageManager` as canonical. Run `bun run release:update` to project those facts
into every owned package dependency location:

| Location                                            | Owned version fact                        |
| --------------------------------------------------- | ----------------------------------------- |
| `package.json`                                      | Published version and `publishConfig.tag` |
| `examples/reading-circle/package.json`              | Shipped example dependency                |
| `examples/operations-room/package.json`             | Shipped example dependency                |
| `examples/production-http/package.json`             | Shipped example dependency                |
| `tests/package/application/package.json`            | Standalone packed-application dependency  |
| `tests/package/multi-instance/client/package.json`  | Packed generated-client dependency        |
| `tests/package/multi-instance/backend/package.json` | Independent backend dependency            |

The scaffold keeps placeholders and generation reads the canonical root facts.
`bun run release:check` rejects stale projections; review and commit every
updated manifest rather than rewriting package metadata during publication.

### Changelog

Add a dated changelog entry. Every release entry must contain the exact headings
`Compatibility`, `Migration`, `Generated formats`, and `Runtime and security
support`, writing `None` when a section has no items. Include an exact release
link for `v{{version}}` and an exact compare link from the immediately previous
version. Never edit a released entry except to restore it byte-faithfully from
its immutable tag.

### Source enforcement

Run `bun run release:check`. It validates beta syntax and tag policy, every
owned version location, mandatory changelog sections and links, runtime and
toolchain ranges, shipped policies, reviewed workflow pins, and publication
workflow source facts.

### Generated artifacts

Regenerate declarations with `bun run declarations:pin` and example outputs
with `bun scripts/examples.ts pin`. Review every generated diff as a public
contract change. Generated Markdown, wire, manifests, and dependency graphs are
coupled to the exact generator version; do not assume cross-version
compatibility from an unchanged format number.

## Final gates

Run the same verification as the publish workflow against the final release
commit:

```sh
bun install --frozen-lockfile
bun run check
bun run release:check
bun run test
bun run coverage
bun run build
bun run declarations:check
bun run examples:check
bun run scenario
bun run package:check
bun audit
```

Confirm regeneration leaves no unexplained diff and review the npm pack file
listing. `package:check` executes npm's real `prepack` lifecycle, inspects the
tarball and policy links, installs it with npm and Bun, exercises the generated
scaffold and examples, compiles a separate generated client/backend topology,
and runs a Node scenario. In the publish workflow it also exports that exact
verified tarball; the unprivileged job records its digest and transfers both to
the protected publication job. The package intentionally includes all three
complete, independently runnable teaching examples; file-count, packed-size,
and unpacked-size budgets prevent accidental growth. Wait for **CI required** on the final `main`
commit, then repeat every external-setting check above.

## Tag and publish

1. Set `VERSION` to the exact manifest version. Verify the commit is an ancestor
   of `origin/main`, create one annotated `v$VERSION` tag on that commit, and
   push only that tag. Never move or reuse a release tag.
2. Review the triggered **Publish beta** workflow. Its unprivileged `verify` job
   checks exact tag equality, no-leading-zero beta syntax, `origin/main`
   ancestry, release facts, all gates, and the audit. It has no environment and
   no OIDC permission.
3. Approve the protected `npm` environment only after `verify` succeeds and an
   independent reviewer has repeated the source and external-setting checks.
   The `publish` job is the only job with the `npm` environment and
   `id-token: write`; it checks out the same commit, refetches and verifies the
   live annotated tag and main ancestry, downloads the verified tarball, checks
   its recorded digest, then publishes that tarball with provenance under the
   `beta` tag. It does not install dependencies or rebuild the package.
4. Do not publish manually after a workflow failure until npm confirms the
   version was not accepted. The workflow does not create a GitHub release.
   After npm verification, manually create a GitHub prerelease from the same
   immutable tag using the changelog entry and exact comparison.

## Verify the registry

- Retire the unsupported alpha without moving `latest`:

  ```sh
  npm deprecate @mit-sdg/sync-engine@1.0.0-alpha.0 "Unsupported; install @mit-sdg/sync-engine@$VERSION or use @beta."
  ```

  Review every older version that already has a deprecation message pointing to
  `@alpha` and replace that message with the same exact beta guidance. Do not
  deprecate a supported stable line or use a range until the expanded version
  list has been reviewed.

- Confirm `npm view @mit-sdg/sync-engine dist-tags versions` shows the new exact
  version under `beta` and that `latest` did not move.
- Confirm `npm view @mit-sdg/sync-engine versions deprecated --json` shows alpha
  and every historical message pointing at the exact beta or `@beta`, never
  `@alpha`.
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
npm accepted the version, do not retag, overwrite, or recreate it. Mark the
GitHub prerelease and npm version as affected, deprecate the exact version with
a clear message, move `beta` back to the last known-good beta when appropriate,
and publish a new incremented beta containing the fix and migration notes. Use
npm unpublish only when package owners agree it meets npm policy; prefer
deprecation because consumers may already depend on the immutable tarball. If
credentials or provenance may be compromised, disable the trusted publisher
and environment and involve repository and npm organization owners before
restoring release access.
