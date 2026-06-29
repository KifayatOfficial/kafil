// Static health page so a browser visit confirms the server is alive.
export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, lineHeight: 1.6 }}>
      <h1>KAFIL API</h1>
      <p>If you can read this, the API is running.</p>
      <p>
        Try <code>GET /api/health</code>, <code>GET /api/jobs</code>, etc.
      </p>
      <p style={{ color: '#888', fontSize: 12 }}>
        Source of truth: KAFIL_SPEC_v1.1_ADDENDUM.md
      </p>
    </main>
  );
}
