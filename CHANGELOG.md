# Changelog

## 0.2.0 — 2026-10-12

- Typed complete/empty/invalid measurement results and local `/tps [json]` diagnostics.
- Bounded turn state (10,000 steps, 32 model labels), immediate release on invalidity.
- Terminal/C1/bidi label validation, grapheme-safe truncation and correct singulars.
- Actual Pi SDK integration against controlled HTTP/SSE: waits, streaming, tools,
  reasoning, new turns, failure, truncation, agent retry and abort.
- Seeded generated aggregation tests, structured doctor and reproducible benchmark.
- Biome, contribution/agent/security guides, issue/PR templates and CODEOWNERS.
- SHA-pinned CI, CodeQL, scheduled upstream compatibility and Dependabot updates.
- Exact-tarball release preparation/publication with registry/download integrity receipts.
- GitHub and scoped npm distribution; original global extension remains untouched.

## 0.1.0 — 2026-10-12

- Package the author's original Pi TPS extension in TypeScript, with MIT license.
- Aggregate output tokens and per-request duration, using before_provider_request
  and agent_settled; output includes reasoning once and excludes tool gaps.
- Reject incomplete/ambiguous/invalid runs; reset on session navigation/shutdown.
- Add strict typechecking, deterministic tests and actual Pi package-loader checks.
- Publish an immutable GitHub release. No npm publication in this version.
