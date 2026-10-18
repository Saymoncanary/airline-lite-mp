// Komputerowi rywale: linie sterowane przez grę, żeby nawet mała grupa graczy miała konkurencję.
// Boty grają według tych samych zasad co ludzie: kupują i leasingują samoloty, otwierają trasy
// ze swojej bazy, ustawiają ceny według obłożenia i zamykają trasy, które się nie opłacają.
import { AIRPORTS, AIRCRAFT_TYPES } from './data.js';
import {
  RULES, distanceKm, dailyDemand, classFare, maxRoundTrips, roundTripHours, leaseDaily, isSlotAirport, pairKey,
} from './game.js';

const BOTS = [
  { name: 'Euro Sky', code: 'ES', hub: 'MUC', color1: '#0f766e', color2: '#facc15', logo: '✦' },
  { name: 'Orient Air', code: 'OR', hub: 'DOH', color1: '#7f1d1d', color2: '#fbbf24', logo: '☀' },
  { name: 'Atlantic Wings', code: 'AW', hub: 'YYZ', color1: '#1e3a8a', color2: '#e11d48', logo: '❄' },
  { name: 'Iberia Sol', code: 'IS', hub: 'MAD', color1: '#b45309', color2: '#7f1d1d', logo: '●' },
  { name: 'Pacific Star', code: 'PS', hub: 'SYD', color1: '#0369a1', color2: '#f97316', logo: '★' },
  { name: 'Andes Air', code: 'AN', hub: 'LIM', color1: '#4d7c0f', color2: '#fde047', logo: '▲' },
];
// Typy, które kupują boty, od najkrótszego zasięgu.
const BOT_TYPES = ['ATR72', 'E190', 'A320C', 'B738', 'A321', 'B788', 'B789', 'A359'];
const MAX_FLEET = 30;

// Zakłada brakujące linie komputerowe (count = ile ma ich być w grze).
export function ensureBots(db, count, day) {
  for (const b of BOTS.slice(0, count)) {
    if (db.prepare('SELECT 1 FROM airlines WHERE code = ? OR name = ?').get(b.code, b.name)) continue;
    let user = db.prepare('SELECT id, retired FROM users WHERE username = ?').get(`bot-${b.code}`);
    if (user?.retired) continue; // przejęta przez gracza: wraca dopiero w nowym sezonie
    if (!user) {
      // Pusty hash: na konto bota nie da się zalogować.
      const r = db.prepare("INSERT INTO users(username, pass_hash, salt, created_at, is_bot) VALUES (?, '', 'bot', ?, 1)").run(`bot-${b.code}`, Date.now());
      user = { id: Number(r.lastInsertRowid) };
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO airlines(user_id, name, code, hub, cash, founded_day, color1, color2, logo, service) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3)'
    ).run(user.id, b.name, b.code, b.hub, RULES.startingCash, day, b.color1, b.color2, b.logo);
    db.prepare('INSERT INTO bases(airline_id, airport) VALUES (?, ?)').run(Number(lastInsertRowid), b.hub);
    db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, `Nowa linia ${b.name} (${b.code}) startuje! Baza: ${AIRPORTS[b.hub].city} (${b.hub}).`);
  }
}

// Ruchy botów na początku dnia gry.
export function runBots(db, day, rng) {
  const bots = db.prepare('SELECT a.* FROM airlines a JOIN users u ON u.id = a.user_id WHERE u.is_bot = 1').all();
  for (const al of bots) {
    adjustPrices(db, al);
    dropBadRoutes(db, al, day);
    useIdleAircraft(db, al, day);
    expandFleet(db, al, day, rng);
  }
}

// Ceny w górę przy pełnych samolotach, w dół przy pustych (w granicach 75-140% ceny referencyjnej).
function adjustPrices(db, al) {
  for (const r of db.prepare('SELECT * FROM routes WHERE airline_id = ? AND last_seats > 0').all(al.id)) {
    const lf = r.last_pax / r.last_seats, dist = distanceKm(r.origin, r.dest);
    const f = lf > 0.95 ? 1.04 : lf < 0.6 ? 0.96 : 1;
    if (f === 1) continue;
    const clamp = (p, c) => Math.round(Math.min(classFare(c, dist) * 1.4, Math.max(classFare(c, dist) * 0.75, p * f)));
    db.prepare('UPDATE routes SET price = ?, price_j = ?, price_f = ? WHERE id = ?')
      .run(clamp(r.price, 'y'), clamp(r.price_j ?? classFare('j', dist), 'j'), clamp(r.price_f ?? classFare('f', dist), 'f'), r.id);
  }
}

// Trasy, które od tygodnia przynoszą stratę na lotach, są zamykane, a bot przez 60 dni do nich nie wraca.
// Jeden słabszy dzień (strajk, awaria, gorszy sezon) nie wystarcza.
function dropBadRoutes(db, al, day) {
  for (const r of db.prepare('SELECT * FROM routes WHERE airline_id = ? AND last_seats > 0').all(al.id)) {
    const loss = r.last_revenue < r.last_cost * 0.9 ? r.loss_days + 1 : 0;
    if (loss >= 7 && r.created_day < day - 7) {
      db.prepare('DELETE FROM routes WHERE id = ?').run(r.id);
      const other = r.origin === al.hub ? r.dest : r.origin;
      db.prepare('INSERT OR REPLACE INTO bot_avoid(airline_id, airport, until_day) VALUES (?, ?, ?)').run(al.id, other, day + 60);
    } else if (loss !== r.loss_days) {
      db.prepare('UPDATE routes SET loss_days = ? WHERE id = ?').run(loss, r.id);
    }
  }
}

