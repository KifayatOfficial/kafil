// GET /api/stream — §P4.1 Server-Sent Events: the per-user real-time channel.
//
// Replaces the 4s chat poll (and powers live app-status / nearby hints). SSE over plain
// HTTP survives 2G/3G reconnects, needs no websocket upgrade, and one-way push is all the
// live cases require. The client (EventSource) reconnects with backoff; because every
// event is a *hint to refresh* and the REST read is authoritative, a dropped event or a
// cross-pod miss self-heals on reconnect.
//
// Auth: same bearer-actor as every other route. The stream is strictly scoped to the
// caller's userId — a connection only ever receives its own events.

import { getActor } from '../../../lib/auth';
import { subscribe, type StreamEvent } from '../../../lib/event-bus';

export const dynamic = 'force-dynamic';
// Node runtime (not edge): the in-process bus lives in the Node server.
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000; // keep proxies from killing an idle connection

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor(req);
  if (!actor) {
    return new Response('event: error\ndata: {"code":"UNAUTHORIZED"}\n\n', {
      status: 401,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  const userId = actor.userId;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller closed (client gone) — cleanup runs via cancel().
        }
      };

      // Opening comment frame: flips the client EventSource to "open" immediately.
      send(': connected\n\n');

      // Forward bus events for this user as named SSE events.
      unsubscribe = subscribe(userId, (e: StreamEvent) => {
        send(`event: ${e.type}\ndata: ${JSON.stringify({ ...e.data, ts: e.ts })}\n\n`);
      });

      // Heartbeat comment keeps intermediaries from closing an idle stream.
      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
    },
    cancel() {
      // Client disconnected — release the subscription + timer so we don't leak.
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe = null;
      heartbeat = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so frames flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
