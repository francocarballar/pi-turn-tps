/** Weighted output / request duration. Pi output already includes reasoning. */
export interface TurnReading {
  outputTokens: number;
  requestDurationMs: number;
  steps: number;
  models: string[];
  tokensPerSecond: number;
}

export type InvalidReason =
  | 'aborted'
  | 'invalid-clock'
  | 'ambiguous-request'
  | 'invalid-timestamp'
  | 'duplicate-timestamp'
  | 'missing-anchor'
  | 'invalid-usage'
  | 'incomplete-response'
  | 'invalid-model'
  | 'overflow'
  | 'unfinished-request'
  | 'zero-duration'
  | 'step-limit'
  | 'model-limit';

export type MeasurementResult =
  | { kind: 'complete'; reading: TurnReading }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: InvalidReason };

/** Fixed bounds; an invalid run immediately releases all retained identifiers. */
export const LIMITS = Object.freeze({
  steps: 10_000,
  models: 32,
  modelLength: 512,
  labelLength: 80,
});

interface RunMetrics {
  outputTokens: number;
  requestDurationMs: number;
  steps: number;
  models: Set<string>;
  seen: Set<number>;
  pending: { timestamp: number; startedAt: number | undefined } | undefined;
  requestStart: number | undefined;
  invalid: InvalidReason | undefined;
}

function createRun(): RunMetrics {
  return {
    outputTokens: 0,
    requestDurationMs: 0,
    steps: 0,
    models: new Set(),
    seen: new Set(),
    pending: undefined,
    requestStart: undefined,
    invalid: undefined,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function validModel(value: unknown): value is string {
  // Reject terminal controls, C1, bidi overrides/isolation and line separators.
  return (
    typeof value === 'string' &&
    value.length <= LIMITS.modelLength &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(value)
  );
}

/** One instance per extension; the injected monotonic clock is the only timing source. */
export function createTurnMeter(now: () => number = () => performance.now()) {
  let run: RunMetrics | undefined;

  function invalidate(reason: InvalidReason) {
    if (!run || run.invalid) return;
    run.invalid = reason;
    run.seen.clear();
    run.models.clear();
    run.pending = undefined;
    run.requestStart = undefined;
  }

  function settleResult(aborted = false): MeasurementResult {
    const completed = run;
    run = undefined;
    if (aborted) return { kind: 'invalid', reason: 'aborted' };
    if (!completed) return { kind: 'empty' };
    if (completed.invalid) return { kind: 'invalid', reason: completed.invalid };
    if (completed.pending || completed.requestStart !== undefined) {
      return { kind: 'invalid', reason: 'unfinished-request' };
    }
    if (completed.steps === 0 || completed.outputTokens === 0) return { kind: 'empty' };
    if (completed.requestDurationMs <= 0) return { kind: 'invalid', reason: 'zero-duration' };
    const tokensPerSecond = completed.outputTokens / (completed.requestDurationMs / 1_000);
    if (!Number.isFinite(tokensPerSecond)) return { kind: 'invalid', reason: 'overflow' };
    return {
      kind: 'complete',
      reading: {
        outputTokens: completed.outputTokens,
        requestDurationMs: completed.requestDurationMs,
        steps: completed.steps,
        models: [...completed.models],
        tokensPerSecond,
      },
    };
  }

  return {
    start() {
      run ??= createRun();
    },
    reset() {
      run = undefined;
    },
    /** Counts only. No prompts, model identifiers, payloads or timestamps. */
    inspect() {
      return {
        active: Boolean(run),
        retainedTimestamps: run?.seen.size ?? 0,
        retainedModels: run?.models.size ?? 0,
        pending: Boolean(run?.pending),
        steps: run?.steps ?? 0,
        invalid: run?.invalid,
      };
    },
    request() {
      // Out-of-run work (e.g. compaction) has no turn anchor.
      if (!run || run.invalid) return;
      const startedAt = now();
      if (!Number.isFinite(startedAt)) return invalidate('invalid-clock');
      if (run.pending) {
        // Pi adapters may emit assistant start before their payload hook.
        if (run.pending.startedAt !== undefined || run.requestStart !== undefined) {
          return invalidate('ambiguous-request');
        }
        run.pending.startedAt = startedAt;
      } else if (run.requestStart !== undefined) {
        return invalidate('ambiguous-request');
      } else run.requestStart = startedAt;
    },
    messageStart(message: unknown) {
      if (!record(message) || message.role !== 'assistant') return;
      run ??= createRun();
      if (run.invalid) return;
      const timestamp = message.timestamp;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
        return invalidate('invalid-timestamp');
      if (run.seen.has(timestamp)) return invalidate('duplicate-timestamp');
      if (run.pending) return invalidate('ambiguous-request');
      if (run.seen.size >= LIMITS.steps) return invalidate('step-limit');
      run.seen.add(timestamp);
      run.pending = { timestamp, startedAt: run.requestStart };
      run.requestStart = undefined;
    },
    messageEnd(message: unknown) {
      if (!record(message) || message.role !== 'assistant') return;
      run ??= createRun();
      if (run.invalid) return;
      const step = run.pending;
      if (!step || step.timestamp !== message.timestamp || step.startedAt === undefined) {
        return invalidate('missing-anchor');
      }
      run.pending = undefined;
      const durationMs = now() - step.startedAt;
      if (!Number.isFinite(durationMs) || durationMs < 0) return invalidate('invalid-clock');
      const output = record(message.usage) ? message.usage.output : undefined;
      if (typeof output !== 'number' || !Number.isSafeInteger(output) || output < 0)
        return invalidate('invalid-usage');
      if (!['stop', 'length', 'toolUse'].includes(String(message.stopReason)))
        return invalidate('incomplete-response');
      if (!validModel(message.provider) || !validModel(message.model))
        return invalidate('invalid-model');
      const model = `${message.provider}/${message.model}`;
      if (!run.models.has(model) && run.models.size >= LIMITS.models)
        return invalidate('model-limit');
      // usage.output is inclusive of reasoning. It must be counted exactly once.
      run.outputTokens += output;
      run.requestDurationMs += durationMs;
      run.steps += 1;
      run.models.add(model);
      if (!Number.isSafeInteger(run.outputTokens) || !Number.isFinite(run.requestDurationMs))
        invalidate('overflow');
    },
    settleResult,
    /** Compatibility convenience; new consumers should use the discriminated result. */
    settle(aborted = false): TurnReading | undefined {
      const result = settleResult(aborted);
      return result.kind === 'complete' ? result.reading : undefined;
    },
  };
}

function truncateLabel(value: string): string {
  // Graphemes keep surrogate pairs, combining marks and emoji sequences intact.
  const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  return segments.length <= LIMITS.labelLength
    ? value
    : `${segments
        .slice(0, LIMITS.labelLength - 1)
        .map((segment) => segment.segment)
        .join('')}…`;
}

export function formatReading(reading: TurnReading): string {
  const model =
    reading.models.length === 1
      ? truncateLabel(reading.models[0] ?? '')
      : `${reading.models.length} models`;
  const tokens = reading.outputTokens.toLocaleString('en-US');
  return `${model} · ${reading.tokensPerSecond.toFixed(1)} tok/s · ${tokens} output ${reading.outputTokens === 1 ? 'token' : 'tokens'} / ${reading.steps} ${reading.steps === 1 ? 'step' : 'steps'}`;
}
