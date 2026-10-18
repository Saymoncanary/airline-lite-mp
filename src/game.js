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
  // Klasy podróży: ile miejsc ekonomicznych zajmuje jeden fotel danej klasy.
  classSpace: { y: 1, j: 2, f: 3 },
  fuelShare: 0.6, // jaka część kosztu za km to paliwo (zależy od ceny paliwa)
  deliveryDays: { turbo: 3, regional: 4, narrow: 5, wide: 8 },
  maintenanceDays: 2,
  usedMarketSize: 12, // ile ofert używanych samolotów wystawia broker
  allianceMaxMembers: 8,
  codeshareBonus: 1.15, // atrakcyjność trasy, gdy partner z sojuszu ma bazę na jej końcu
  connectShare: 0.35, // jaka część popytu bez lotu bezpośredniego wybierze przesiadkę
  connectDiscount: 0.8, // bilet z przesiadką kosztuje tyle co suma obu odcinków razy ta liczba
  connectMaxDetour: 1.5, // przesiadka ma sens, gdy trasa przez hub jest najwyżej o 50% dłuższa
};

export const CLASSES = ['y', 'j', 'f'];
export const CLASS_NAMES = { y: 'ekonomiczna', j: 'biznes', f: 'pierwsza' };

// Popyt i ceny zależą od miesiąca: wakacje i święta to szczyt, zima to dołek.
const SEASON = [0.85, 0.85, 0.95, 1, 1.05, 1.15, 1.25, 1.25, 1.05, 1, 0.95, 1.1];
export const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

export function gameMonth(day) {
  return new Date(Date.UTC(2027, 0, 1) + day * 864e5).getUTCMonth();
}
export function seasonMult(day) {
  return SEASON[gameMonth(day)];
}

