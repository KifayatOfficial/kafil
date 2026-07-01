import { TopNav } from '../../components/TopNav';
import { fetchJson, DEMO_WORKER } from '../../lib/serverApi';
import { isSignedIn } from '../../lib/session';
import { QuickForm } from '../../components/QuickForm';
import { updateProfileAction } from '../actions';

interface Me {
  id: string;
  displayName: string;
  phoneE164: string;
  kycLevel: number;
  trustScore: number;
  status: string;
  roles: Array<{ role: string }>;
  workerProfile: { bio: string | null; experienceYears: number | null; ratingBayesian: string | number | null } | null;
  employerProfile: { orgName: string | null } | null;
}

// Trust badges (§25.2) — never colour alone; each is glyph + label.
function badges(me: Me) {
  const out: string[] = [];
  if (me.phoneE164) out.push('📱 Phone verified');
  if (me.kycLevel >= 2) out.push('🪪 CNIC verified');
  if (me.roles.some((r) => r.role === 'worker')) out.push('🔨 Worker');
  if (me.roles.some((r) => r.role === 'employer')) out.push('🏗️ Employer');
  return out;
}

export default async function ProfilePage() {
  // If signed in, /api/auth/me returns the REAL user (fetchJson uses their Bearer token);
  // otherwise it falls back to the demo worker so the page is populated in dev.
  const signedIn = await isSignedIn();
  const data = await fetchJson<{ user: Me }>('/api/auth/me', DEMO_WORKER);
  const me = data?.user ?? null;

  return (
    <div className="page">
      <TopNav active="/profile" />
      <main className="container" style={{ maxWidth: 720 }}>
        {!me ? (
          <div className="empty">
            <div className="empty-glyph" aria-hidden>
              👤
            </div>
            <p className="empty-title">No profile loaded</p>
            <p className="muted">Seed a worker profile to populate this page.</p>
          </div>
        ) : (
          <>
            <section className="profile-head card">
              <div className="profile-avatar" aria-hidden>
                {me.displayName.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div className="card-headline">
                  <h2 style={{ margin: 0 }}>{me.displayName}</h2>
                  {signedIn ? (
                    <QuickForm action={updateProfileAction} openLabel="✏️ Edit" submitLabel="Save">
                      <input name="displayName" className="input" placeholder="Display name" defaultValue={me.displayName} maxLength={120} />
                    </QuickForm>
                  ) : null}
                </div>
                <div className="muted">{me.phoneE164}</div>
                <div className="job-meta" style={{ marginTop: 8 }}>
                  {me.workerProfile?.ratingBayesian ? (
                    <span className="chip chip-rate">★ {Number(me.workerProfile.ratingBayesian).toFixed(1)}</span>
                  ) : null}
                  <span className="chip">Trust {me.trustScore}</span>
                  <span className="chip">KYC L{me.kycLevel}</span>
                  <span className="chip chip-status">{me.status}</span>
                </div>
                {!signedIn ? (
                  <p className="muted" style={{ marginTop: 8 }}>
                    Showing demo profile. <a href="/login" className="nav-link nav-link-active" style={{ padding: '2px 8px' }}>Sign in</a> to edit your own.
                  </p>
                ) : null}
              </div>
            </section>

            <div className="section-head">
              <h2>Verification</h2>
            </div>
            <div className="job-meta">
              {badges(me).map((b) => (
                <span className="badge" key={b}>
                  {b}
                </span>
              ))}
            </div>

            {me.workerProfile ? (
              <>
                <div className="section-head">
                  <h2>Worker profile</h2>
                </div>
                <article className="card">
                  {me.workerProfile.bio ? <p style={{ marginTop: 0 }}>{me.workerProfile.bio}</p> : null}
                  <div className="job-meta">
                    {me.workerProfile.experienceYears != null ? (
                      <span className="chip">🧱 {me.workerProfile.experienceYears} yrs experience</span>
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
