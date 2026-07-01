import { TopNav } from '../../components/TopNav';
import { fetchList, DEMO_EMPLOYER } from '../../lib/serverApi';

interface Conversation {
  id: string;
  jobId: string | null;
  participants?: Array<{ userId: string; user?: { displayName: string } }>;
  lastMessage?: { body: string | null; createdAt: string } | null;
}

export default async function MessagesPage() {
  // View as the demo employer (a participant in the seeded conversation).
  const conversations = await fetchList<Conversation>('/api/conversations', 'conversations', DEMO_EMPLOYER);

  return (
    <div className="page">
      <TopNav active="/messages" />
      <main className="container">
        <div className="section-head">
          <h2>💬 Messages</h2>
          <span className="count-pill">{conversations.length}</span>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          On-platform chat (§5 anti-disintermediation) — contact info is auto-redacted. Chats are
          created when a worker is hired.
        </p>

        {conversations.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              💬
            </div>
            <p className="empty-title">No conversations yet</p>
            <p className="muted">A chat opens automatically when an employer hires a worker.</p>
          </div>
        ) : (
          <div className="list">
            {conversations.map((c) => (
              <a href={`/chat/${c.id}`} className="card conv-row" key={c.id}>
                <span className="conv-avatar" aria-hidden>
                  💬
                </span>
                <div style={{ flex: 1 }}>
                  <div className="job-title">Conversation</div>
                  <div className="muted">
                    {c.lastMessage?.body ? c.lastMessage.body.slice(0, 60) : 'Tap to open the thread'}
                  </div>
                </div>
                <span className="chip">Open →</span>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
