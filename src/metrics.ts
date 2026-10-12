/** The same weighted aggregation criterion as OpenCode v2.0.27; original implementation. */
export interface TurnReading {
  outputTokens: number;
  requestDurationMs: number;
  steps: number;
  models: string[];
  tokensPerSecond: number;
}

interface RunMetrics {
  outputTokens: number;
  requestDurationMs: number;
  steps: number;
  models: Set<string>;
  seen: Set<number>;
  pending: Map<number, { startedAt: number | undefined }>;
  requestStart: number | undefined;
  incomplete: boolean;
}

function createRun(): RunMetrics {
  return { outputTokens: 0, requestDurationMs: 0, steps: 0, models: new Set(),
    seen: new Set(), pending: new Map(), requestStart: undefined, incomplete: false };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** One instance per loaded extension. Clock injection makes timing tests deterministic. */
export function createTurnMeter(now: () => number = () => performance.now()) {
  let run: RunMetrics | undefined;

  return {
    start() { run ??= createRun(); },
    reset() { run = undefined; },

    request() {
      // Ignore out-of-run requests, e.g. unrelated extension work or compaction.
      if (!run) return;
      const startedAt = now();
      if (!Number.isFinite(startedAt)) run.incomplete = true;
      if (run.pending.size === 1) {
        // Some adapters emit assistant start before calling the payload hook.
        const step = run.pending.values().next().value;
        if (!step || step.startedAt !== undefined || run.requestStart !== undefined) {
          run.incomplete = true;
        } else {
          step.startedAt = startedAt;
        }
      } else if (run.pending.size > 1 || run.requestStart !== undefined) {
        // The Pi hook has no request ID. Never guess between overlapping requests.
        run.incomplete = true;
      } else {
        run.requestStart = startedAt;
      }
    },

    messageStart(message: unknown) {
      if (!record(message) || message.role !== "assistant") return;
      run ??= createRun();
      const key = message.timestamp;
      if (typeof key !== "number" || !Number.isFinite(key)) {
        run.incomplete = true;
        return;
      }
      if (run.seen.has(key) || run.pending.size > 0) run.incomplete = true;
      run.seen.add(key);
      run.pending.set(key, { startedAt: run.requestStart });
      run.requestStart = undefined;
    },

    messageEnd(message: unknown) {
      if (!record(message) || message.role !== "assistant") return;
      run ??= createRun();
      const key = message.timestamp;
      const step = typeof key === "number" ? run.pending.get(key) : undefined;
      if (!step || step.startedAt === undefined) {
        run.incomplete = true;
        return;
      }
      run.pending.delete(key as number);
      const durationMs = now() - step.startedAt;
      const output = record(message.usage) ? message.usage.output : undefined;
      if (!Number.isFinite(durationMs) || durationMs < 0 ||
          typeof output !== "number" || !Number.isSafeInteger(output) || output < 0 ||
          !["stop", "length", "toolUse"].includes(String(message.stopReason)) ||
          !validModel(message.provider) || !validModel(message.model)) {
        run.incomplete = true;
        return;
      }
      // Pi's output already includes reasoning; never add usage.reasoning.
      run.outputTokens += output;
      run.requestDurationMs += durationMs;
      run.steps += 1;
      run.models.add(`${message.provider}/${message.model}`);
      if (!Number.isSafeInteger(run.outputTokens) || !Number.isFinite(run.requestDurationMs)) {
        run.incomplete = true;
      }
    },

    settle(aborted = false): TurnReading | undefined {
      const completed = run;
      run = undefined;
      if (aborted || !completed || completed.incomplete || completed.pending.size > 0 ||
          completed.requestStart !== undefined || completed.steps === 0 ||
          completed.outputTokens <= 0 || completed.requestDurationMs <= 0) return;
      const tokensPerSecond = completed.outputTokens / (completed.requestDurationMs / 1_000);
      if (!Number.isFinite(tokensPerSecond)) return;
      return { outputTokens: completed.outputTokens, requestDurationMs: completed.requestDurationMs,
        steps: completed.steps, models: [...completed.models], tokensPerSecond };
    },
  };
}

export function formatReading(reading: TurnReading): string {
  const model = reading.models.length === 1 ? reading.models[0] : `${reading.models.length} models`;
  return `${model} · ${reading.tokensPerSecond.toFixed(1)} tok/s · ${reading.outputTokens.toLocaleString()} output tokens / ${reading.steps} steps`;
}
