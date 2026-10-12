import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import test from 'node:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import extension from '../extensions/turn-tps.ts';

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;

function harness(t: TestContext, hasUI = true) {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const handlers = new Map<string, Handler>();
  const statuses: [string, string | undefined][] = [];
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const notifications: string[] = [];
  const pi = {
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
    ) {
      commands.set(name, command);
    },
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
      return () => {
        handlers.delete(name);
      };
    },
  };
  // This test double intentionally supplies only the API/context surface the extension uses.
  extension(pi as unknown as ExtensionAPI);
  const ctx = {
    hasUI,
    ui: {
      notify(text: string) {
        notifications.push(text);
      },
      setStatus(key: string, text: string | undefined) {
        statuses.push([key, text]);
      },
    },
  } as unknown as ExtensionContext;
  function handler(name: string): Handler {
    const value = handlers.get(name);
    assert.ok(value, `Missing handler ${name}`);
    return value;
  }
  return {
    statuses,
    notifications,
    command: async (args = '') => {
      await commands.get('tps')?.handler(args, ctx);
    },
    emit(name: string, data: Record<string, unknown> = {}) {
      return handlers.get(name)?.(data, ctx);
    },
    complete(timestamp = 1) {
      handler('before_provider_request')({}, ctx);
      clock += 3000;
      handler('message_start')({ message: { role: 'assistant', timestamp } }, ctx);
      clock += 1000;
      handler('message_end')(
        {
          message: {
            role: 'assistant',
            timestamp,
            provider: 'test',
            model: 'model',
            stopReason: 'stop',
            usage: { output: 30, reasoning: 10 },
          },
        },
        ctx,
      );
    },
  };
}

test('only publishes at agent_settled with the original status key', (t) => {
  const h = harness(t);
  h.emit('agent_start');
  h.complete();
  h.emit('agent_end');
  assert.deepEqual(h.statuses, []);
  h.emit('agent_settled', { aborted: false });
  assert.deepEqual(h.statuses, [
    ['turn-tps', 'test/model · 7.5 tok/s · 30 output tokens / 1 step'],
  ]);
});

test('continuation after agent_end joins the same aggregate', (t) => {
  const h = harness(t);
  h.emit('agent_start');
  h.complete(1);
  h.emit('agent_end');
  h.emit('agent_start');
  h.complete(2);
  h.emit('agent_settled');
  const text = h.statuses[0]?.[1];
  assert.ok(text);
  assert.match(text, /60 output tokens \/ 2 steps/);
});

test('invalid or aborted settlement clears a previous status', (t) => {
  const h = harness(t);
  h.emit('agent_start');
  h.complete();
  h.emit('agent_settled');
  h.emit('agent_start');
  h.complete(2);
  h.emit('agent_settled', { aborted: true });
  assert.deepEqual(h.statuses.at(-1), ['turn-tps', undefined]);
  h.emit('agent_settled');
  assert.deepEqual(h.statuses.at(-1), ['turn-tps', undefined]);
});

test('headless execution never accesses UI', (t) => {
  const h = harness(t, false);
  h.emit('agent_start');
  h.complete();
  h.emit('agent_settled');
  h.emit('session_start');
  assert.deepEqual(h.statuses, []);
});

for (const event of ['session_start', 'session_tree', 'session_shutdown']) {
  test(`${event} clears the status and unfinished meter`, (t) => {
    const h = harness(t);
    h.emit('agent_start');
    h.complete();
    h.emit(event);
    h.emit('agent_settled');
    assert.deepEqual(h.statuses, [
      ['turn-tps', undefined],
      ['turn-tps', undefined],
    ]);
  });
}

for (const reason of ['startup', 'reload', 'new', 'resume', 'fork']) {
  test(`session_start reason ${reason} resets the previous run`, (t) => {
    const h = harness(t);
    h.emit('agent_start');
    h.complete();
    h.emit('session_start', { reason });
    h.emit('agent_settled');
    assert.deepEqual(h.statuses.at(-1), ['turn-tps', undefined]);
  });
}

test('request observer does not replace the provider payload', (t) => {
  const h = harness(t);
  h.emit('agent_start');
  const payload = { messages: ['original'] };
  assert.equal(h.emit('before_provider_request', { payload }), undefined);
  assert.deepEqual(payload, { messages: ['original'] });
});

test('/tps diagnoses empty, complete and invalid turns with versioned local JSON', async (t) => {
  const h = harness(t);
  await h.command('json');
  assert.deepEqual(JSON.parse(h.notifications.at(-1) ?? ''), { schemaVersion: 1, kind: 'empty' });
  h.emit('agent_start');
  h.complete();
  h.emit('agent_settled');
  await h.command('json');
  const result = JSON.parse(h.notifications.at(-1) ?? '');
  assert.equal(result.kind, 'complete');
  assert.equal(result.reading.tokensPerSecond, 7.5);
  h.emit('agent_start');
  h.emit('before_provider_request');
  h.emit('before_provider_request');
  h.emit('agent_settled');
  await h.command();
  assert.equal(h.notifications.at(-1), 'TPS unavailable: ambiguous-request');
  await h.command('json');
  assert.deepEqual(JSON.parse(h.notifications.at(-1) ?? ''), {
    schemaVersion: 1,
    kind: 'invalid',
    reason: 'ambiguous-request',
  });
  await h.command('unknown');
  assert.equal(h.notifications.at(-1), 'Usage: /tps [json]');
  h.emit('session_start');
  await h.command();
  assert.equal(h.notifications.at(-1), 'No completed output yet.');
});

test('/tps is silent without UI', async (t) => {
  const h = harness(t, false);
  await h.command('json');
  assert.deepEqual(h.notifications, []);
});
