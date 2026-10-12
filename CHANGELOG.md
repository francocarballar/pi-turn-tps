# Changelog

## 0.1.0 — 2026-10-12

- Package Franco Carballar's original global Pi TPS extension under MIT.
- Aggregate output tokens and measured request durations across a complete Pi run.
- Anchor timing at `before_provider_request`, ending at assistant `message_end`.
- Suppress incomplete, aborted, erroneous, invalid, duplicate and ambiguous readings.
- Keep the `turn-tps` status key and reset on session lifecycle changes.
- Add deterministic tests, host-loader checks, typecheck and package validation.
