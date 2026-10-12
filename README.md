# Pi Turn TPS

Franco Carballar's Pi extension for **aggregated turn tokens per second**.
Shows a footer status after a complete Pi run:

```text
provider/model · 7.5 tok/s · 30 output tokens / 2 steps
```

## Install

Requires Pi's `@earendil-works/pi-coding-agent` host with `before_provider_request`
and `agent_settled`. Tested with **Pi 1.1.0**; older/future hosts are not assumed
compatible. Node must satisfy the host's requirements (1.1.0: >=22.19.0).

```sh
pi install npm:@francocarballar/pi-turn-tps@0.2.1
# Or pin the Git release:
pi install git:github.com/francocarballar/pi-turn-tps@v0.2.1
```

Restart Pi or run `/reload` in an interactive session. For updates, install a new
version tag explicitly: a pinned tag does not follow main. To follow main instead:

```sh
pi install git:github.com/francocarballar/pi-turn-tps
```

Remove with `pi remove git:github.com/francocarballar/pi-turn-tps@v0.2.1`.
For development, `pi install ./pi-turn-tps` uses the local package without copying.
Remove the npm installation with `pi remove npm:@francocarballar/pi-turn-tps@0.2.1`.

### Migrating the original global file

If you already have `~/.pi/agent/extensions/turn-tps.ts`, disable that resource
through `pi config` before loading this package, or move it to a backup directory
outside the extension discovery roots. Keep a backup. Then `/reload` or restart.
Two copies with the same status key can overwrite one another; other TPS extensions
can display additional indicators. Installing this package does not remove files
or change unrelated extensions automatically.

## What is measured?

```text
TPS = sum(assistant usage.output) / (sum(request duration in milliseconds) / 1000)
```

For example, 10 tokens in 1 second and 20 in 3 seconds yield **7.5 tok/s**,
not the arithmetic mean of the two step rates. Tool time and gaps between model
calls are excluded. Model changes are included in the same aggregate.
`usage.output` already includes reasoning in Pi; reasoning is not added again.

The turn boundary is `agent_settled`, not `agent_end`: automatic continuations,
retries, or recovery can run after `agent_end`. Output is updated only at settlement.
The previous completed status remains visible while the next run is in progress.

### Timing boundary and limits

Each interval starts when this extension receives `before_provider_request` and
ends when it receives the corresponding assistant `message_end`, using monotonic
`performance.now()`. Both request-before-message-start and message-start-before-request
event orderings are supported for one sequential assistant call.

This includes provider response waiting and generation, plus work **after our hook**:
later extension handlers, transport setup, provider-internal retries/backoff, and
Pi's delivery of the completed message. Work before that hook is excluded.
It is not pure model decode speed, TTFT, a provider-side benchmark, or end-to-end
wall-clock throughput. Cached/reasoning/tool-call output uses the host's reported
output count; the extension does not tokenize text itself.

Pi's hook has no request ID. An unmatched/extra hook or overlapping assistant call
invalidates the run rather than guessing a pairing. A custom provider that does
not invoke the hook produces no reading. This also means in-run unrelated provider
work can invalidate or complicate correlation; only sequential host calls with
one hook per assistant message are supported.

A reading is omitted and the status cleared for missing anchors/usage, duplicate
timestamps (including sequential reuse), invalid numbers, errors/aborts, dangling
calls, no steps, zero total output or zero total duration. An error step invalidates
the whole run even if a later retry succeeds. A finalized `length` response counts
when it has valid usage and timing; this measures produced tokens, not task success.
User/tool messages never contribute. Session navigation and shutdown reset state.

Status uses the stable key `turn-tps`, the provider/model (or number of distinct
models), one decimal TPS, total output tokens and completed assistant step count.
No UI means no status. The local `/tps` command reports the latest result; `/tps json`
returns schemaVersion 1 diagnostics (complete, empty or invalid). No model tools, network requests, prompt changes,
telemetry or persistent session entries are added by this extension.

## Development and verification

```sh
npm ci --ignore-scripts
npm run verify
```

Runtime code has no third-party imports except the erased host type import.
The host is a `peerDependency` with `*`, as Pi requires, and a pinned development
dependency for verification. It is not bundled or installed as a runtime dependency.
TypeScript sources are loaded by Pi; no build or postinstall hook is required.
Runtime, tests and verification scripts are all TypeScript. Strict typechecking
covers the entire codebase, with erasable syntax for direct Node test execution.

Tests cover weighted aggregation, tool gaps, hook ordering, reasoning counted once,
multiple models, retries/continuations, missing and invalid data, ambiguous calls,
session cleanup, headless execution and final status behavior. Package checks use
Pi's actual loader and install the packed artifact in an isolated directory.
CI runs on Linux, macOS and Windows with supported Node versions. SDK tests use
actual Pi sessions and loopback HTTP/SSE, including streaming, tool delay, retries,
truncation and cancellation. See [CONTRIBUTING](https://github.com/francocarballar/pi-turn-tps/blob/main/CONTRIBUTING.md)
for the full workflow, and [architecture](https://github.com/francocarballar/pi-turn-tps/blob/main/docs/ARCHITECTURE.md)
for correlation limits and resource budgets.

```sh
npm run doctor       # read-only JSON diagnosis
npm run test:unit
npm run test:integration
npm run benchmark    # reproducible bounded-state benchmark, JSON
npm run format
```

The meter caps turns at 10,000 steps and 32 distinct model labels. Invalid state
is released immediately. Model identifiers reject terminal/bidi controls and the
footer label is capped at 80 graphemes (not terminal columns). Invalid readings
remain hidden from the footer, with an explicit reason available via `/tps`.

Provider responses in the tests are synthetic. **No external model benchmark is
claimed.** The original global indicator had already been observed in Pi; that
does not validate this package's timing against every real provider.

## Provenance and distribution

This packages the author's existing `turn-tps.ts` extension. It is an original
implementation following the weighted aggregation criterion of
[OpenCode v2.0.27's turnTokensPerSecond](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/tui/src/routes/session/rows.ts).
OpenCode stores output and reasoning separately; Pi output includes reasoning.
The timing sources and run boundaries are host-specific, so rates are not promised
to be identical between the two hosts. No OpenCode or community TPS extension code
was copied. This project does not claim to be the first TPS extension for Pi.

Distribution supports **GitHub and npm**. The `pi-package` keyword makes a published
npm package eligible for the Pi package gallery; inclusion is controlled by its
indexer. There is no claim about its indexing delay or number of users.

References: [Pi packages](https://pi.dev/docs/latest/packages),
[Pi extensions](https://pi.dev/docs/latest/extensions).

## License

MIT, copyright Franco Carballar. See [LICENSE](LICENSE).
