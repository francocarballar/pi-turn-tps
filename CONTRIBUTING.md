# Contributing

## One command to verify a change

Use Node >=22.19 and npm. Linux, macOS and Windows are supported.

```sh
npm ci --ignore-scripts
npm run doctor
npm run verify
```

`verify` runs Biome, strict TypeScript, unit/generated tests, real Pi SDK loopback
HTTP/SSE integration, and a packed consumer/Pi installation check. No API key is
needed. Tests never contact a model provider or read your Pi credentials. Registry
access is needed for dependency installation. All consumer settings use temporary
directories, including paths with spaces and Unicode.

## Fast feedback

```sh
npm run test:unit
npm run test:integration
npm run test:coverage
npm run format
npm run benchmark
```

The benchmark emits JSON with environment and timings. Compare repeated runs on
the same machine; heap delta includes GC noise. Do not treat it as a provider
benchmark or a cross-machine performance promise.

## Change boundaries

- `src/metrics.ts`: bounded, deterministic state machine; no Pi/UI/filesystem imports.
- `extensions/turn-tps.ts`: event adapter and `/tps [json]`; no prompt changes.
- `test/sdk.test.ts`: actual Pi session/transport integration against localhost.
- `scripts/check-package.ts`: exact artifact allowlist and isolated consumer install.
- `scripts/release.ts`: release checks and registry integrity reconciliation.
- `scripts/check-published.ts`: isolated Pi installs from the public npm/Git versions.

Fixes need a regression test. Preserve the weighted formula and inclusive reasoning
count. Keep invalidity sticky until settlement. Changes to events or result schema
need compatibility tests and documentation. Use additive changes for schema v1;
breaking changes require a new schema version. Do not make test fixtures look like
measured external provider results.

## Pull requests

Open a focused PR with the problem, approach, verification commands and results.
Use `npm run format` before committing. Do not include secrets, session transcripts,
auth files or unrelated edits. CI must pass; the maintainer merges. One maintainer
currently reviews issues and PRs on a best-effort basis, with no guaranteed response
SLA. Discussions are for usage/design; issues for reproducible bugs and proposals.

## Releases

See [the release runbook](docs/RELEASING.md). Versioning is SemVer, currently 0.x:
minor releases may change APIs; patch releases preserve documented behavior. MIT
contributions remain under MIT. No contributor license agreement is required.
