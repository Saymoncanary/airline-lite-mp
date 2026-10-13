// Ekonomia i symulacja gry. Jeden "tick" serwera = jeden dzień gry.
import { AIRPORTS, AIRCRAFT_TYPES } from './data.js';

export const RULES = {
  startingCash: 200e6,
  maxDebt: 300e6,
  loanInterestYear: 0.06,
  leaseDepositPct: 0.05, // jednorazowa opłata przy leasingu
  leaseDailyPct: 0.00015, // dzienna rata leasingu (od ceny samolotu)
  earlyReturnLeaseDays: 30, // kara za zwrot leasingu = tyle dni rat
  operatingHours: 20, // ile godzin na dobę samolot może latać
  turnaroundHours: 1, // obsługa naziemna po każdym locie
  baseCostPerSize: 2e6, // koszt nowej bazy = wielkość lotniska * ta kwota
};

export function distanceKm(a, b) {
  const A = AIRPORTS[a], B = AIRPORTS[b];
  const rad = Math.PI / 180;
  const dLat = (B.lat - A.lat) * rad, dLon = (B.lon - A.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

// Cena referencyjna biletu w jedną stronę: przy niej popyt jest "normalny".
export function baseFare(dist) {
  return Math.round(40 + 0.1 * dist ** 0.97);
}

// Dzienny popyt pasażerów w jedną stronę przy cenie referencyjnej.
export function dailyDemand(a, b) {
  const d = distanceKm(a, b);
  const f = d < 200 ? 0.3 : d < 500 ? 0.7 : d < 3000 ? 1 : d < 8000 ? 0.8 : 0.6;
  return Math.round(12 * AIRPORTS[a].size * AIRPORTS[b].size * f);
}

// Ile rotacji (lot tam i z powrotem) dziennie zrobi samolot na danej trasie.
export function maxRoundTrips(type, dist) {
  const rtHours = 2 * (dist / type.speed + RULES.turnaroundHours);
  const n = Math.floor(RULES.operatingHours / rtHours);
  if (n >= 1) return n;
  return rtHours <= 2 * RULES.operatingHours ? 0.5 : 0; // rejs co drugi dzień
}

// Koszt jednego lotu (w jedną stronę): paliwo/obsługa + opłaty lotniskowe.
export function legCost(type, dist) {
  return type.costPerKm * dist + 500 + type.seats * 8;
}

export function leaseDaily(type) {
  return type.price * RULES.leaseDailyPct;
}

export function aircraftValue(type, ageDays) {
  return Math.round(type.price * Math.max(0.3, 0.9 - (ageDays / 365) * 0.03));
}

export function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function currentDay(db) {
  return db.prepare('SELECT day FROM game_state WHERE id = 1').get().day;
}

export function addNews(db, text) {
  db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(currentDay(db), text);
}

export function companyValue(db, airline, day = currentDay(db)) {
  const owned = db.prepare('SELECT type_id, acquired_day FROM aircraft WHERE airline_id = ? AND leased = 0').all(airline.id);
  const fleet = owned.reduce((s, a) => s + aircraftValue(AIRCRAFT_TYPES[a.type_id], day - a.acquired_day), 0);
  return airline.cash - airline.debt + fleet;
}

// Rozdziela popyt na danej parze miast pomiędzy konkurujące linie.
// Atrakcyjność oferty zależy od ceny (względem ceny referencyjnej) i reputacji linii.
export function allocateMarket(demand, base, offers) {
  const seats = offers.reduce((s, o) => s + o.seats, 0);
  if (seats <= 0) return offers.map(() => 0);
  const avgPrice = offers.reduce((s, o) => s + o.price * o.seats, 0) / seats;
  const market = demand * Math.min(1.6, Math.max(0.05, (base / avgPrice) ** 1.3));
  const w = offers.map((o) => o.seats * (base / o.price) ** 2 * (0.5 + o.reputation / 100));
  const W = w.reduce((s, x) => s + x, 0);
  const pax = offers.map((o, i) => Math.min(o.seats, (market * w[i]) / W));
  // Pasażerowie, którzy nie zmieścili się u wybranej linii, próbują u pozostałych.
  let left = market - pax.reduce((s, x) => s + x, 0);
  const spare = offers.map((o, i) => (o.seats - pax[i] > 0 ? w[i] : 0));
  const S = spare.reduce((s, x) => s + x, 0);
  if (left > 0 && S > 0) {
    offers.forEach((o, i) => {
      if (spare[i]) pax[i] = Math.min(o.seats, pax[i] + (left * spare[i]) / S);
    });
  }
  return pax;
}

export function runTick(db) {
  return tx(db, () => {
    const day = currentDay(db) + 1;
    const airlines = new Map(
      db.prepare('SELECT * FROM airlines').all().map((a) => [a.id, { ...a, revenue: 0, costs: 0, pax: 0, seats: 0 }])
    );
    const routes = new Map(
      db.prepare('SELECT * FROM routes').all().map((r) => [r.id, { ...r, dist: distanceKm(r.origin, r.dest), seatsDir: 0, cost: 0, pax: 0, revenue: 0 }])
    );

    for (const ac of db.prepare('SELECT * FROM aircraft').all()) {
      const t = AIRCRAFT_TYPES[ac.type_id];
      const al = airlines.get(ac.airline_id);
      al.costs += t.dailyFixed + (ac.leased ? leaseDaily(t) : 0);
      const r = ac.route_id && routes.get(ac.route_id);
      if (r) {
        r.seatsDir += t.seats * ac.round_trips;
        r.cost += 2 * ac.round_trips * legCost(t, r.dist);
      }
    }

    const markets = new Map();
    for (const r of routes.values()) {
      if (r.seatsDir <= 0) continue;
      const k = pairKey(r.origin, r.dest);
      if (!markets.has(k)) markets.set(k, []);
      markets.get(k).push(r);
    }
    for (const list of markets.values()) {
      const { origin, dest, dist } = list[0];
      const offers = list.map((r) => ({ seats: r.seatsDir, price: r.price, reputation: airlines.get(r.airline_id).reputation }));
      const pax = allocateMarket(dailyDemand(origin, dest), baseFare(dist), offers);
      list.forEach((r, i) => {
        r.pax = Math.round(pax[i] * 2); // oba kierunki
        r.revenue = r.pax * r.price;
      });
    }

    const updRoute = db.prepare('UPDATE routes SET last_pax = ?, last_seats = ?, last_revenue = ?, last_cost = ? WHERE id = ?');
    for (const r of routes.values()) {
      updRoute.run(r.pax, Math.round(r.seatsDir * 2), r.revenue, r.cost, r.id);
      const al = airlines.get(r.airline_id);
      al.revenue += r.revenue;
      al.costs += r.cost;
      al.pax += r.pax;
      al.seats += r.seatsDir * 2;
    }

    const updAirline = db.prepare('UPDATE airlines SET cash = ?, reputation = ? WHERE id = ?');
    const insStat = db.prepare('INSERT OR REPLACE INTO daily_stats(airline_id, day, revenue, costs, pax) VALUES (?, ?, ?, ?, ?)');
    for (const al of airlines.values()) {
      al.costs += (al.debt * RULES.loanInterestYear) / 365;
      const profit = al.revenue - al.costs;
      const lf = al.seats ? al.pax / al.seats : 0;
      let rep = al.reputation;
      if (al.seats > 0) rep += profit > 0 && lf > 0.6 ? 0.15 : profit < 0 ? -0.2 : 0.05;
      rep = Math.min(100, Math.max(0, rep));
      updAirline.run(al.cash + profit, rep, al.id);
      insStat.run(al.id, day, al.revenue, al.costs, al.pax);
    }

    db.prepare('DELETE FROM daily_stats WHERE day < ?').run(day - 60);
    db.prepare('DELETE FROM news WHERE id NOT IN (SELECT id FROM news ORDER BY id DESC LIMIT 200)').run();
    db.prepare('UPDATE game_state SET day = ? WHERE id = 1').run(day);
    return day;
  });
}
