# Release runbook

The maintainer publishes after required CI and review. This repo has a single npm
package. MIT sources load as TypeScript in Pi; there is no build/postinstall.

1. Update package.json and package-lock.json versions together, CHANGELOG and
   install examples. Never reuse a published version/tag.
2. Open a PR, run `npm run verify`, wait for all matrix jobs and CodeQL, merge into
   protected main. Minimum tested Pi and the current registry pair must be explicit.
3. Fetch origin, checkout the release commit with a clean worktree. Create/push
   `v<version>` on that commit. The commit must be an ancestor of origin/main.
4. Run `npm run release:prepare`. It re-runs verification and exports the exact
   checked tarball plus version/tag/commit/integrity receipt to ignored `.release/`.
5. For an initial package, `npm login`, then `npm run release:publish` with authorized
   credentials. Do not put tokens/passwords in issues, chat or tracked files. The
   command publishes the tarball, never an unchecked folder. It reconciles registry
   state before publish, and verifies version, integrity and downloaded bytes after.
6. Run `npm run release:verify` and `npm run check:published` for isolated npm/Git Pi consumer installs. Attach
   the checked tarball/receipts to the GitHub release and record consumer evidence.
   These are package publication checks, not a paid external-provider benchmark.

## Remote terminals and 2FA

For a remote terminal without a working browser opener, use:

```sh
npm run release:publish:manual
```

Run it in an interactive terminal (TTY). It passes `--browser=false` directly to
npm, which prints the authentication URL instead of launching a server browser.
Open the freshly generated URL in your browser and complete npm's challenge while
the terminal waits. This still requires browser authentication and account 2FA;
it does not bypass either. Never share credentials or one-time codes in chat.
If a URL returns 404, stop the attempt and check registry state before retrying;
old or failed challenge URLs must not be reused. The underlying npm service may
still require resolving the challenge from the maintainer's own terminal/session.

## Automated future releases

The Release workflow accepts a tag and `publish` (false by default). It requires a
protected `release` environment, re-runs the full 9-job verification matrix via
reusable CI on the requested tag, then prepares one exact archive and optionally
publishes it with npm OIDC/provenance. It retains receipts as Actions artifacts.
No static npm token is used by the workflow.

After initial publication, enable account 2FA (npm requires it for trust setup).
With npm >=11.15 and an authenticated maintainer session, configure the publisher:

```sh
npm trust github @francocarballar/pi-turn-tps --repo=francocarballar/pi-turn-tps --file=release.yaml --env=release --allow-publish --yes
npm trust list @francocarballar/pi-turn-tps --json
```

The equivalent website path is package **Settings → Trusted publishing**:
GitHub owner `francocarballar`, repository `pi-turn-tps`, workflow `release.yaml`,
environment `release`. This npm-side mapping is required; GitHub YAML alone does
not activate trust. Restrict package publishing/2FA in npm settings as appropriate
for the maintainer account. Do not claim provenance for the local bootstrap publish.

The workflow validates tag = manifest version, commit ancestry, clean tree and lock
version. Registry verification rejects a different artifact even at the same version.
If publish errors after possible dispatch, inspect registry/receipts before retry;
never bump or resend just to hide an unknown outcome. Immutable published tags cannot
be moved, force-pushed or deleted by the repo tag rule.

## Rollback

Install the preceding immutable tag/version explicitly. Do not overwrite packages.
Fix a faulty release with a new patch and explain its effect in the changelog.
