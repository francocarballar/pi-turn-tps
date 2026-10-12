import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ExtensionContext, ExtensionEvent } from '@earendil-works/pi-coding-agent';
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

interface PackedArchive {
  filename: string;
  integrity: string;
  files: { path: string }[];
}
interface PackageManifest {
  version: string;
  license: string;
  keywords: string[];
  peerDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
  pi: { extensions: string[] };
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), 'Pi TPS package spaces & á-'));
const npmEntry = process.env.npm_execpath ?? '';
assert.ok(npmEntry && existsSync(npmEntry), 'Run this check through npm run check:package.');

function npm(args: string[], cwd: string): string {
  const r = spawnSync(process.execPath, [npmEntry, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: 180000,
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
  assert.equal(r.status, 0, `npm ${args[0]} failed: ${r.error ?? ''}\n${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

try {
  const packs: PackedArchive[] = JSON.parse(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', sandbox], root),
  );
  const pack = packs[0];
  assert.ok(pack, 'npm did not return a packed archive.');
  const expected = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'extensions/turn-tps.ts',
    'package.json',
    'src/metrics.ts',
  ];
  assert.deepEqual(
    pack.files.map((f) => f.path).sort(),
    expected.sort(),
    'Unexpected published files.',
  );
  const consumer = join(sandbox, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'tps-package-consumer', private: true }),
  );
  npm(
    [
      'install',
      join(sandbox, pack.filename),
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--omit=dev',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
    ],
    consumer,
  );
  const installed = join(consumer, 'node_modules', '@francocarballar', 'pi-turn-tps');
  const manifest: PackageManifest = JSON.parse(
    readFileSync(join(installed, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.keywords.includes('pi-package'));
  assert.equal(manifest.peerDependencies['@earendil-works/pi-coding-agent'], '*');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(
    existsSync(join(consumer, 'node_modules', '@earendil-works', 'pi-coding-agent')),
    false,
  );
  const agentDir = join(sandbox, 'isolated-agent');
  mkdirSync(agentDir);
  const piEntry = fileURLToPath(
    new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')),
  );
  for (const args of [['install', installed], ['list']]) {
    const r = spawnSync(process.execPath, [piEntry, ...args], {
      cwd: consumer,
      encoding: 'utf8',
      shell: false,
      timeout: 120000,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    assert.equal(r.status, 0, `Pi ${args[0]} failed: ${r.error ?? ''}\n${r.stderr}\n${r.stdout}`);
    if (args[0] === 'list')
      assert.ok(r.stdout.includes(installed), 'Pi did not list the installed package.');
  }
  const settings: { packages: (string | { source: string })[] } = JSON.parse(
    readFileSync(join(agentDir, 'settings.json'), 'utf8'),
  );
  assert.ok(
    settings.packages.some((p) => {
      const source = typeof p === 'string' ? p : p.source;
      const path = resolve(agentDir, source);
      return existsSync(path) && realpathSync(path) === realpathSync(installed);
    }),
    `Unexpected isolated Pi package declarations: ${JSON.stringify(settings.packages)}`,
  );
  const result = await discoverAndLoadExtensions(
    manifest.pi.extensions.map((entry) => join(installed, entry)),
    consumer,
    agentDir,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  const ext = result.extensions[0];
  assert.ok(ext, 'Pi did not load the extension.');
  const registeredHandlers = ext.handlers;
  for (const event of [
    'agent_start',
    'before_provider_request',
    'message_start',
    'message_end',
    'agent_settled',
  ] as const) {
    assert.ok(registeredHandlers.get(event)?.length, `Pi did not register ${event}.`);
  }
  const statuses: [string, string | undefined][] = [];
  const ctx = {
    hasUI: true,
    ui: {
      setStatus(key: string, text: string | undefined) {
        statuses.push([key, text]);
      },
    },
  } as unknown as ExtensionContext;
  async function emit(type: ExtensionEvent['type'], data: Record<string, unknown> = {}) {
    // Synthetic fixture events use only the fields these particular handlers inspect.
    for (const handler of registeredHandlers.get(type) ?? [])
      await handler({ type, ...data } as ExtensionEvent, ctx);
  }
  let clock = 0;
  const mockedClock = mock.method(performance, 'now', () => clock);
  try {
    await emit('agent_start');
    for (const [timestamp, output, duration] of [
      [1, 10, 1000],
      [2, 20, 3000],
    ] as const) {
      await emit('before_provider_request', { payload: { original: true } });
      await emit('message_start', { message: { role: 'assistant', timestamp } });
      clock += duration;
      await emit('message_end', {
        message: {
          role: 'assistant',
          timestamp,
          provider: 'test',
          model: 'model',
          usage: { output },
          stopReason: 'stop',
        },
      });
      clock += 90000; // Tools/pauses must not change the aggregate.
    }
    assert.deepEqual(statuses, []);
    await emit('agent_settled', { aborted: false });
    assert.deepEqual(statuses, [
      ['turn-tps', 'test/model · 7.5 tok/s · 30 output tokens / 2 steps'],
    ]);
  } finally {
    mockedClock.mock.restore();
  }
  console.log(
    JSON.stringify(
      {
        version: manifest.version,
        node: process.version,
        platform: process.platform,
        packedFiles: expected,
        integrity: pack.integrity,
        installed: true,
        piCliInstall: true,
        hostLoaded: true,
        handlerExecution: true,
        syntheticTPS: 7.5,
        provider: 'not contacted',
      },
      null,
      2,
    ),
  );
  const artifactArg = process.argv.find((arg) => arg.startsWith('--artifact-dir='));
  if (artifactArg) {
    const destination = resolve(root, artifactArg.slice('--artifact-dir='.length));
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(sandbox, pack.filename), join(destination, pack.filename));
    writeFileSync(
      join(destination, 'pack.json'),
      JSON.stringify({ ...pack, version: manifest.version }, null, 2),
    );
  }
} finally {
  // Only remove the temporary directory created by this check.
  rmSync(sandbox, { recursive: true, force: true });
}