export function distanceKm(a, b) {
  const A = AIRPORTS[a], B = AIRPORTS[b];
  const rad = Math.PI / 180;
  const dLat = (B.lat - A.lat) * rad, dLon = (B.lon - A.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

// Cena referencyjna biletu ekonomicznego w jedną stronę: przy niej popyt jest "normalny".
export function baseFare(dist) {
  return Math.round(40 + 0.1 * dist ** 0.97);
}

// Cena referencyjna w danej klasie. Na długich trasach klasy premium są relatywnie droższe.
export function classFare(cls, dist) {
  const long = dist >= 2000;
  const mult = { y: 1, j: long ? 3 : 2.5, f: long ? 6 : 4 }[cls];
  return Math.round(baseFare(dist) * mult);
}

// Dzienny popyt pasażerów w jedną stronę przy cenie referencyjnej (wszystkie klasy razem).
export function dailyDemand(a, b) {
  const d = distanceKm(a, b);
  const f = d < 200 ? 0.3 : d < 500 ? 0.7 : d < 3000 ? 1 : d < 8000 ? 0.8 : 0.6;
  return Math.round(12 * AIRPORTS[a].size * AIRPORTS[b].size * f);
}

// Jaka część pasażerów chce lecieć daną klasą.
export function classShare(cls, dist) {
  const f = dist < 2000 ? 0.01 : 0.04;
  const j = dist < 2000 ? 0.08 : 0.15;
  return { y: 1 - f - j, j, f }[cls];
}

// Ile rotacji (lot tam i z powrotem) dziennie zrobi samolot na danej trasie.
// Godziny na dobę, które zajmuje jedna rotacja (lot tam i z powrotem z obsługą).
export function roundTripHours(type, dist) {
  return 2 * (dist / type.speed + RULES.turnaroundHours);
}

// Ile rotacji dziennie zmieści się w podanej liczbie wolnych godzin.
export function maxRoundTrips(type, dist, hoursLeft = RULES.operatingHours) {
  const rtHours = roundTripHours(type, dist);
  const n = Math.floor(hoursLeft / rtHours + 1e-9);
  if (n >= 1) return n;
  return rtHours / 2 <= hoursLeft + 1e-9 ? 0.5 : 0; // rejs co drugi dzień
}

// Koszt jednego lotu (w jedną stronę): paliwo/obsługa + opłaty lotniskowe.
// fuel to indeks ceny paliwa (1 = normalna cena).
// Składniki dziennego wyniku linii zapisywane w daily_stats.detail.
export const COST_PARTS = ['rev_y', 'rev_j', 'rev_f', 'fuel', 'ops', 'fees', 'fixed', 'lease', 'maint', 'interest'];

export function legCost(type, dist, fuel = 1) {
  const c = legCostParts(type, dist, fuel);
  return c.fuel + c.ops + c.fees;
}

// To samo w podziale na paliwo, obsługę techniczną/załogę i opłaty lotniskowe.
export function legCostParts(type, dist, fuel = 1) {
  return {
    fuel: type.costPerKm * dist * RULES.fuelShare * fuel,
    ops: type.costPerKm * dist * (1 - RULES.fuelShare),
    fees: 500 + type.seats * 8,
  };
}

export function leaseDaily(type) {
  return type.price * RULES.leaseDailyPct;
}

export function aircraftValue(type, ageDays, condition = 100) {
  return Math.round(type.price * Math.max(0.3, 0.9 - (ageDays / 365) * 0.03) * (0.7 + (0.3 * condition) / 100));
}

// Rozkład foteli w samolocie: biznes i pierwsza zajmują więcej miejsca niż ekonomiczna.
export function seatMap(type, j = 0, f = 0) {
  return { y: Math.max(0, type.seats - j * RULES.classSpace.j - f * RULES.classSpace.f), j, f };
}
export function validSeatConfig(type, j, f) {
  return Number.isInteger(j) && Number.isInteger(f) && j >= 0 && f >= 0 && j * RULES.classSpace.j + f * RULES.classSpace.f <= type.seats;
}

// Koszt przeglądu rośnie z zużyciem samolotu.
export function maintenanceCost(type, condition) {
  return Math.round(type.price * 0.0004 * (100 - condition) + 20000);
}

// Dzienne zużycie: latający samolot zużywa się szybciej niż stojący w hangarze.
export function dailyWear(roundTrips) {
  return roundTrips > 0 ? 0.1 + 0.12 * roundTrips : 0.02;
}

export function routePrices(r) {
  const dist = distanceKm(r.origin, r.dest);
  return { y: r.price, j: r.price_j ?? classFare('j', dist), f: r.price_f ?? classFare('f', dist) };
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
  const owned = db.prepare('SELECT type_id, acquired_day, condition FROM aircraft WHERE airline_id = ? AND leased = 0').all(airline.id);
  const fleet = owned.reduce((s, a) => s + aircraftValue(AIRCRAFT_TYPES[a.type_id], Math.max(0, day - a.acquired_day), a.condition), 0);
  return airline.cash - airline.debt + fleet;
}

export function activeEvents(db, day = currentDay(db)) {
  return db.prepare('SELECT * FROM events WHERE start_day <= ? AND end_day >= ? ORDER BY id').all(day, day);
}

// Mnożnik popytu z wydarzeń dotyczących któregoś z końców trasy.
export function eventMult(events, a, b) {
  let m = 1;
  for (const e of events) {
    const hit = e.kind === 'airport' ? e.target === a || e.target === b
      : e.kind === 'region' ? AIRPORTS[a].region === e.target || AIRPORTS[b].region === e.target
        : false;
    if (hit) m *= e.mult;
  }
  return m;
}

// Rozdziela popyt na danej parze miast pomiędzy konkurujące linie.
// Atrakcyjność oferty zależy od ceny (względem ceny referencyjnej), reputacji linii i premii sojuszu.
export function allocateMarket(demand, base, offers) {
  const seats = offers.reduce((s, o) => s + o.seats, 0);
  if (seats <= 0) return offers.map(() => 0);
  const avgPrice = offers.reduce((s, o) => s + o.price * o.seats, 0) / seats;
  const market = demand * Math.min(1.6, Math.max(0.05, (base / avgPrice) ** 1.3));
  const w = offers.map((o) => o.seats * (base / o.price) ** 2 * (0.5 + o.reputation / 100) * (o.bonus || 1));
  const W = w.reduce((s, x) => s + x, 0);
  const pax = offers.map((o, i) => Math.min(o.seats, (market * w[i]) / W));
  // Pasażerowie, którzy nie zmieścili się u wybranej linii, próbują u pozostałych.
  const left = market - pax.reduce((s, x) => s + x, 0);
  const spare = offers.map((o, i) => (o.seats - pax[i] > 0 ? w[i] : 0));
  const S = spare.reduce((s, x) => s + x, 0);
  if (left > 0 && S > 0) {
    offers.forEach((o, i) => {
      if (spare[i]) pax[i] = Math.min(o.seats, pax[i] + (left * spare[i]) / S);
    });
  }
  return pax;
}

// Pasażerowie z przesiadką: gdy linia lata A–hub i hub–B, część ludzi chcących lecieć A–B
// (bez lotu bezpośredniego) kupi bilet z przesiadką i zajmie wolne miejsca ekonomiczne na obu odcinkach.
function connectPassengers(routes, airlines, directMarkets, season, events) {
  const byAirline = new Map();
  for (const r of routes.values()) {
    if (!byAirline.has(r.airline_id)) byAirline.set(r.airline_id, []);
    byAirline.get(r.airline_id).push(r);
  }
  const options = [];
  for (const [airlineId, list] of byAirline) {
    const byAirport = new Map();
    for (const r of list) for (const ap of [r.origin, r.dest]) {
      if (!byAirport.has(ap)) byAirport.set(ap, []);
      byAirport.get(ap).push(r);
    }
    const seen = new Set();
    for (const [hub, rs] of byAirport) {
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].origin === hub ? rs[i].dest : rs[i].origin, b = rs[j].origin === hub ? rs[j].dest : rs[j].origin;
        const key = pairKey(a, b);
        if (a === b || seen.has(key)) continue;
        const dist = distanceKm(a, b), via = rs[i].dist + rs[j].dist;
        if (dist < 300 || via > dist * RULES.connectMaxDetour) continue;
        seen.add(key);
        options.push({ airlineId, key, a, b, dist, via, legs: [rs[i], rs[j]] });
      }
    }
  }
  const sellers = new Map(); // ile linii oferuje przesiadkę na tej parze miast
  for (const o of options) sellers.set(o.key, (sellers.get(o.key) || 0) + 1);
  for (const o of options) {
    const free = Math.min(...o.legs.map((r) => 2 * r.seats.y - r.pax.y));
    if (free < 1) continue;
    let demand = 2 * dailyDemand(o.a, o.b) * classShare('y', o.dist) * season * eventMult(events, o.a, o.b) * RULES.connectShare;
    if (directMarkets.has(o.key)) demand *= 0.3; // większość wybierze lot bezpośredni
    demand /= sellers.get(o.key);
    const price = (o.legs[0].prices.y + o.legs[1].prices.y) * RULES.connectDiscount;
    const al = airlines.get(o.airlineId);
    const pax = Math.floor(allocateMarket(demand, classFare('y', o.dist), [{ seats: free, price, reputation: al.reputation }])[0]);
    if (pax < 1) continue;
    for (const r of o.legs) {
      const rev = pax * price * (r.dist / o.via);
      r.pax.y += pax;
      r.rev.y += rev;
      r.revenue += rev;
      r.transfer += pax;
    }
  }
}

