import { createServer } from 'node:http';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { runTick, tx, currentDay } from './src/game.js';
import { ensureBots, runBots } from './src/bots.js';

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || './data/game.db';
// Ile sekund rzeczywistych trwa jeden dzień gry.
const TICK_SECONDS = Number(process.env.TICK_SECONDS) || 60;
// Ile linii komputerowych gra w świecie (0-6).
const BOTS = Math.min(6, Math.max(0, Number(process.env.BOTS ?? 3)));

const db = openDb(DB_FILE);
tx(db, () => ensureBots(db, BOTS, currentDay(db)));
// Kiedy wypadnie następny dzień gry: interfejs pokazuje graczom odliczanie.
const clock = { tickSeconds: TICK_SECONDS, nextTickAt: Date.now() + TICK_SECONDS * 1000 };
const handler = createApp({ db, clock, secureCookies: process.env.COOKIE_SECURE === '1' });

setInterval(() => {
  clock.nextTickAt = Date.now() + TICK_SECONDS * 1000;
  try {
    tx(db, () => runBots(db, currentDay(db) + 1, Math.random));
    const day = runTick(db);
    if (day % 10 === 0) console.log(`Dzień gry ${day}`);
  } catch (e) {
    console.error('Błąd symulacji', e);
  }
}, TICK_SECONDS * 1000);

createServer(handler).listen(PORT, () => {
  console.log(`Gra działa na http://localhost:${PORT} (1 dzień gry = ${TICK_SECONDS}s)`);
});
