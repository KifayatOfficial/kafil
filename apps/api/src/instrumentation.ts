// Next.js calls register() once per server lifecycle (both dev and prod). Perfect place
// to start the in-process scheduler loop for v0 (§4.4).
//
// In production we'll move to a dedicated worker process — flip an env var to skip
// in-process scheduling there.

export async function register(): Promise<void> {
  if (process.env.KAFIL_DISABLE_INPROC_SCHEDULER === '1') return;
  // Avoid loading server-only modules into edge/middleware: gate on runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startSchedulerLoop } = await import('./services/scheduler-cron');
  startSchedulerLoop();
  // eslint-disable-next-line no-console
  console.log('[boot] scheduler loop started (in-process, 60s interval)');
}