// --- Wydarzenia losowe ------------------------------------------------------
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi, rng) => Math.round(lo + rng() * (hi - lo));

function randomEvent(rng, day) {
  const airports = Object.values(AIRPORTS);
  const big = airports.filter((a) => a.size >= 5);
  const regions = [...new Set(airports.map((a) => a.region))];
  const kinds = [
    () => {
      const a = pick(big, rng);
      return { kind: 'airport', target: a.code, mult: 0.3, len: between(2, 5, rng), text: `Strajk kontrolerów lotów: ${a.city} (${a.code}). Popyt na loty spada.` };
    },
    () => {
      const a = pick(big, rng);
      return { kind: 'airport', target: a.code, mult: 1.6, len: between(3, 7, rng), text: `Wielkie targi i koncerty: ${a.city} (${a.code}). Chętnych do podróży jest znacznie więcej.` };
    },
    () => {
      const r = pick(regions, rng);
      return { kind: 'region', target: r, mult: 0.7, len: between(10, 25, rng), text: `Kryzys gospodarczy w regionie: ${r}. Ludzie mniej podróżują.` };
    },
    () => {
      const r = pick(regions, rng);
      return { kind: 'region', target: r, mult: 1.25, len: between(10, 25, rng), text: `Boom turystyczny w regionie: ${r}. Popyt rośnie.` };
    },
    () => ({ kind: 'fuel', target: null, mult: 1.35, len: 0, text: 'Napięcia na rynku ropy: cena paliwa gwałtownie rośnie.' }),
    () => ({ kind: 'fuel', target: null, mult: 0.75, len: 0, text: 'Nadpodaż ropy: paliwo wyraźnie tanieje.' }),
  ];
  const e = pick(kinds, rng)();
  return { ...e, start_day: day, end_day: day + e.len };
}

