const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function openStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE,
      subscription_status TEXT, invite_hash TEXT UNIQUE, invite_expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_org_idx ON users(org_id);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenders (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      title TEXT NOT NULL, buyer TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
      value_eur REAL, deadline TEXT, status TEXT NOT NULL DEFAULT 'new',
      description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tenders_org_idx ON tenders(org_id);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      tender_id TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      title TEXT NOT NULL, due_date TEXT, done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_tender_idx ON tasks(tender_id);
  `);
  return db;
}

module.exports = { openStore };
