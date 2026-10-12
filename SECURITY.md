# Security policy

Only the latest published minor release receives fixes. The first supported line
is 0.2.x. Upgrade older versions when a fix is released.

Report vulnerabilities privately through GitHub's **Security → Report a
vulnerability** on this repository. Do not post credentials or exploitable details
in public issues. Include the version, reproduction and impact. Responses are
best effort; there is no guaranteed response deadline.

Runtime has no network calls, credential access, telemetry, file writes or model
tools. Diagnostics retain only the latest measurement (counts, duration, model
identifiers) or an allowlisted invalidity reason, in memory. `/tps json` displays
those identifiers locally; redact them if private before sharing. No prompts,
response text, tool arguments or provider payloads are retained.

Pi extensions execute code with the host's privileges. Review versions before
installation. Published artifacts are allowlisted and integrity-checked; CI uses
pinned Actions, least-privilege permissions and isolated installs. Dependency
alerts and CodeQL assist review but are not a guarantee against vulnerabilities.
