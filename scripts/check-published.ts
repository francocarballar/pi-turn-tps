import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest: { name: string; version: string } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const sandbox = mkdtempSync(join(tmpdir(), 'Pi published spaces & á-'));
const piEntry = fileURLToPath(
  new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')),
);
const results: Record<string, unknown>[] = [];

function findPackage(directory: string): string | undefined {
  // Search only our isolated Pi managed package roots, never the user's filesystem.
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    try {
      const candidate: { name?: string } = JSON.parse(
        readFileSync(join(path, 'package.json'), 'utf8'),
      );
      if (candidate.name === manifest.name) return path;
    } catch {
      /* Intermediate directories have no manifest. */
    }
    const found = findPackage(path);
    if (found) return found;
  }
  return undefined;
}

try {
  for (const [kind, source] of [
    ['npm', `npm:${manifest.name}@${manifest.version}`],
    ['git', `git:github.com/francocarballar/pi-turn-tps@v${manifest.version}`],
  ] as const) {
    const cwd = join(sandbox, kind);
    const agentDir = join(cwd, 'agent');
    mkdirSync(agentDir, { recursive: true });
    const env = {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    };
    for (const args of [['install', source], ['list']]) {
      const execution = spawnSync(process.execPath, [piEntry, ...args], {
        cwd,
        env,
        encoding: 'utf8',
        shell: false,
        timeout: 180_000,
      });
      assert.equal(
        execution.status,
        0,
        `Pi ${kind} ${args[0]} failed: ${execution.error ?? ''}\n${execution.stderr}\n${execution.stdout}`,
      );
      if (args[0] === 'list') assert.ok(execution.stdout.includes(source));
    }
    const installed =
      kind === 'npm'
        ? join(agentDir, 'npm', 'node_modules', manifest.name)
        : findPackage(join(agentDir, 'git'));
    assert.ok(installed, 'Missing managed package');
    const actual: { name: string; version: string; pi: { extensions: string[] } } = JSON.parse(
      readFileSync(join(installed, 'package.json'), 'utf8'),
    );
    assert.equal(actual.name, manifest.name);
    assert.equal(actual.version, manifest.version);
    const loaded = await discoverAndLoadExtensions(
      actual.pi.extensions.map((path) => join(installed, path)),
      cwd,
      agentDir,
    );
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.ok(loaded.extensions[0]?.commands.has('tps'));
    results.push({
      kind,
      source,
      installed: true,
      versionVerified: true,
      extensionLoaded: true,
      diagnosticCommandRegistered: true,
    });
  }
  const receipt = {
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    node: process.version,
    platform: process.platform,
    results,
    externalModelContacted: false,
    checkedAt: new Date().toISOString(),
  };
  const artifactDir = join(root, '.release');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'consumers.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
