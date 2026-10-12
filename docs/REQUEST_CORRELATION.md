# Future host request correlation proposal

This is a local design note, not a submitted upstream issue or an implemented Pi
feature. Pi 1.1.0's before_provider_request event exposes payload but no stable
request ID linked to the resulting assistant message.

A stronger host contract would expose an opaque requestId on request start/end and
assistant messages, plus purpose (`assistant`, `compaction`, `cache-warming`,
`extension`) and attempt identity. It should specify monotonic timing boundaries,
terminal errors/abort and whether transport retries share a logical request ID.

With that contract, this extension could correlate precisely and ignore background
work, without inspecting prompts or payloads. Until then, supported calls are
sequential and ambiguity invalidates the whole turn. Do not invent IDs from payload
hashes: they expose information and collide across retries.
