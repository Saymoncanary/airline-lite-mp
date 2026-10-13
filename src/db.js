import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS airlines (
      id INTEGER PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      code TEXT UNIQUE NOT NULL,
      hub TEXT NOT NULL,
      cash REAL NOT NULL,
      debt REAL NOT NULL DEFAULT 0,
      reputation REAL NOT NULL DEFAULT 50,
      founded_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bases (
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      airport TEXT NOT NULL,
      PRIMARY KEY (airline_id, airport)
    );
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY,
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      dest TEXT NOT NULL,
      price REAL NOT NULL,
      last_pax INTEGER NOT NULL DEFAULT 0,
      last_seats INTEGER NOT NULL DEFAULT 0,
      last_revenue REAL NOT NULL DEFAULT 0,
      last_cost REAL NOT NULL DEFAULT 0,
      created_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aircraft (
      id INTEGER PRIMARY KEY,
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      type_id TEXT NOT NULL,
      leased INTEGER NOT NULL,
      acquired_day INTEGER NOT NULL,
      route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
      round_trips REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      day INTEGER NOT NULL,
      revenue REAL NOT NULL,
      costs REAL NOT NULL,
      pax INTEGER NOT NULL,
      PRIMARY KEY (airline_id, day)
    );
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY,
      day INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      day INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO game_state (id, day) VALUES (1, 0);
  `);
  return db;
}
