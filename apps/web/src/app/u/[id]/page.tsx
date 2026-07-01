import { TopNav } from '../../../components/TopNav';
import { fetchJson } from '../../../lib/serverApi';

interface PublicUser {
  id: string;
  displayName: string;
  photoUrl: string | null;
  status: string;
  trustScore: number;
  kycLevel: number;
  roles: string[];
  workerProfile: { bio: string | null; experienceYears: number | null; rating: number } | null;
}

// Trust badges (§25.2) — glyph + label, never colour alone. PII (phone) is never shown
// here (P6): this is the public view of another user.
function badges(u: PublicUser): string[] {
  const out = ['📱 Phone verified']; // all users are phone-verified at signup
  if (u.kycLevel >= 2) out.push('🪪 CNIC verified');
  if (u.roles.includes('worker')) out.push('🔨 Worker');
  if (u.roles.includes('employer')) out.push('🏗️ Employer');
  if (u.roles.includes('shop_owner')) out.push('🏪 Shop owner');
  return out;
}

export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchJson<{ user: PublicUser }>(`/api/users/${id}`);
  const u = data?.user ?? null;

  return (
    <div className="page">
      <TopNav active="/profile" />
      <main className="container" style={{ maxWidth: 720 }}>
        {!u ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>👤</div>
            <p className="empty-title">Profile not available</p>
            <p className="muted">This user may not exist or is no longer active.</p>
          </div>
        ) : (
          <>
            <section className="profile-head card">
              <div className="profile-avatar" aria-hidden>{u.displayName.charAt(0)}</div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>{u.displayName}</h2>
                <div className="job-meta" style={{ marginTop: 8 }}>
                  {u.workerProfile?.rating ? (
                    <span className="chip chip-rate">★ {u.workerProfile.rating.toFixed(1)}</span>
                  ) : null}
                  <span className="chip">Trust {u.trustScore}</span>
                  <span className="chip">KYC L{u.kycLevel}</span>
                  <span className="chip chip-status">{u.status}</span>
                </div>
              </div>
            </section>

            <div className="section-head"><h2>Verification</h2></div>
            <div className="job-meta">
              {badges(u).map((b) => <span className="badge" key={b}>{b}</span>)}
            </div>

            {u.workerProfile ? (
              <>
                <div className="section-head"><h2>Worker profile</h2></div>
                <article className="card">
                  {u.workerProfile.bio ? <p style={{ marginTop: 0 }}>{u.workerProfile.bio}</p> : null}
                  <div className="job-meta">
                    {u.workerProfile.experienceYears != null ? (
                      <span className="chip">🧱 {u.workerProfile.experienceYears} yrs experience</span>
                    ) : null}
                  </div>
                </article>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
