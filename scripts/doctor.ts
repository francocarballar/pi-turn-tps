import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest: { version: string; devDependencies: Record<string, string> } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const nodeSupported = major > 22 || (major === 22 && minor >= 19);
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
const globalExtensionCandidate = existsSync(join(agentDir, 'extensions', 'turn-tps.ts'));
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      packageVersion: manifest.version,
      node: process.version,
      nodeSupported,
      platform: process.platform,
      testedPiVersion: manifest.devDependencies['@earendil-works/pi-coding-agent'],
      globalExtensionCandidate,
      recommendations: globalExtensionCandidate
        ? [
            'Review the old global turn-tps.ts before installing this package; keep only one active copy.',
          ]
        : [],
      privacy: 'Read-only. No credentials, prompts or configuration values emitted.',
    },
    null,
    2,
  ),
);
if (!nodeSupported) process.exitCode = 1;
