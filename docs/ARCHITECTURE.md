# Architecture and compatibility contract

One meter per loaded extension, one aggregate until `agent_settled`. Repeated
`agent_start` preserves it across automatic retry/continuation. Session navigation,
reload and shutdown reset it. The original status key is `turn-tps`.

`before_provider_request` observes the monotonic anchor. Depending on provider,
assistant `message_start` can precede or follow it. Exactly one pending call and
one hook per message are supported. Timestamps identify assistant messages; they
are not provider request IDs. The host has no request-correlation ID in this hook.
An extra or repeated anchor, overlap or reused timestamp invalidates the run.
Unrelated in-run provider work may be indistinguishable from a legitimate hook;
there is no claim of universal pairing across arbitrary extensions/providers.

The interval ends in assistant `message_end`. Duration includes later handlers,
transport, waiting, streaming, internal provider retries and host event delivery.
Tools and gaps between model calls are excluded. Agent-level failed responses
invalidate the entire run, even after successful retry; an internal transport
retry within one successful response remains part of its duration.

The core accepts unknown event data defensively and returns:

```ts
type MeasurementResult =
  | { kind: 'complete'; reading: TurnReading }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: InvalidReason };
```

`/tps json` adds `schemaVersion: 1`. Complete readings include outputTokens,
requestDurationMs, steps, models and tokensPerSecond. Empty means no positive
completed output, including no steps. Invalid reasons are a closed allowlist in
`src/metrics.ts`; no raw error/payload enters diagnostics. No UI means no output.
The previous result remains available while a new turn is in progress.

## Resource bounds

- At most 10,000 completed/started assistant steps per turn.
- At most 32 distinct provider/model labels.
- Each provider/model field at most 512 UTF-16 code units.
- One pending message and one unmatched request anchor.
- On invalidation, retained timestamps/models/anchors are released immediately;
  further events are constant work and do not accumulate identifiers.
- Footer model label at most 80 graphemes, preserving emoji/combining sequences.
  This is a text budget, not a promise about terminal column width.
- C0/C1, bidi controls and line separators are rejected in labels.

These bounds limit this extension's state; they do not limit Pi's own transcript or
provider SDK allocations. Hitting a limit produces an explicit invalid diagnostic.

## Compatibility

Minimum verified host: Pi 1.1.0. Current verified host: Pi 1.1.0. The peer remains
`*` per Pi package docs, not as a universal compatibility claim. CI covers Linux,
macOS, Windows and Node 22.19, 24, 26. A scheduled job tests npm's current host and
Pi AI pair; passing results can extend compatibility after maintainer review.

Unit tests inject a clock; generated tests exercise 100 reproducible turns. SDK
tests load the actual .ts extension, create an actual Pi session, use its OpenAI
compatible transport against loopback HTTP/SSE, and cover wait/stream, tool time,
reasoning usage, next turn, queued continuation, failure, truncation, agent and
provider-internal retry, and abort. No fake events are
injected into the SDK tests. Package checks separately validate exact contents,
no runtime dependencies, actual host loading and isolated Pi installation.
