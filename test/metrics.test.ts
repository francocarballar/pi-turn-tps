import assert from 'node:assert/strict';
import test from 'node:test';
import type { TurnReading } from '../src/metrics.ts';
import { createTurnMeter, formatReading } from '../src/metrics.ts';

function fixture() {
  let time = 0;
  const meter = createTurnMeter(() => time);
  meter.start();
  return {
    meter,
    at(value: number) {
      time = value;
    },
    step(
      timestamp: number,
      tokens: unknown,
      duration: number,
      extra: Record<string, unknown> = {},
    ) {
      meter.request();
      meter.messageStart({ role: 'assistant', timestamp });
      time += duration;
      meter.messageEnd({
        role: 'assistant',
        timestamp,
        provider: 'test',
        model: 'model',
        usage: { output: tokens },
        stopReason: 'stop',
        ...extra,
      });
    },
  };
}

function reading(meter: ReturnType<typeof createTurnMeter>): TurnReading {
  const value = meter.settle();
  assert.ok(value, 'Expected a complete reading.');
  return value;
}

test('weights multiple steps by their duration: 30 tokens / 4 seconds = 7.5', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.step(2, 20, 3000);
  assert.deepEqual(f.meter.settle(), {
    outputTokens: 30,
    requestDurationMs: 4000,
    steps: 2,
    models: ['test/model'],
    tokensPerSecond: 7.5,
  });
});

test('matches the OpenCode reference criterion with Pi reasoning already included', () => {
  const f = fixture();
  f.step(1, 25, 4000);
  f.at(24000);
  f.step(2, 40, 6000, { provider: 'other', model: 'other' });
  assert.equal(reading(f.meter).tokensPerSecond, 6.5);
});

test('reasoning metadata is never added a second time', () => {
  const f = fixture();
  f.step(1, 30, 4000, { usage: { output: 30, reasoning: 10 } });
  assert.equal(reading(f.meter).outputTokens, 30);
});

test('excludes tool time and pauses between calls and ignores non-assistant messages', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.at(100000);
  f.meter.messageStart({ role: 'toolResult', timestamp: 1 });
  f.meter.messageEnd({ role: 'toolResult', timestamp: 1, usage: { output: 999 } });
  f.meter.messageStart({ role: 'user', timestamp: 1 });
  f.meter.messageEnd({ role: 'user', timestamp: 1 });
  f.step(2, 20, 3000);
  assert.equal(reading(f.meter).requestDurationMs, 4000);
});

test('includes waiting before assistant message_start', () => {
  const f = fixture();
  f.meter.request();
  f.at(3000);
  f.meter.messageStart({ role: 'assistant', timestamp: 1 });
  f.at(4000);
  f.meter.messageEnd({
    role: 'assistant',
    timestamp: 1,
    usage: { output: 30 },
    provider: 'test',
    model: 'model',
    stopReason: 'stop',
  });
  assert.equal(reading(f.meter).tokensPerSecond, 7.5);
});

test('accepts message_start before the request hook but excludes pre-hook work', () => {
  const f = fixture();
  f.meter.messageStart({ role: 'assistant', timestamp: 1 });
  f.at(1000);
  f.meter.request();
  f.at(5000);
  f.meter.messageEnd({
    role: 'assistant',
    timestamp: 1,
    usage: { output: 30 },
    provider: 'test',
    model: 'model',
    stopReason: 'stop',
  });
  assert.equal(reading(f.meter).requestDurationMs, 4000);
});

test('repeated agent_start preserves an aggregate until settlement', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.meter.start();
  f.step(2, 20, 3000);
  assert.equal(reading(f.meter).steps, 2);
  assert.equal(f.meter.settle(), undefined);
  f.meter.start();
  f.step(3, 5, 1000);
  assert.equal(reading(f.meter).outputTokens, 5);
});

test('reports distinct model count and stable footer format', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.step(2, 20, 3000, { model: 'second' });
  assert.equal(
    formatReading(reading(f.meter)),
    '2 models · 7.5 tok/s · 30 output tokens / 2 steps',
  );
  const g = fixture();
  g.step(1, 30, 4000);
  assert.equal(
    formatReading(reading(g.meter)),
    'test/model · 7.5 tok/s · 30 output tokens / 1 step',
  );
});

