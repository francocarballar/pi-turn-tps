# Implementation provenance

The starting point was Franco Carballar's globally installed `turn-tps.ts` file.
Its SHA-256 before packaging on 2026-10-12 was:

```text
472ea5cefe35ecd612e02e06d6cfefdbeb969d69b57ed141c95adbbc0ba30ce1
```

That file was read, not modified or removed. The package preserves the aggregation
criterion and status key, with original refactoring and tests written for this repo.

The OpenCode v2.0.27 `turnTokensPerSecond` implementation was consulted to verify
the formula: sum output and reasoning across steps, then divide by summed measured
durations. Pi's reported output already includes reasoning. OpenCode source and
tests were not copied into this project.

The community project `sstehniy/pi-turn-tps` was identified in the handoff as a
separate implementation. Its code was not used, copied, installed, or substituted
for the author's extension. No priority/first-implementation claim is made.

Behavior changes from the original global file:

- Anchor time at `before_provider_request` instead of assistant `message_start`.
  Pi 1.1.0's OpenAI Responses adapter emits stream start after receiving HTTP
  response headers; the original boundary could exclude provider waiting.
- Require unambiguous sequential hook/message pairing. No fallback to the old
  boundary when hooks are missing, repeated or overlapping.
- Detect timestamp reuse throughout the run, not only while a message is pending.
- Reject missing usage, negative/unsafe token counts, clock rollback, errors,
  aborted settlement, missing model labels and control characters in labels.
- Reset on `session_start` (including new/resume/fork/reload), tree navigation and
  shutdown. Do not subscribe to nonexistent `session_switch`/`session_fork` events.

The hook-to-message-end interval still contains host overhead and provider-internal
retry/backoff after the hook. It is not the exact OpenCode timing source or pure
decode speed. See README for the supported correlation contract and limitations.

MIT was explicitly selected by the author before public distribution.
