import { TopNav } from '../../../components/TopNav';
import { fetchList, DEMO_EMPLOYER } from '../../../lib/serverApi';

interface Msg {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  flagged: boolean;
  createdAt: string;
}

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read the thread as the demo employer (a participant). The service gates on
  // participation, so a non-participant would get nothing.
  const messages = await fetchList<Msg>(`/api/conversations/${id}/messages`, 'messages', DEMO_EMPLOYER);

  return (
    <div className="page">
      <TopNav active="/messages" />
      <main className="container" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <a href="/messages" className="chip">
            ← Messages
          </a>
          <h2 style={{ marginInlineStart: 8 }}>Conversation</h2>
        </div>

        {messages.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              💬
            </div>
            <p className="empty-title">No messages</p>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m) => {
              const mine = m.senderId === DEMO_EMPLOYER;
              return (
                <div key={m.id} className={`bubble-row ${mine ? 'bubble-row-me' : ''}`}>
                  <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'}`}>{m.body}</div>
                </div>
              );
            })}
          </div>
        )}

        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          Read-only preview. Sending happens in the mobile app (POST stays strictly authenticated).
        </p>
      </main>
    </div>
  );
}