// Najlepsze jeszcze nieobsługiwane kierunki z bazy: duży popyt, mało konkurencji, bez limitu slotów.
function destinations(db, al, maxRange) {
  const mine = new Set(db.prepare('SELECT origin, dest FROM routes WHERE airline_id = ?').all(al.id).map((r) => pairKey(r.origin, r.dest)));
  const avoid = new Set(db.prepare('SELECT airport FROM bot_avoid WHERE airline_id = ? AND until_day > (SELECT day FROM game_state WHERE id = 1)').all(al.id).map((r) => r.airport));
  const rivals = new Map();
  for (const r of db.prepare('SELECT origin, dest FROM routes WHERE airline_id != ?').all(al.id)) {
    const k = pairKey(r.origin, r.dest);
    rivals.set(k, (rivals.get(k) || 0) + 1);
  }
  return Object.values(AIRPORTS)
    .filter((a) => a.code !== al.hub && !isSlotAirport(a.code) && !avoid.has(a.code) && !mine.has(pairKey(al.hub, a.code)))
    .map((a) => {
      const dist = distanceKm(al.hub, a.code);
      return { code: a.code, dist, score: (dailyDemand(al.hub, a.code) * classFare('y', dist)) / (1 + (rivals.get(pairKey(al.hub, a.code)) || 0)) };
    })
    .filter((d) => d.dist >= 300 && d.dist <= maxRange)
    .sort((x, y) => y.score - x.score);
}

// Samoloty bez tras dostają nową trasę z bazy (albo dołączają do istniejącej, gdy brakuje miejsc).
function useIdleAircraft(db, al, day) {
  const idle = db.prepare(
    `SELECT * FROM aircraft a WHERE airline_id = ? AND delivery_day <= ? AND maintenance_until < ?
     AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.aircraft_id = a.id)`
  ).all(al.id, day, day);
  for (const ac of idle) {
    const t = AIRCRAFT_TYPES[ac.type_id];
    // Najpierw trasy, na których samoloty były pełne.
    let route = db.prepare('SELECT * FROM routes WHERE airline_id = ? AND last_seats > 0 AND last_pax >= last_seats * 0.95 ORDER BY last_revenue DESC').all(al.id)
      .find((r) => distanceKm(r.origin, r.dest) <= t.rangeKm);
    if (!route) {
      const d = destinations(db, al, t.rangeKm)[0];
      if (!d) continue;
      const { lastInsertRowid } = db.prepare('INSERT INTO routes(airline_id, origin, dest, price, price_j, price_f, created_day) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(al.id, al.hub, d.code, classFare('y', d.dist), classFare('j', d.dist), classFare('f', d.dist), day);
      db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, `${al.name} otwiera trasę ${AIRPORTS[al.hub].city} – ${AIRPORTS[d.code].city}.`);
      route = { id: Number(lastInsertRowid), origin: al.hub, dest: d.code };
    }
    const n = maxRoundTrips(t, distanceKm(route.origin, route.dest));
    if (n > 0) db.prepare('INSERT OR IGNORE INTO flights(aircraft_id, route_id, round_trips) VALUES (?, ?, ?)').run(ac.id, route.id, n);
  }
}

// Gdy nie ma wolnych samolotów i są pieniądze, bot zamawia kolejny pod najlepszy wolny kierunek.
function expandFleet(db, al, day, rng) {
  const fleet = db.prepare('SELECT COUNT(*) AS n, SUM(delivery_day > ?) AS waiting FROM aircraft WHERE airline_id = ?').get(day, al.id);
  if (fleet.n >= MAX_FLEET || fleet.waiting > 0 || rng() < 0.5) return;
  // Pierwszy z najlepszych kierunków, pod który bot znajdzie samolot i ma na niego pieniądze.
  const reserve = 15e6;
  let t = null, mode = null;
  for (const d of destinations(db, al, 14000).slice(0, 8)) {
    t = BOT_TYPES.map((id) => AIRCRAFT_TYPES[id]).find((x) => x.rangeKm >= d.dist * 1.05 && roundTripHours(x, d.dist) <= 2 * RULES.operatingHours);
    if (!t) continue;
    if (al.cash >= t.price + reserve) mode = 'buy';
    else if (al.cash >= t.price * RULES.leaseDepositPct + reserve + leaseDaily(t) * 30) mode = 'lease';
    if (mode) break;
  }
  if (!mode) return;
  const cost = mode === 'buy' ? t.price : t.price * RULES.leaseDepositPct;
  const delivery = day + RULES.deliveryDays[t.cat];
  db.prepare('UPDATE airlines SET cash = cash - ? WHERE id = ?').run(cost, al.id);
  db.prepare('INSERT INTO aircraft(airline_id, type_id, leased, acquired_day, delivery_day) VALUES (?, ?, ?, ?, ?)')
    .run(al.id, t.id, mode === 'lease' ? 1 : 0, delivery, delivery);
  db.prepare('INSERT INTO ledger(airline_id, day, amount, text) VALUES (?, ?, ?, ?)')
    .run(al.id, day, -cost, `${mode === 'buy' ? 'Zakup' : 'Leasing (wpłata)'}: ${t.name}`);
}
