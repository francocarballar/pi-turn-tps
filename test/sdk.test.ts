import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from '@earendil-works/pi-ai';
import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { MeasurementResult } from '../src/metrics.ts';

interface ResponsePlan {
  tokens?: number;
  tool?: boolean;
  error?: boolean;
  truncated?: boolean;
  waitMs?: number;
  streamMs?: number;
}

/** A real loopback HTTP/SSE transport; no global Pi config or external provider. */
async function harness(
  t: TestContext,
  plans: ResponsePlan[],
  retries = false,
  providerRetries = 0,
) {
  const sandbox = await mkdtemp(join(tmpdir(), 'pi-tps-sdk-'));
  const statuses: (string | undefined)[] = [];
  const notifications: string[] = [];
  const errors: unknown[] = [];
  const trace: { type: string; at: number }[] = [];
  let requests = 0;
  let toolDurationMs = 0;
  const pendingResponses = new Set<ServerResponse>();
  let sessionToDispose: AgentSession | undefined;
  const server = createServer((req, res) => {
    req.resume();
    pendingResponses.add(res);
    res.on('close', () => pendingResponses.delete(res));
    const index = requests++;
    const plan = plans[index];
    if (req.url !== '/v1/chat/completions' || !plan) {
      errors.push(new Error(`Unexpected HTTP request ${req.url} #${index}`));
      res.writeHead(400).end();
      return;
    }
    void (async () => {
      trace.push({ type: 'http-start', at: performance.now() });
      await delay(plan.waitMs ?? 80);
      if (res.destroyed) return;
      if (plan.error) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Synthetic unavailable', type: 'server_error' } }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (choices: unknown[], usage?: unknown) => {
        res.write(
          `data: ${JSON.stringify({
            id: `completion-${index}`,
            object: 'chat.completion.chunk',
            model: 'controlled',
            choices,
            ...(usage ? { usage } : {}),
          })}\n\n`,
        );
      };
      trace.push({ type: 'first-chunk', at: performance.now() });
      send([
        {
          index: 0,
          delta: plan.tool
            ? {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: `tool-${index}`,
                    type: 'function',
                    function: { name: 'controlled_pause', arguments: '{}' },
                  },
                ],
              }
            : { role: 'assistant', content: 'Controlled response.' },
          finish_reason: null,
        },
      ]);
      await delay(plan.streamMs ?? 80);
      if (res.destroyed) return;
      if (!plan.truncated) {
        send([{ index: 0, delta: {}, finish_reason: plan.tool ? 'tool_calls' : 'stop' }], {
          prompt_tokens: 5,
          completion_tokens: plan.tokens ?? 30,
          completion_tokens_details: { reasoning_tokens: 10 },
          total_tokens: (plan.tokens ?? 30) + 5,
        });
      }
      trace.push({ type: 'http-end', at: performance.now() });
      res.end('data: [DONE]\n\n');
    })().catch((error) => {
      errors.push(error);
      res.destroy();
    });
  });
  // Register teardown before setup so failed setup/assertions cannot leak a server or temp tree.
  t.after(async () => {
    sessionToDispose?.dispose();
    for (const response of pendingResponses) response.destroy();
    server.closeAllConnections();
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
    await rm(sandbox, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const settings = SettingsManager.inMemory({
    compaction: { enabled: false },
    cacheWarming: 'off',
    retry: {
      enabled: retries,
      maxRetries: 1,
      baseDelayMs: 10,
      maxAgentDelayMs: 100,
      provider: { maxRetries: providerRetries, maxRetryDelayMs: 100, timeoutMs: 5000 },
    },
  });
  const observer: ExtensionFactory = (pi) => {
    pi.on('before_provider_request', () => {
      trace.push({ type: 'hook', at: performance.now() });
    });
    pi.on('message_start', (event) => {
      if (event.message.role === 'assistant')
        trace.push({ type: 'message-start', at: performance.now() });
    });
    pi.on('message_end', (event) => {
      if (event.message.role === 'assistant')
        trace.push({ type: 'message-end', at: performance.now() });
    });
    pi.on('agent_settled', () => {
      trace.push({ type: 'settled', at: performance.now() });
    });
    pi.registerTool({
      name: 'controlled_pause',
      label: 'Controlled pause',
      description: 'Local integration fixture only.',
      parameters: Type.Object({}),
      execute: async () => {
        const before = performance.now();
        await delay(250);
        toolDurationMs += performance.now() - before;
        return { content: [{ type: 'text', text: 'Done' }], details: {} };
      },
    });
  };
  const loader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager: settings,
    additionalExtensionPaths: [join(process.cwd(), 'extensions', 'turn-tps.ts')],
    extensionFactories: [observer],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Local controlled integration fixture.',
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await ModelRuntime.create({
    authPath: join(sandbox, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(sandbox, 'models-store.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerProvider('tps-fixture', {
    api: 'openai-completions',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'local-fixture-not-a-secret',
    models: [
      {
        id: 'controlled',
        name: 'Controlled',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });
  const model = runtime.getModel('tps-fixture', 'controlled');
  assert.ok(model);
  const { session } = await createAgentSession({
    cwd: sandbox,
    agentDir: sandbox,
    model,
    thinkingLevel: 'off',
    modelRuntime: runtime,
    resourceLoader: loader,
    tools: ['controlled_pause'],
    sessionManager: SessionManager.inMemory(sandbox),
    settingsManager: settings,
  });
  sessionToDispose = session;
  const runner = session.extensionRunner;
  assert.ok(runner);
  // Complete host-provided UI contract, with only the two observable sinks replaced.
  await session.bindExtensions({
    uiContext: {
      ...runner.getUIContext(),
      setStatus(key, value) {
        assert.equal(key, 'turn-tps');
        statuses.push(value);
      },
      notify(value) {
        notifications.push(value);
      },
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  return {
    session,
    statuses,
    trace,
    get requests() {
      return requests;
    },
    get toolDurationMs() {
      return toolDurationMs;
    },
    async result(): Promise<MeasurementResult> {
      await session.prompt('/tps json');
      const text = notifications.at(-1);
      assert.ok(text, 'Missing /tps diagnostic');
      const result = JSON.parse(text) as MeasurementResult & { schemaVersion: number };
      assert.equal(result.schemaVersion, 1);
      return result;
    },
  };
}

async function awaitFirstRequest(h: { readonly requests: number }) {
  const deadline = performance.now() + 5000;
  while (h.requests === 0 && performance.now() < deadline) await delay(5);
  assert.ok(h.requests > 0, 'Pi did not reach the local HTTP fixture within five seconds');
}

test('real Pi SDK counts provider wait/stream, excludes tool delay, and counts reasoning once', {
  timeout: 20_000,
}, async (t) => {
  const h = await harness(t, [{ tokens: 10, tool: true }, { tokens: 20 }]);
  const started = performance.now();
  await h.session.prompt('Use the controlled tool and finish.');
  const wallMs = performance.now() - started;
  const result = await h.result();
  assert.equal(result.kind, 'complete');
  if (result.kind !== 'complete') return;
  assert.equal(result.reading.outputTokens, 30);
  assert.equal(result.reading.steps, 2);
  assert.equal(h.requests, 2);
  assert.ok(h.toolDurationMs >= 200, JSON.stringify(h.session.messages));
  const hooks = h.trace.filter((event) => event.type === 'hook');
  const ends = h.trace.filter((event) => event.type === 'message-end');
  assert.equal(hooks.length, 2);
  assert.equal(ends.length, 2);
  const measured = ends.reduce((total, end, i) => total + end.at - (hooks[i]?.at ?? NaN), 0);
  assert.ok(Math.abs(result.reading.requestDurationMs - measured) < 40);
  assert.ok(result.reading.requestDurationMs >= 280, 'Both request waits and streams must count');
  assert.ok(
    wallMs - result.reading.requestDurationMs >= h.toolDurationMs - 40,
    'Tool time must be excluded',
  );
  assert.match(h.statuses.at(-1) ?? '', /30 output tokens \/ 2 steps/);
});

test('real Pi SDK resets aggregation on the next prompt', { timeout: 20_000 }, async (t) => {
  const h = await harness(t, [{ tokens: 30 }, { tokens: 50 }]);
  await h.session.prompt('First');
  assert.equal((await h.result()).kind, 'complete');
  await h.session.prompt('Second');
  const result = await h.result();
  assert.equal(result.kind, 'complete');
  if (result.kind === 'complete') {
    assert.equal(result.reading.outputTokens, 50);
    assert.equal(result.reading.steps, 1);
  }
});

for (const [name, plan] of [
  ['HTTP failure', { error: true }],
  ['truncated stream', { truncated: true }],
] as const) {
  test(`real Pi SDK ${name} produces an invalid diagnostic`, { timeout: 20_000 }, async (t) => {
    const h = await harness(t, [plan]);
    await h.session.prompt('Failure');
    const result = await h.result();
    assert.equal(result.kind, 'invalid');
    assert.equal(h.statuses.at(-1), undefined);
  });
}

test('real Pi SDK abort never publishes a partial reading', { timeout: 20_000 }, async (t) => {
  const h = await harness(t, [{ waitMs: 2000 }]);
  const prompt = h.session.prompt('Abort');
  await awaitFirstRequest(h);
  await h.session.abort();
  await prompt;
  const result = await h.result();
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') assert.equal(result.reason, 'aborted');
  assert.equal(h.statuses.at(-1), undefined);
});

test('real Pi agent retry retains invalidity despite a later success', {
  timeout: 20_000,
}, async (t) => {
  const h = await harness(t, [{ error: true }, { tokens: 30 }], true);
  await h.session.prompt('Retry');
  assert.equal(h.requests, 2);
  const result = await h.result();
  assert.equal(result.kind, 'invalid');
  assert.equal(h.statuses.at(-1), undefined);
});

test('real Pi queued follow-up shares the final settled aggregate', {
  timeout: 20_000,
}, async (t) => {
  const h = await harness(t, [{ tokens: 10 }, { tokens: 20 }]);
  const prompt = h.session.prompt('First');
  await awaitFirstRequest(h);
  await h.session.followUp('Queued continuation');
  await prompt;
  await h.session.waitForIdle();
  const result = await h.result();
  assert.equal(result.kind, 'complete');
  if (result.kind === 'complete') {
    assert.equal(result.reading.outputTokens, 30);
    assert.equal(result.reading.steps, 2);
  }
  assert.equal(h.trace.filter((event) => event.type === 'settled').length, 1);
});

test('real Pi provider-internal retry remains inside one successful timed response', {
  timeout: 20_000,
}, async (t) => {
  const h = await harness(t, [{ error: true }, { tokens: 30 }], false, 1);
  await h.session.prompt('Transport retry');
  assert.equal(h.requests, 2);
  assert.equal(h.trace.filter((event) => event.type === 'hook').length, 1);
  const result = await h.result();
  assert.equal(result.kind, 'complete');
  if (result.kind === 'complete') {
    assert.equal(result.reading.steps, 1);
    assert.equal(result.reading.outputTokens, 30);
    assert.ok(result.reading.requestDurationMs >= 200);
  }
});
