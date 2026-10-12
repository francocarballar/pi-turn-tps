import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { MeasurementResult } from '../src/metrics.ts';
import { createTurnMeter, formatReading } from '../src/metrics.ts';

export default function (pi: ExtensionAPI) {
  const meter = createTurnMeter();
  let lastResult: MeasurementResult = { kind: 'empty' };

  pi.registerCommand('tps', {
    description: 'Show the latest local turn measurement; /tps json gives structured diagnostics',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      if (args.trim() && args.trim() !== 'json') {
        ctx.ui.notify('Usage: /tps [json]', 'warning');
        return;
      }
      const text =
        args.trim() === 'json'
          ? JSON.stringify({ schemaVersion: 1, ...lastResult })
          : lastResult.kind === 'complete'
            ? formatReading(lastResult.reading)
            : lastResult.kind === 'invalid'
              ? `TPS unavailable: ${lastResult.reason}`
              : 'No completed output yet.';
      ctx.ui.notify(text, 'info');
    },
  });

  // Keep one aggregate across agent loops until Pi's final settled boundary.
  pi.on('agent_start', () => {
    meter.start();
  });
  pi.on('before_provider_request', () => {
    meter.request();
  });
  pi.on('message_start', (event) => {
    meter.messageStart(event.message);
  });
  pi.on('message_end', (event) => {
    meter.messageEnd(event.message);
  });

  pi.on('agent_settled', (event, ctx) => {
    lastResult = meter.settleResult(event.aborted);
    if (ctx.hasUI)
      ctx.ui.setStatus(
        'turn-tps',
        lastResult.kind === 'complete' ? formatReading(lastResult.reading) : undefined,
      );
  });

  // Never carry an unfinished run or old label across session navigation/reloads.
  const reset = (_event: unknown, ctx: ExtensionContext) => {
    meter.reset();
    lastResult = { kind: 'empty' };
    if (ctx.hasUI) ctx.ui.setStatus('turn-tps', undefined);
  };
  pi.on('session_start', reset);
  pi.on('session_tree', reset);
  pi.on('session_shutdown', reset);
}
