import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(root, '.release');
const manifest: { name: string; version: string } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const npmEntry = process.env.npm_execpath;
assert.ok(npmEntry, 'Use npm run release:prepare or npm run release:publish.');
const mode = process.argv[2];
const manualAuth = process.argv.includes('--manual-auth');
assert.ok(mode === 'prepare' || mode === 'publish' || mode === 'verify', 'Unknown release mode');

function run(command: string, args: string[], capture = true) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 600_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.error ?? ''}\n${result.stderr ?? ''}`,
  );
  return result.stdout?.trim() ?? '';
}
function npm(args: string[], capture = true) {
  return run(
    process.execPath,
    [npmEntry as string, ...(manualAuth ? ['--browser=false'] : []), ...args],
    capture,
  );
}
function integrity(filename: string) {
  return `sha512-${createHash('sha512').update(readFileSync(filename)).digest('base64')}`;
}
async function registry() {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
  );
  if (response.status === 404) return undefined;
  assert.ok(
    response.ok,
    `Registry status ${response.status}; do not assume publication is absent.`,
  );
  const value: {
    name: string;
    version: string;
    dist: { integrity: string; tarball: string; attestations?: unknown };
  } = await response.json();
  return value;
}

const commit = run('git', ['rev-parse', 'HEAD']);
const tag = `v${manifest.version}`;
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'Stable version required');
assert.equal(run('git', ['status', '--porcelain']), '', 'Release requires a clean worktree.');
assert.equal(run('git', ['rev-parse', `${tag}^{commit}`]), commit, 'Tag and checkout must match');
run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
const lock: { version: string; packages: { '': { version: string } } } = JSON.parse(
  readFileSync(join(root, 'package-lock.json'), 'utf8'),
);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);

if (mode === 'prepare') {
  npm(['run', 'verify'], false);
  npm(['run', 'check:package', '--', '--artifact-dir=.release'], false);
  const pack: { filename: string; integrity: string; version: string } = JSON.parse(
    readFileSync(join(directory, 'pack.json'), 'utf8'),
  );
  assert.equal(pack.version, manifest.version);
  assert.equal(integrity(join(directory, pack.filename)), pack.integrity);
  mkdirSync(directory, { recursive: true });
  const receipt = {
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    tag,
    commit,
    filename: pack.filename,
    integrity: pack.integrity,
    verified: true,
  };
  writeFileSync(join(directory, 'release.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} else {
  assert.ok(existsSync(join(directory, 'release.json')), 'Prepare the exact artifact first.');
  const receipt: {
    name: string;
    version: string;
    commit: string;
    filename: string;
    integrity: string;
    verified: boolean;
  } = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
  assert.equal(receipt.name, manifest.name);
  assert.equal(receipt.version, manifest.version);
  assert.equal(receipt.commit, commit);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.filename.includes('/'), false);
  assert.equal(receipt.filename.includes('\\'), false);
  const archive = join(directory, receipt.filename);
  assert.equal(integrity(archive), receipt.integrity);
  let published = await registry();
  if (!published && mode === 'publish') {
    // A possibly dispatched publication is never blindly repeated. Rerun reconciles the registry first.
    npm(
      [
        'publish',
        archive,
        '--access=public',
        '--ignore-scripts',
        ...(process.env.GITHUB_ACTIONS === 'true' ? ['--provenance'] : []),
      ],
      false,
    );
  }
  for (let attempt = 0; attempt < 12 && !published; attempt++) {
    if (attempt > 0) await delay(5000);
    published = await registry();
  }
  assert.ok(
    published,
    'Publication not confirmed in registry; rerun verify before attempting publish again.',
  );
  assert.equal(published.name, receipt.name);
  assert.equal(published.version, receipt.version);
  assert.equal(
    published.dist.integrity,
    receipt.integrity,
    'Registry artifact differs from the verified tarball.',
  );
  const response = await fetch(published.dist.tarball);
  assert.ok(response.ok);
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(
    `sha512-${createHash('sha512').update(downloaded).digest('base64')}`,
    receipt.integrity,
  );
  const verification = {
    ...receipt,
    registryConfirmed: true,
    downloadedArtifactVerified: true,
    provenance: Boolean(published.dist.attestations),
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(join(directory, 'published.json'), JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification, null, 2));
}
