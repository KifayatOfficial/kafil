import { TopNav } from '../../../components/TopNav';
import { fetchList, DEMO_WORKER } from '../../../lib/serverApi';
import { QuickForm } from '../../../components/QuickForm';
import { createPostAction } from '../../actions';

interface Post {
  id: string;
  kind: string;
  body: string | null;
  images: string[];
  pinned: boolean;
  commentCount: number;
  createdAt: string;
  author: { id: string; displayName: string; photoUrl: string | null };
}

const KIND_BADGE: Record<string, string> = {
  announcement: '📢 Announcement',
  offer: '🏷️ Offer',
  request: '🙋 Request',
  discussion: '💬 Discussion',
};

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // View as the demo worker (a group member, so the feed + posting work).
  const posts = await fetchList<Post>(`/api/groups/${id}/posts`, 'posts', DEMO_WORKER);

  return (
    <div className="page">
      <TopNav active="/community" />
      <main className="container" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <a href="/community" className="chip">
            ← Community
          </a>
          <h2 style={{ marginInlineStart: 8 }}>Group feed</h2>
          <span className="count-pill">{posts.length}</span>
          <span style={{ flex: 1 }} />
          <QuickForm action={createPostAction} openLabel="＋ New post" submitLabel="Post">
            <input type="hidden" name="groupId" value={id} />
            <select name="kind" className="input">
              <option value="discussion">💬 Discussion</option>
              <option value="announcement">📢 Announcement</option>
              <option value="offer">🏷️ Offer</option>
              <option value="request">🙋 Request</option>
            </select>
            <textarea name="body" className="input" placeholder="Share something with the group…" rows={3} maxLength={4000} />
          </QuickForm>
        </div>

        {posts.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              💬
            </div>
            <p className="empty-title">No posts yet</p>
            <p className="muted">Be the first to post in this group.</p>
          </div>
        ) : (
          <div className="list">
            {posts.map((p) => (
              <article className="card" key={p.id}>
                <div className="card-headline">
                  <strong>{p.author.displayName}</strong>
                  <span className="badge">{KIND_BADGE[p.kind] ?? p.kind}</span>
                </div>
                {p.pinned ? <span className="chip chip-rate">📌 Pinned</span> : null}
                {p.body ? <p className="job-desc" style={{ marginTop: 8 }}>{p.body}</p> : null}
                <div className="job-meta">
                  <span className="chip">💬 {p.commentCount} comments</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
