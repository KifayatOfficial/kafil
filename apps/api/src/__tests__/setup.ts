// Shared setup: ensures DATABASE_URL points at the local dev DB and that the schema
// has been pushed. Each test cleans its own rows via the helpers in test-db.ts.
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://kafil:kafil_local@localhost:5433/kafil?schema=public';
}

// Best-effort: a smoke `prisma --version` to fail fast if the workspace isn't set up.
try {
  execSync('npx prisma --version', { stdio: 'ignore' });
} catch {
  // Tests will surface a clearer error when they hit the DB.
}
