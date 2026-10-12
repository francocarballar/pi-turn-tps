# Agent contribution guide

This repository owns the original TypeScript Pi TPS extension. Do not replace it
with another project or copy third-party code without license/attribution review.

## Commands

- Install: `npm ci --ignore-scripts`
- Full verification: `npm run verify`
- Unit: `npm run test:unit`; transport integration: `npm run test:integration`
- Format: `npm run format`; local diagnosis: `npm run doctor`
- Bounded state benchmark: `npm run benchmark` (JSON)
- Release: follow `docs/RELEASING.md`; publication needs explicit user authorization.

Read CONTRIBUTING.md and docs/ARCHITECTURE.md before changing behavior. Keep runtime,
tests and scripts in TypeScript. Strict types, erasable syntax, no generated runtime
JS and no postinstall hooks. The host peer range remains `*` per Pi's packaging
contract; tested compatibility is separately documented and exercised.

The meter uses output tokens inclusive of reasoning and SUM(tokens)/SUM(durations),
not an average of step rates. Tool gaps are excluded. Error/abort/ambiguous/missing
calls invalidate the whole run. State and formatting must remain bounded. Never
fallback from missing request anchors to message_start timing.

Tests use the real host SDK and a local HTTP fixture; do not use external credentials
or alter global Pi settings/installed files. No external-provider result may be
claimed without an actual recorded run. `/tps json` has schemaVersion 1 with
complete/empty/invalid results; preserve its contract and privacy allowlist.

For text searches use `tgrep` when available, otherwise native tooling in the
consumer environment. Follow parent workspace instructions. Do not edit another
project, overwrite dirty work, expose secrets or publish without authorization.
