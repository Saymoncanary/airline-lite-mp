import { createServer } from 'node:http';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { runTick } from './src/game.js';

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || './data/game.db';
// Ile sekund rzeczywistych trwa jeden dzień gry.
const TICK_SECONDS = Number(process.env.TICK_SECONDS) || 60;

const db = openDb(DB_FILE);
const handler = createApp({ db, secureCookies: process.env.COOKIE_SECURE === '1' });

setInterval(() => {
  try {
    const day = runTick(db);
    if (day % 10 === 0) console.log(`Dzień gry ${day}`);
  } catch (e) {
    console.error('Błąd symulacji', e);
  }
}, TICK_SECONDS * 1000);

createServer(handler).listen(PORT, () => {
  console.log(`Gra działa na http://localhost:${PORT} (1 dzień gry = ${TICK_SECONDS}s)`);
});
