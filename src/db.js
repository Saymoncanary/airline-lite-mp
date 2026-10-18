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
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      target TEXT,
      start_day INTEGER NOT NULL,
      end_day INTEGER NOT NULL,
      mult REAL NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS used_listings (
      id INTEGER PRIMARY KEY,
      type_id TEXT NOT NULL,
      age_days INTEGER NOT NULL DEFAULT 0,
      condition REAL NOT NULL DEFAULT 100,
      price REAL NOT NULL,
      aircraft_id INTEGER UNIQUE REFERENCES aircraft(id) ON DELETE CASCADE,
      listed_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alliances (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      leader_id INTEGER NOT NULL REFERENCES airlines(id),
      created_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alliance_members (
      airline_id INTEGER PRIMARY KEY REFERENCES airlines(id) ON DELETE CASCADE,
      alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
      joined_day INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alliance_messages (
      id INTEGER PRIMARY KEY,
      alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Kolumny dodane w kolejnych wersjach gry: dopisujemy je do istniejących baz.
  const addColumn = (table, column, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  };
  addColumn('game_state', 'fuel', 'REAL NOT NULL DEFAULT 1');
  addColumn('airlines', 'auto_maint', 'INTEGER NOT NULL DEFAULT 50');
  addColumn('routes', 'price_j', 'REAL');
  addColumn('routes', 'price_f', 'REAL');
  addColumn('routes', 'last_detail', 'TEXT');
  addColumn('aircraft', 'seats_j', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('aircraft', 'seats_f', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('aircraft', 'condition', 'REAL NOT NULL DEFAULT 100');
  addColumn('aircraft', 'delivery_day', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('aircraft', 'maintenance_until', 'INTEGER NOT NULL DEFAULT 0');

  addColumn('daily_stats', 'detail', 'TEXT');
  addColumn('airlines', 'color1', "TEXT NOT NULL DEFAULT '#1d4ed8'");
  addColumn('airlines', 'color2', "TEXT NOT NULL DEFAULT '#dc2626'");
  addColumn('airlines', 'logo', "TEXT NOT NULL DEFAULT '★'");
  addColumn('game_state', 'season', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('game_state', 'season_end_day', 'INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS hall_of_fame (
      season INTEGER NOT NULL,
      place INTEGER NOT NULL,
      airline TEXT NOT NULL,
      code TEXT NOT NULL,
      owner TEXT NOT NULL,
      bot INTEGER NOT NULL,
      value REAL NOT NULL,
      day INTEGER NOT NULL,
      PRIMARY KEY (season, place)
    );
  `);
  addColumn('users', 'is_bot', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('airlines', 'total_pax', 'REAL NOT NULL DEFAULT 0');
  addColumn('airlines', 'wage', 'INTEGER NOT NULL DEFAULT 100');
  addColumn('airlines', 'service', 'INTEGER NOT NULL DEFAULT 2');
  addColumn('airlines', 'loyalty', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      airport TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (airline_id, airport)
    );
    CREATE TABLE IF NOT EXISTS achievements (
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      day INTEGER NOT NULL,
      PRIMARY KEY (airline_id, key)
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      country TEXT NOT NULL,
      level INTEGER NOT NULL,
      start_day INTEGER NOT NULL,
      end_day INTEGER NOT NULL
    );
  `);
  // Dziennik operacji gotówkowych poza codziennym wynikiem (zakupy, sprzedaż, kredyty...).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY,
      airline_id INTEGER NOT NULL REFERENCES airlines(id) ON DELETE CASCADE,
      day INTEGER NOT NULL,
      amount REAL NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_airline ON ledger(airline_id, id);
  `);

  // Samolot może latać na kilku trasach: przypisania trzymamy w osobnej tabeli.
  // Stare kolumny aircraft.route_id / round_trips przenosimy tu przy pierwszym starcie.
  db.exec(`
    CREATE TABLE IF NOT EXISTS flights (
      aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      round_trips REAL NOT NULL,
      PRIMARY KEY (aircraft_id, route_id)
    );
    INSERT OR IGNORE INTO flights(aircraft_id, route_id, round_trips)
      SELECT id, route_id, round_trips FROM aircraft WHERE route_id IS NOT NULL AND round_trips > 0;
    UPDATE aircraft SET route_id = NULL, round_trips = 0 WHERE route_id IS NOT NULL;
  `);
  return db;
}
