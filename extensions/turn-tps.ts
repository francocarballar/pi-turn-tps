import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTurnMeter, formatReading } from "../src/metrics.ts";

export default function (pi: ExtensionAPI) {
  const meter = createTurnMeter();

  // Keep one aggregate across agent loops until Pi's final settled boundary.
  pi.on("agent_start", () => { meter.start(); });
  pi.on("before_provider_request", () => { meter.request(); });
  pi.on("message_start", event => { meter.messageStart(event.message); });
  pi.on("message_end", event => { meter.messageEnd(event.message); });

  pi.on("agent_settled", (event, ctx) => {
    const reading = meter.settle(event.aborted);
    if (ctx.hasUI) ctx.ui.setStatus("turn-tps", reading ? formatReading(reading) : undefined);
  });

  // Never carry an unfinished run or old label across session navigation/reloads.
  const reset = (_event: unknown, ctx: ExtensionContext) => {
    meter.reset();
    if (ctx.hasUI) ctx.ui.setStatus("turn-tps", undefined);
  };
  pi.on("session_start", reset);
  pi.on("session_tree", reset);
  pi.on("session_shutdown", reset);
}