// --- Rynek wtórny brokera -----------------------------------------------------
function refillUsedMarket(db, day, rng) {
  db.prepare('DELETE FROM used_listings WHERE aircraft_id IS NULL AND listed_day < ?').run(day - 30);
  const count = db.prepare('SELECT COUNT(*) AS n FROM used_listings WHERE aircraft_id IS NULL').get().n;
  const types = Object.values(AIRCRAFT_TYPES);
  const ins = db.prepare('INSERT INTO used_listings(type_id, age_days, condition, price, listed_day) VALUES (?, ?, ?, ?, ?)');
  for (let i = count; i < RULES.usedMarketSize; i++) {
    const t = pick(types, rng);
    const age = between(365 * 2, 365 * 20, rng);
    const condition = between(45, 95, rng);
    const price = Math.round(aircraftValue(t, age, condition) * (0.85 + rng() * 0.25) / 1e4) * 1e4;
    ins.run(t.id, age, condition, price, day);
  }
}

function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

export function runTick(db, rng = Math.random) {
  return tx(db, () => {
    const state = db.prepare('SELECT * FROM game_state WHERE id = 1').get();
    const day = state.day + 1;

    // Cena paliwa błądzi losowo, ale wraca w okolice normy.
    let fuel = state.fuel + 0.05 * (1 - state.fuel) + 0.025 * gaussian(rng);
    if (rng() < 0.08) {
      const e = randomEvent(rng, day);
      if (e.kind === 'fuel') fuel *= e.mult;
      db.prepare('INSERT INTO events(kind, target, start_day, end_day, mult, text) VALUES (?, ?, ?, ?, ?, ?)')
        .run(e.kind, e.target, e.start_day, e.end_day, e.mult, e.text);
      db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, e.text);
    }
    fuel = Math.min(2, Math.max(0.5, fuel));
    const events = activeEvents(db, day);
    const season = seasonMult(day);

    const airlines = new Map(
      db.prepare('SELECT a.*, m.alliance_id FROM airlines a LEFT JOIN alliance_members m ON m.airline_id = a.id').all()
        .map((a) => [a.id, { ...a, revenue: 0, costs: 0, pax: 0, seats: 0, condSum: 0, condN: 0, breakdowns: 0, parts: Object.fromEntries(COST_PARTS.map((k) => [k, 0])) }])
    );
    const basesByAirline = new Map();
    for (const b of db.prepare('SELECT * FROM bases').all()) {
      if (!basesByAirline.has(b.airline_id)) basesByAirline.set(b.airline_id, new Set());
      basesByAirline.get(b.airline_id).add(b.airport);
    }
    const routes = new Map(
      db.prepare('SELECT * FROM routes').all().map((r) => [r.id, {
        ...r, dist: distanceKm(r.origin, r.dest), prices: routePrices(r),
        seats: { y: 0, j: 0, f: 0 }, cost: 0, pax: { y: 0, j: 0, f: 0 }, revenue: 0, rev: { y: 0, j: 0, f: 0 }, parts: { fuel: 0, ops: 0, fees: 0 }, transfer: 0,
      }])
    );

    // Automatyczne przeglądy samolotów, których stan spadł poniżej progu ustawionego przez gracza.
    const startMaint = db.prepare('UPDATE aircraft SET condition = 100, maintenance_until = ? WHERE id = ?');
    const updAc = db.prepare('UPDATE aircraft SET condition = ? WHERE id = ?');
    const flights = new Map();
    for (const f of db.prepare('SELECT * FROM flights').all()) {
      if (!flights.has(f.aircraft_id)) flights.set(f.aircraft_id, []);
      flights.get(f.aircraft_id).push(f);
    }
    for (const ac of db.prepare('SELECT * FROM aircraft').all()) {
      if (ac.delivery_day > day) continue; // jeszcze w fabryce
      const t = AIRCRAFT_TYPES[ac.type_id];
      const al = airlines.get(ac.airline_id);
      const inMaint = ac.maintenance_until >= day;
      if (!inMaint && al.auto_maint > 0 && ac.condition < al.auto_maint) {
        al.parts.maint += maintenanceCost(t, ac.condition);
        startMaint.run(day + RULES.maintenanceDays - 1, ac.id);
        al.condSum += 100;
        al.condN++;
        continue;
      }
      al.parts.fixed += t.dailyFixed * (1 + (100 - ac.condition) / 200);
      if (ac.leased) al.parts.lease += leaseDaily(t);
      al.condSum += ac.condition;
      al.condN++;
      const legs = (flights.get(ac.id) || []).map((f) => [routes.get(f.route_id), f.round_trips]).filter(([r]) => r);
      if (inMaint || !legs.length) {
        if (!inMaint) updAc.run(Math.max(0, ac.condition - dailyWear(0)), ac.id);
        continue;
      }
      // Mocno zużyty samolot może się zepsuć i nie polecieć.
      if (ac.condition < 30 && rng() < (30 - ac.condition) / 60) {
        al.breakdowns++;
        al.parts.maint += maintenanceCost(t, ac.condition) * 0.2;
        continue;
      }
      const s = seatMap(t, ac.seats_j, ac.seats_f);
      let trips = 0;
      for (const [r, n] of legs) {
        for (const c of CLASSES) r.seats[c] += s[c] * n;
        const c = legCostParts(t, r.dist, fuel);
        for (const k of ['fuel', 'ops', 'fees']) r.parts[k] += 2 * n * c[k];
        r.cost += 2 * n * (c.fuel + c.ops + c.fees);
        trips += n;
      }
      updAc.run(Math.max(0, ac.condition - dailyWear(trips)), ac.id);
    }

    const markets = new Map();
    for (const r of routes.values()) {
      const k = pairKey(r.origin, r.dest);
      if (!markets.has(k)) markets.set(k, []);
      markets.get(k).push(r);
    }
    for (const list of markets.values()) {
      const { origin, dest, dist } = list[0];
      const demand = dailyDemand(origin, dest) * season * eventMult(events, origin, dest);
      const bonus = (r) => {
        const al = airlines.get(r.airline_id);
        if (!al.alliance_id) return 1;
        for (const other of airlines.values()) {
          if (other.id === al.id || other.alliance_id !== al.alliance_id) continue;
          const b = basesByAirline.get(other.id);
          if (b && (b.has(origin) || b.has(dest))) return RULES.codeshareBonus;
        }
        return 1;
      };
      for (const c of CLASSES) {
        const flying = list.filter((r) => r.seats[c] > 0);
        if (!flying.length) continue;
        const offers = flying.map((r) => ({ seats: r.seats[c], price: r.prices[c], reputation: airlines.get(r.airline_id).reputation, bonus: bonus(r) }));
        const pax = allocateMarket(demand * classShare(c, dist), classFare(c, dist), offers);
        flying.forEach((r, i) => {
          r.pax[c] = Math.round(pax[i] * 2); // oba kierunki
          r.rev[c] = r.pax[c] * r.prices[c];
          r.revenue += r.rev[c];
        });
      }
    }

    connectPassengers(routes, airlines, new Set(markets.keys()), season, events);

    const updRoute = db.prepare('UPDATE routes SET last_pax = ?, last_seats = ?, last_revenue = ?, last_cost = ?, last_detail = ? WHERE id = ?');
    for (const r of routes.values()) {
      const pax = r.pax.y + r.pax.j + r.pax.f;
      const seats = Math.round(2 * (r.seats.y + r.seats.j + r.seats.f));
      const detail = { ...Object.fromEntries(CLASSES.map((c) => [c, { pax: r.pax[c], seats: Math.round(2 * r.seats[c]) }])), transfer: r.transfer };
      updRoute.run(pax, seats, r.revenue, r.cost, JSON.stringify(detail), r.id);
      const al = airlines.get(r.airline_id);
      al.revenue += r.revenue;
      for (const c of CLASSES) al.parts['rev_' + c] += r.rev[c];
      for (const k of ['fuel', 'ops', 'fees']) al.parts[k] += r.parts[k];
      al.pax += pax - r.transfer / 2; // pasażer z przesiadką leci dwoma odcinkami, liczymy go raz
      al.seats += seats;
    }

    const updAirline = db.prepare('UPDATE airlines SET cash = ?, reputation = ? WHERE id = ?');
    const insStat = db.prepare('INSERT OR REPLACE INTO daily_stats(airline_id, day, revenue, costs, pax, detail) VALUES (?, ?, ?, ?, ?, ?)');
    for (const al of airlines.values()) {
      al.parts.interest += (al.debt * RULES.loanInterestYear) / 365;
      al.costs = COST_PARTS.filter((k) => !k.startsWith('rev_')).reduce((s, k) => s + al.parts[k], 0);
      const profit = al.revenue - al.costs;
      const lf = al.seats ? al.pax / al.seats : 0;
      let rep = al.reputation;
      if (al.seats > 0) rep += profit > 0 && lf > 0.6 ? 0.15 : profit < 0 ? -0.2 : 0.05;
      if (al.condN && al.condSum / al.condN < 50) rep -= 0.15; // zaniedbana flota
      rep -= 0.3 * al.breakdowns;
      rep = Math.min(100, Math.max(0, rep));
      updAirline.run(al.cash + profit, rep, al.id);
      const detail = Object.fromEntries(Object.entries(al.parts).map(([k, v]) => [k, Math.round(v)]));
      insStat.run(al.id, day, al.revenue, al.costs, al.pax, JSON.stringify({ ...detail, seats: al.seats }));
    }

    refillUsedMarket(db, day, rng);
    db.prepare('DELETE FROM events WHERE end_day < ?').run(day - 30);
    db.prepare('DELETE FROM daily_stats WHERE day < ?').run(day - 60);
    db.prepare('DELETE FROM news WHERE id NOT IN (SELECT id FROM news ORDER BY id DESC LIMIT 200)').run();
    db.prepare('UPDATE game_state SET day = ?, fuel = ? WHERE id = 1').run(day, fuel);
    return day;
  });
}
