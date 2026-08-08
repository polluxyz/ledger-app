import { config } from 'dotenv';
import { resolve } from 'node:path';

// Runs in every jest worker before the app boots. Loads .env.test so the app
// connects to ledger_test. dotenv does not override variables already present,
// so in CI (where DATABASE_URL/JWT_SECRET come from the environment) this is a
// no-op and the CI values win.
config({ path: resolve(__dirname, '../.env.test') });