for (const output of [undefined, null, NaN, Infinity, -1, 1.5, '30', Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid output ${String(output)} suppresses the entire reading`, () => {
    const f = fixture();
    f.step(1, 10, 1000);
    f.step(2, output, 1000);
    assert.equal(f.meter.settle(), undefined);
  });
}

for (const usage of [undefined, null, {}, 'invalid']) {
  test(`missing/malformed usage ${String(usage)} fails without throwing`, () => {
    const f = fixture();
    f.step(1, 10, 1000, { usage });
    assert.equal(f.meter.settle(), undefined);
  });
}

for (const reason of ['error', 'aborted', undefined, 'unknown']) {
  test(`stop reason ${String(reason)} invalidates even a later successful retry`, () => {
    const f = fixture();
    f.step(1, 10, 1000, { stopReason: reason });
    f.meter.start();
    f.step(2, 20, 1000);
    assert.equal(f.meter.settle(), undefined);
  });
}

test('finalized length and toolUse responses count valid produced output', () => {
  const f = fixture();
  f.step(1, 10, 1000, { stopReason: 'length' });
  f.step(2, 20, 3000, { stopReason: 'toolUse' });
  assert.equal(reading(f.meter).steps, 2);
});

test('missing request hook never falls back to message timing', () => {
  const f = fixture();
  f.meter.messageStart({ role: 'assistant', timestamp: 1 });
  f.at(4000);
  f.meter.messageEnd({ role: 'assistant', timestamp: 1, usage: { output: 30 } });
  assert.equal(f.meter.settle(), undefined);
});

test('message_end without message_start invalidates a previously valid run', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.meter.messageEnd({ role: 'assistant', timestamp: 99 });
  assert.equal(f.meter.settle(), undefined);
});

for (const timestamp of [undefined, NaN, Infinity, '1']) {
  test(`invalid timestamp ${String(timestamp)} suppresses reading`, () => {
    const f = fixture();
    f.meter.request();
    f.meter.messageStart({ role: 'assistant', timestamp });
    assert.equal(f.meter.settle(), undefined);
  });
}

test('duplicates invalidate both pending and sequential timestamp reuse', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.step(1, 20, 1000);
  assert.equal(f.meter.settle(), undefined);
  const g = fixture();
  g.meter.request();
  g.meter.messageStart({ role: 'assistant', timestamp: 1 });
  g.meter.messageStart({ role: 'assistant', timestamp: 1 });
  assert.equal(g.meter.settle(), undefined);
});

test('overlapping calls and extra request hooks are ambiguous', () => {
  const f = fixture();
  f.meter.request();
  f.meter.request();
  f.step(1, 10, 1000);
  assert.equal(f.meter.settle(), undefined);
  const g = fixture();
  g.meter.request();
  g.meter.messageStart({ role: 'assistant', timestamp: 1 });
  g.meter.request();
  assert.equal(g.meter.settle(), undefined);
  const h = fixture();
  h.meter.messageStart({ role: 'assistant', timestamp: 1 });
  h.meter.messageStart({ role: 'assistant', timestamp: 2 });
  h.meter.request();
  assert.equal(h.meter.settle(), undefined);
});

test('dangling request or assistant suppresses a previously complete aggregate', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  f.meter.request();
  assert.equal(f.meter.settle(), undefined);
  const g = fixture();
  g.step(1, 10, 1000);
  g.meter.request();
  g.meter.messageStart({ role: 'assistant', timestamp: 2 });
  assert.equal(g.meter.settle(), undefined);
});

test('aborted settlement clears even a previously complete run', () => {
  const f = fixture();
  f.step(1, 10, 1000);
  assert.equal(f.meter.settle(true), undefined);
  assert.equal(f.meter.settle(), undefined);
});

test('negative/nonfinite elapsed time and nonfinite request anchors invalidate', () => {
  for (const duration of [-1, NaN, Infinity]) {
    const f = fixture();
    f.step(1, 10, duration);
    assert.equal(f.meter.settle(), undefined);
  }
  const f = fixture();
  f.at(NaN);
  f.step(1, 10, 1000);
  assert.equal(f.meter.settle(), undefined);
});

test('sum overflow suppresses rather than showing an infinite or unsafe rate', () => {
  const f = fixture();
  f.step(1, Number.MAX_SAFE_INTEGER, 1000);
  f.step(2, 1, 1000);
  assert.equal(f.meter.settle(), undefined);
});

test('zero total tokens, zero duration and empty runs have no reading', () => {
  const f = fixture();
  f.step(1, 0, 1000);
  assert.equal(f.meter.settle(), undefined);
  const g = fixture();
  g.step(1, 30, 0);
  assert.equal(g.meter.settle(), undefined);
  assert.equal(fixture().meter.settle(), undefined);
});

test('a valid zero-output step still contributes its duration and step count', () => {
  const f = fixture();
  f.step(1, 0, 1000);
  f.step(2, 30, 3000);
  assert.equal(reading(f.meter).tokensPerSecond, 7.5);
});

test('missing model labels and terminal control characters invalidate', () => {
  for (const extra of [{ model: undefined }, { provider: '' }, { model: '\u001b[31m' }]) {
    const f = fixture();
    f.step(1, 30, 1000, extra);
    assert.equal(f.meter.settle(), undefined);
  }
});

test('reset discards state and out-of-run hooks are ignored', () => {
  const f = fixture();
  f.step(1, 30, 1000);
  f.meter.reset();
  f.meter.request();
  assert.equal(f.meter.settle(), undefined);
  f.meter.start();
  f.step(2, 10, 1000);
  assert.equal(reading(f.meter).outputTokens, 10);
});

test('typed outcomes separate empty, aborted, invalid and complete', () => {
  assert.deepEqual(fixture().meter.settleResult(), { kind: 'empty' });
  const a = fixture();
  a.step(1, 1, 1);
  assert.equal(a.meter.settleResult().kind, 'complete');
  assert.deepEqual(a.meter.settleResult(true), { kind: 'invalid', reason: 'aborted' });
  const b = fixture();
  b.meter.request();
  b.meter.request();
  assert.deepEqual(b.meter.settleResult(), { kind: 'invalid', reason: 'ambiguous-request' });
});

test('background request ambiguity invalidates and releases all retained state', () => {
  const f = fixture();
  f.step(1, 1, 1);
  f.meter.request();
  f.meter.request();
  for (let i = 2; i < 100_002; i++) f.step(i, 1, 1);
  assert.deepEqual(f.meter.inspect(), {
    active: true,
    retainedTimestamps: 0,
    retainedModels: 0,
    pending: false,
    steps: 1,
    invalid: 'ambiguous-request',
  });
  assert.deepEqual(f.meter.settleResult(), { kind: 'invalid', reason: 'ambiguous-request' });
});

test('step limit is inclusive and releases retained timestamps after overflow', () => {
  const f = fixture();
  for (let i = 0; i < 10_000; i++) f.step(i, 1, 1);
  assert.equal(f.meter.inspect().retainedTimestamps, 10_000);
  f.step(10_000, 1, 1);
  assert.equal(f.meter.inspect().retainedTimestamps, 0);
  assert.deepEqual(f.meter.settleResult(), { kind: 'invalid', reason: 'step-limit' });
});

test('model limit rejects a 33rd distinct label', () => {
  const f = fixture();
  for (let i = 0; i < 32; i++) f.step(i, 1, 1, { model: `model-${i}` });
  assert.equal(f.meter.inspect().retainedModels, 32);
  f.step(32, 1, 1, { model: 'one-more' });
  assert.deepEqual(f.meter.settleResult(), { kind: 'invalid', reason: 'model-limit' });
});

test('C1, bidi, line separators and oversized labels never reach the footer', () => {
  for (const model of [
    'bad\u0085',
    'bad\u009b',
    'bad\u202e',
    'bad\u2066',
    'bad\u2028',
    'x'.repeat(513),
  ]) {
    const f = fixture();
    f.step(1, 1, 1, { model });
    assert.deepEqual(f.meter.settleResult(), { kind: 'invalid', reason: 'invalid-model' });
  }
});

test('label truncation preserves graphemes and singular grammar', () => {
  const f = fixture();
  f.step(1, 1, 1000, { model: '👩‍💻'.repeat(100) });
  const label = formatReading(reading(f.meter));
  assert.match(label, /… · 1.0 tok\/s · 1 output token \/ 1 step$/);
  assert.equal(
    [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(label.split(' · ')[0] ?? '')]
      .length,
    80,
  );
});

test('seeded generated turns preserve weighting regardless of tool gaps', () => {
  let seed = 0x5eed;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let turn = 0; turn < 100; turn++) {
    const f = fixture();
    let tokens = 0;
    let duration = 0;
    let time = 0;
    const steps = 1 + (next() % 100);
    for (let step = 0; step < steps; step++) {
      const output = 1 + (next() % 10_000);
      const ms = 1 + (next() % 10_000);
      time += next() % 100_000;
      f.at(time);
      f.step(step, output, ms);
      time += ms;
      tokens += output;
      duration += ms;
    }
    assert.deepEqual(f.meter.settle(), {
      outputTokens: tokens,
      requestDurationMs: duration,
      steps,
      models: ['test/model'],
      tokensPerSecond: tokens / (duration / 1000),
    });
  }
});
