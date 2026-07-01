import { TopNav } from '../../components/TopNav';
import { fetchList } from '../../lib/serverApi';
import { QuickForm } from '../../components/QuickForm';
import { createGroupAction } from '../actions';

interface Group {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  memberCount: number;
  postCount: number;
  location: { label: string; district: string | null } | null;
}

const CAT_GLYPH: Record<string, string> = {
  geographic: '📍',
  trade: '🔧',
  interest: '🌾',
  general: '💬',
};

export default async function CommunityPage() {
  const groups = await fetchList<Group>('/api/groups', 'groups');
  const members = groups.reduce((s, g) => s + (g.memberCount ?? 0), 0);
  const posts = groups.reduce((s, g) => s + (g.postCount ?? 0), 0);

  return (
    <div className="page">
      <TopNav active="/community" />
      <main className="container">
        <section className="stats">
          <div className="stat stat-primary">
            <div className="stat-value">{groups.length}</div>
            <div className="stat-label">Groups</div>
          </div>
          <div className="stat">
            <div className="stat-value">{members}</div>
            <div className="stat-label">Members</div>
          </div>
          <div className="stat stat-accent">
            <div className="stat-value">{posts}</div>
            <div className="stat-label">Posts</div>
          </div>
        </section>

        <div className="section-head">
          <h2>Community groups</h2>
          <span className="count-pill">{groups.length}</span>
          <span style={{ flex: 1 }} />
          <QuickForm action={createGroupAction} openLabel="＋ New group" submitLabel="Create group">
            <input name="name" className="input" placeholder="Group name (e.g. Welders of Mingora)" maxLength={200} />
            <select name="category" className="input">
              <option value="geographic">📍 Geographic</option>
              <option value="trade">🔧 Trade</option>
              <option value="interest">🌾 Interest</option>
              <option value="general">💬 General</option>
            </select>
            <textarea name="description" className="input" placeholder="What's this group about? (optional)" rows={2} maxLength={4000} />
          </QuickForm>
        </div>

        {groups.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              🏘️
            </div>
            <p className="empty-title">No groups yet</p>
            <p className="muted">Seed the database to populate the community.</p>
          </div>
        ) : (
          <div className="grid">
            {groups.map((g) => (
              <article className="card" key={g.id}>
                <div className="card-headline">
                  <h3 className="job-title">
                    {g.category ? `${CAT_GLYPH[g.category] ?? '💬'} ` : ''}
                    {g.name}
                  </h3>
                  {g.category ? <span className="badge">{g.category}</span> : null}
                </div>
                {g.description ? <p className="job-desc">{g.description}</p> : null}
                <div className="job-meta">
                  <span className="chip chip-rate">👥 {g.memberCount} members</span>
                  <span className="chip">📝 {g.postCount} posts</span>
                  {g.location?.district ? <span className="chip">📍 {g.location.district}</span> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
