import type { Alert, Logger } from "./types";

const EMOJI: Record<string, string> = {
  "slow-request": "🐢",
  "slow-mongo": "🍃",
  "slow-redis": "🧱",
  "memory-leak": "📈",
  "memory-high": "🚨",
};

/** Format an alert as Slack message text. */
export function formatSlackMessage(alert: Alert, service: string): string {
  const emoji = EMOJI[alert.type] ?? "⚠️";
  return (
    `${emoji} *[${service}] ${alert.type}*\n` +
    `${alert.message}\n` +
    `• value: \`${alert.value}\`  • threshold: \`${alert.threshold}\`  • at: ${alert.at}`
  );
}

/**
 * Post an alert to a Slack incoming webhook. Uses the global `fetch` (Node 18+);
 * failures are logged, never thrown — observability must not crash the app.
 */
export async function postToSlack(
  webhook: string,
  alert: Alert,
  service: string,
  logger?: Logger,
): Promise<void> {
  if (typeof fetch !== "function") {
    logger?.warn?.("node-observe: global fetch unavailable (need Node 18+); skipping Slack alert");
    return;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatSlackMessage(alert, service) }),
    });
    if (!res.ok) {
      logger?.error?.(`node-observe: Slack webhook returned ${res.status}`);
    }
  } catch (err) {
    logger?.error?.(`node-observe: Slack alert failed: ${(err as Error).message}`);
  }
}
