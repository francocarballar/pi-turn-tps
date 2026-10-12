import assert from 'node:assert/strict';
import { createTurnMeter, LIMITS } from '../src/metrics.ts';

const rounds = 20;
const durations: number[] = [];
const heapStart = process.memoryUsage().heapUsed;
let largestRetained = 0;
for (let round = 0; round < rounds; round++) {
  let clock = 0;
  const meter = createTurnMeter(() => clock);
  meter.start();
  const start = performance.now();
  for (let step = 0; step <= LIMITS.steps; step++) {
    meter.request();
    meter.messageStart({ role: 'assistant', timestamp: step });
    clock += 1000;
    meter.messageEnd({
      role: 'assistant',
      timestamp: step,
      provider: 'benchmark',
      model: 'local',
      stopReason: 'stop',
      usage: { output: 30 },
    });
    largestRetained = Math.max(largestRetained, meter.inspect().retainedTimestamps);
  }
  durations.push(performance.now() - start);
  assert.equal(meter.inspect().retainedTimestamps, 0);
  assert.deepEqual(meter.settleResult(), { kind: 'invalid', reason: 'step-limit' });
}
durations.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      node: process.version,
      platform: process.platform,
      rounds,
      stepsPerRound: LIMITS.steps + 1,
      medianMs: durations[Math.floor(rounds / 2)],
      p95Ms: durations[Math.floor(rounds * 0.95)],
      largestRetained,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
      note: 'Local synthetic state-machine benchmark; heap delta includes GC noise, not a memory cap.',
    },
    null,
    2,
  ),
);
