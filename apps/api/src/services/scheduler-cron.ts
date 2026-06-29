// Background scheduler runner.
//
// In v0 this lives inside the Next.js process — it self-starts on first import in
// development so a local dev box runs the timeouts automatically without an external
// cron. In production we'll prefer a sidecar (k8s CronJob or a dedicated worker), but
// the same tickOnce() call applies — only the *trigger* changes.
//
// Concurrency safety:
//   - Each tick is wrapped in advisory locks per target (§24/C3) inside the service,
//     so even running multiple processes is safe; this guard just avoids overlap on
//     the SAME process when a tick runs long.
//   - We never throw out of the interval; we log and continue.

import { schedulerService } from './scheduler.service';

const DEFAULT_INTERVAL_MS = 60_000;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export function startSchedulerLoop(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (started) return;
  started = true;

  // Light first tick on next event-loop turn so it's observable in dev.
  setTimeout(() => {
    void runOnce();
  }, 5_000);

  timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  // In serverless/edge: an interval here would leak; we don't ship there. (P2)
}

async function runOnce(): Promise<void> {
  if (inFlight) return; // prevent overlap inside this process
  inFlight = true;
  try {
    const stats = await schedulerService.tickOnce();
    if (stats.expiredAssigned > 0 || stats.routedToOpsReview > 0 || stats.payoutsReversed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[scheduler] tick: expired=${stats.expiredAssigned} ops_review=${stats.routedToOpsReview} payouts_reversed=${stats.payoutsReversed}`,
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[scheduler] tick failed:', e instanceof Error ? e.message : String(e));
  } finally {
    inFlight = false;
  }
}

export function stopSchedulerLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
