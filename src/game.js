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
  // Personel: pensje w % normy. Za niskie grożą strajkiem, wysokie poprawiają obsługę.
  wageMin: 80, wageMax: 140, staffShare: 0.45, // jaka część kosztów obsługi lotu to pensje załóg
  // Obsługa pokładowa: koszt na pasażera (premium ×3) i atrakcyjność dla klientów.
  serviceLevels: [
    { name: 'Podstawowa', costPerPax: 0, appeal: 0.88, rep: -0.08 },
    { name: 'Standardowa', costPerPax: 4, appeal: 1, rep: 0 },
    { name: 'Komfortowa', costPerPax: 9, appeal: 1.07, rep: 0.04 },
    { name: 'Premium', costPerPax: 16, appeal: 1.13, rep: 0.08 },
    { name: 'Luksusowa', costPerPax: 26, appeal: 1.18, rep: 0.12 },
  ],
  loyaltyCostShare: 0.02, loyaltyAppeal: 1.08, // program lojalnościowy: 2% przychodów, +8% atrakcyjności
  // Kampanie reklamowe w kraju: dzienny koszt, wzrost atrakcyjności i popytu na trasach do tego kraju.
  campaignLevels: [
    { name: 'Mała', costPerDay: 30e3, appeal: 1.08 },
    { name: 'Średnia', costPerDay: 90e3, appeal: 1.15 },
    { name: 'Duża', costPerDay: 250e3, appeal: 1.25 },
  ],
  campaignDays: 14, maxCampaigns: 5,
  // Sloty: na największych lotniskach każda rotacja dziennie wymaga slotu. Liczba slotów jest
  // ograniczona dla wszystkich linii razem, a cena rośnie, im mniej ich zostało.
  slotMinSize: 9, slotCapacity: { 9: 60, 10: 40 }, slotBasePrice: { 9: 1e6, 10: 1.5e6 }, slotSellBack: 0.5,
  hubFreeSlots: 10, // darmowe sloty dla nowej linii z bazą na takim lotnisku
  // Terminale w bazach: poziom 1-3; koszt kolejnego poziomu = wielkość lotniska × kwota.
  terminalMax: 3, terminalCost: [1e6, 2.5e6, 5e6], terminalUpkeep: 3000, // utrzymanie: × wielkość × poziom, dziennie
  terminalSlots: 10, terminalAppeal: 0.04, terminalTransfer: 0.3, // za każdy poziom
  maxCodeshares: 5, // umowy codeshare z liniami spoza sojuszu
  reportDays: 14,
  maxOrder: 20, // ile samolotów jednego typu można zamówić naraz
  takeoverPremium: 1.3, // cena przejęcia: wartość firmy × premia + dopłata za każdą trasę
  takeoverPerRoute: 1e6,
  takeoverMin: 10e6,
  takeoverOfferDays: 7, // tyle dni gry właściciel ma na odpowiedź na ofertę
};

// Kontynent lotniska (Rosję liczymy do Europy).
const REGION_CONTINENT = {
  'Turcja, Kaukaz': 'Azja', 'Rosja i Azja Centralna': 'Azja', 'Bliski Wschód': 'Azja', 'Azja Południowa': 'Azja',
  'Azja Wschodnia': 'Azja', 'Azja Południowo-Wschodnia': 'Azja', Afryka: 'Afryka', Oceania: 'Australia i Oceania',
  'Ameryka Północna': 'Ameryka Północna', 'Karaiby i Ameryka Środkowa': 'Ameryka Północna', 'Ameryka Południowa': 'Ameryka Południowa',
};
export const continentOf = (code) => (AIRPORTS[code].country === 'Rosja' ? 'Europa' : REGION_CONTINENT[AIRPORTS[code].region] || 'Europa');

// Cele i osiągnięcia: nagroda w gotówce przyznawana raz. progress(s) zwraca [ile jest, ile trzeba].
const goal = (key, name, desc, reward, progress) => ({ key, name, desc, reward, progress });
export const ACHIEVEMENTS = [
  goal('first_route', 'Pierwszy lot', 'Przewieź pierwszych pasażerów', 1e6, (s) => [s.paxDay, 1]),
  goal('own_plane', 'Na swoim', 'Miej własny (nie leasingowany) samolot', 2e6, (s) => [s.owned, 1]),
  goal('pax10k', '10 tysięcy pasażerów', 'Przewieź łącznie 10 000 pasażerów', 2e6, (s) => [s.totalPax, 1e4]),
  goal('pax100k', '100 tysięcy pasażerów', 'Przewieź łącznie 100 000 pasażerów', 5e6, (s) => [s.totalPax, 1e5]),
  goal('pax1m', 'Milion pasażerów', 'Przewieź łącznie 1 000 000 pasażerów', 20e6, (s) => [s.totalPax, 1e6]),
  goal('fleet10', 'Flota 10 samolotów', 'Miej 10 samolotów', 5e6, (s) => [s.fleet, 10]),
  goal('fleet25', 'Flota 25 samolotów', 'Miej 25 samolotów', 15e6, (s) => [s.fleet, 25]),
  goal('widebody', 'Dalekie rejsy', 'Miej samolot szerokokadłubowy', 3e6, (s) => [s.wide, 1]),
  goal('jumbo', 'Królowa przestworzy', 'Miej Boeinga 747 albo Airbusa A380', 5e6, (s) => [s.jumbo, 1]),
  goal('continents3', 'Trzy kontynenty', 'Lataj na trzy kontynenty', 5e6, (s) => [s.continents, 3]),
  goal('continents6', 'Cały świat', 'Lataj na wszystkie sześć kontynentów', 20e6, (s) => [s.continents, 6]),
  goal('bases5', 'Sieć baz', 'Miej 5 baz', 5e6, (s) => [s.bases, 5]),
  goal('alliance', 'Razem raźniej', 'Dołącz do sojuszu', 1e6, (s) => [s.alliance, 1]),
  goal('transfer500', 'Węzeł przesiadkowy', 'Obsłuż 500 pasażerów z przesiadką jednego dnia', 5e6, (s) => [s.transfer, 500]),
  goal('profit1m', 'Milion dziennie', 'Zarób $1 mln na czysto w jeden dzień', 5e6, (s) => [s.profit, 1e6]),
  goal('rep80', 'Ulubiona linia', 'Zdobądź reputację 80', 5e6, (s) => [s.reputation, 80]),
  goal('value500m', 'Pół miliarda', 'Osiągnij wartość firmy $500 mln', 10e6, (s) => [s.value, 5e8]),
  goal('value1b', 'Miliarder', 'Osiągnij wartość firmy $1 mld', 25e6, (s) => [s.value, 1e9]),
];

// Liczby, z których liczone są postępy celów danej linii.
export function achievementStats(db, al, day, last = {}) {
  const fleet = db.prepare('SELECT type_id, leased FROM aircraft WHERE airline_id = ? AND delivery_day <= ?').all(al.id, day);
  const routes = db.prepare('SELECT origin, dest, last_pax, last_detail FROM routes WHERE airline_id = ?').all(al.id);
  const continents = new Set(routes.filter((r) => r.last_pax > 0).flatMap((r) => [continentOf(r.origin), continentOf(r.dest)]));
  return {
    paxDay: routes.reduce((s, r) => s + r.last_pax, 0), totalPax: al.total_pax, fleet: fleet.length,
    owned: fleet.filter((a) => !a.leased).length,
    wide: fleet.filter((a) => AIRCRAFT_TYPES[a.type_id].cat === 'wide').length,
    jumbo: fleet.filter((a) => ['B748', 'A388'].includes(a.type_id)).length,
    continents: continents.size, bases: db.prepare('SELECT COUNT(*) AS n FROM bases WHERE airline_id = ?').get(al.id).n,
    alliance: db.prepare('SELECT COUNT(*) AS n FROM alliance_members WHERE airline_id = ?').get(al.id).n,
    transfer: routes.reduce((s, r) => s + (r.last_detail ? JSON.parse(r.last_detail).transfer || 0 : 0), 0) / 2,
    profit: last.profit ?? 0, reputation: al.reputation, value: companyValue(db, al, day),
  };
}

// Przyznaje nowe osiągnięcia (wywoływane na koniec dnia gry).
function grantAchievements(db, al, day, last) {
  const have = new Set(db.prepare('SELECT key FROM achievements WHERE airline_id = ?').all(al.id).map((r) => r.key));
  const s = achievementStats(db, al, day, last);
  for (const g of ACHIEVEMENTS) {
    if (have.has(g.key)) continue;
    const [cur, need] = g.progress(s);
    if (cur < need) continue;
    db.prepare('INSERT INTO achievements(airline_id, key, day) VALUES (?, ?, ?)').run(al.id, g.key, day);
    db.prepare('UPDATE airlines SET cash = cash + ? WHERE id = ?').run(g.reward, al.id);
    db.prepare('INSERT INTO ledger(airline_id, day, amount, text) VALUES (?, ?, ?, ?)').run(al.id, day, g.reward, `Nagroda za osiągnięcie: ${g.name}`);
    db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, `${al.name} zdobywa osiągnięcie „${g.name}”!`);
    report(db, al.id, day, 'achievement', `Osiągnięcie „${g.name}”: nagroda ${(g.reward / 1e6).toFixed(1)} mln $.`);
  }
}

export const isSlotAirport = (code) => AIRPORTS[code].size >= RULES.slotMinSize;
// Pula slotów lotniska; terminale rozbudowane przez linie powiększają ją (db opcjonalnie).
export const slotCapacity = (code, db) => RULES.slotCapacity[AIRPORTS[code].size]
  + (db ? RULES.terminalSlots * db.prepare('SELECT COALESCE(SUM(terminal), 0) AS n FROM bases WHERE airport = ?').get(code).n : 0);

// Cena kolejnego slotu, gdy zajętych jest już `used` z puli lotniska.
export function slotPrice(code, used, capacity = slotCapacity(code)) {
  const fill = used / capacity;
  return Math.round((RULES.slotBasePrice[AIRPORTS[code].size] * (1 + 3 * fill * fill)) / 1e4) * 1e4;
}

// Ile slotów na każdym lotnisku zużywają przypisania samolotów linii (rotacje dziennie, w górę).
export function slotUsage(db, airlineId, override) {
  const use = new Map();
  const rows = db.prepare('SELECT f.aircraft_id, f.route_id, f.round_trips, r.origin, r.dest FROM flights f JOIN routes r ON r.id = f.route_id WHERE r.airline_id = ?').all(airlineId);
  if (override) {
    const i = rows.findIndex((x) => x.aircraft_id === override.aircraft_id && x.route_id === override.route_id);
    if (i >= 0) rows.splice(i, 1);
    if (override.round_trips > 0) rows.push(override);
  }
  for (const f of rows) for (const ap of [f.origin, f.dest]) if (isSlotAirport(ap)) use.set(ap, (use.get(ap) || 0) + f.round_trips);
  for (const [k, v] of use) use.set(k, Math.ceil(v - 1e-9));
  return use;
}

// Symbole do wyboru na stateczniku ('CODE' = kod linii).
export const LIVERY_LOGOS = ['CODE', '★', '✈', '●', '▲', '◆', '✦', '❖', '✚', '☀', '♛', '⚡', '❄', '♥', '☘'];

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
export const COST_PARTS = ['rev_y', 'rev_j', 'rev_f', 'fuel', 'ops', 'staff', 'fees', 'fixed', 'lease', 'maint', 'service', 'marketing', 'loyalty', 'hubs', 'interest'];

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

// Wykup leasingowanego samolotu: cena nowego pomniejszona o zużycie (wiek, stan) i o wpłaconą opłatę leasingową,
// więc leasing z natychmiastowym wykupem kosztuje tyle co zakup.
export function buyoutPrice(type, ageDays, condition = 100) {
  const v = type.price * Math.max(0.3, 1 - (ageDays / 365) * 0.03) * (0.7 + (0.3 * condition) / 100);
  return Math.round(Math.max(type.price * 0.1, v - type.price * RULES.leaseDepositPct) / 1e4) * 1e4;
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

// Raport dnia: krótka informacja dla linii o tym, co się u niej wydarzyło.
export function report(db, airlineId, day, kind, text) {
  db.prepare('INSERT INTO reports(airline_id, day, kind, text) VALUES (?, ?, ?, ?)').run(airlineId, day, kind, text);
}

// Partnerzy linii: członkowie jej sojuszu i linie z aktywną umową codeshare.
export function partnersMap(db) {
  const m = new Map();
  const add = (a, b) => {
    if (a === b) return;
    if (!m.has(a)) m.set(a, new Set());
    m.get(a).add(b);
  };
  for (const r of db.prepare('SELECT a.airline_id AS a, b.airline_id AS b FROM alliance_members a JOIN alliance_members b ON a.alliance_id = b.alliance_id').all()) add(r.a, r.b);
  for (const r of db.prepare("SELECT a_id, b_id FROM codeshares WHERE status = 'active'").all()) { add(r.a_id, r.b_id); add(r.b_id, r.a_id); }
  return m;
}

// Ile kosztuje przejęcie linii (kupujący dostaje też jej gotówkę i długi, stąd premia ponad wartość).
export function takeoverPrice(db, airline, day = currentDay(db)) {
  const routes = db.prepare('SELECT COUNT(*) AS n FROM routes WHERE airline_id = ?').get(airline.id).n;
  const v = companyValue(db, airline, day) * RULES.takeoverPremium + routes * RULES.takeoverPerRoute;
  return Math.round(Math.max(RULES.takeoverMin, v) / 1e5) * 1e5;
}

// Fuzja: kupujący płaci cenę i przejmuje całą linię: gotówkę, długi, flotę, trasy, bazy i sloty.
// Właściciel przejętej linii (człowiek) dostaje cenę jako premię do kapitału swojej następnej linii.
export function mergeAirlines(db, buyerId, targetId, price, day = currentDay(db)) {
  const buyer = db.prepare('SELECT * FROM airlines WHERE id = ?').get(buyerId);
  const target = db.prepare('SELECT a.*, u.is_bot FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(targetId);
  if (!buyer || !target || buyer.id === target.id) throw new Error('Nieprawidłowe przejęcie');
  const log = (amount, text) => db.prepare('INSERT INTO ledger(airline_id, day, amount, text) VALUES (?, ?, ?, ?)').run(buyer.id, day, amount, text);
  db.prepare('UPDATE airlines SET cash = cash - ? + ?, debt = debt + ? WHERE id = ?').run(price, target.cash, target.debt, buyer.id);
  log(-price, `Przejęcie linii ${target.name} (${target.code})`);
  if (target.cash) log(target.cash, `Gotówka przejętej linii ${target.name}`);

  // Samoloty przechodzą razem z przypisaniami do tras; oferty sprzedaży na rynku wtórnym znikają.
  db.prepare('DELETE FROM used_listings WHERE aircraft_id IN (SELECT id FROM aircraft WHERE airline_id = ?)').run(target.id);
  db.prepare('UPDATE aircraft SET airline_id = ? WHERE airline_id = ?').run(buyer.id, target.id);
  const mine = new Map(db.prepare('SELECT id, origin, dest FROM routes WHERE airline_id = ?').all(buyer.id).map((r) => [pairKey(r.origin, r.dest), r.id]));
  for (const r of db.prepare('SELECT * FROM routes WHERE airline_id = ?').all(target.id)) {
    const same = mine.get(pairKey(r.origin, r.dest));
    if (same) {
      // Kupujący już lata na tej trasie: samoloty dołączają do jego trasy.
      db.prepare('INSERT OR REPLACE INTO flights(aircraft_id, route_id, round_trips) SELECT aircraft_id, ?, round_trips FROM flights WHERE route_id = ?').run(same, r.id);
      db.prepare('DELETE FROM routes WHERE id = ?').run(r.id);
    } else {
      db.prepare('UPDATE routes SET airline_id = ? WHERE id = ?').run(buyer.id, r.id);
    }
  }
  for (const b of db.prepare('SELECT * FROM bases WHERE airline_id = ?').all(target.id)) {
    db.prepare('INSERT INTO bases(airline_id, airport, terminal) VALUES (?, ?, ?) ON CONFLICT(airline_id, airport) DO UPDATE SET terminal = MAX(terminal, excluded.terminal)')
      .run(buyer.id, b.airport, b.terminal);
  }
  for (const s of db.prepare('SELECT * FROM slots WHERE airline_id = ?').all(target.id)) {
    db.prepare('INSERT INTO slots(airline_id, airport, count) VALUES (?, ?, ?) ON CONFLICT(airline_id, airport) DO UPDATE SET count = count + excluded.count')
      .run(buyer.id, s.airport, s.count);
  }
  db.prepare('UPDATE airlines SET total_pax = total_pax + ? WHERE id = ?').run(target.total_pax, buyer.id);

  // Sojusz przejętej linii: lider przechodzi na kolejnego członka, pusty sojusz znika.
  const m = db.prepare('SELECT alliance_id FROM alliance_members WHERE airline_id = ?').get(target.id);
  if (m) {
    db.prepare('DELETE FROM alliance_members WHERE airline_id = ?').run(target.id);
    const next = db.prepare('SELECT airline_id FROM alliance_members WHERE alliance_id = ? ORDER BY joined_day, airline_id LIMIT 1').get(m.alliance_id);
    if (!next) db.prepare('DELETE FROM alliances WHERE id = ?').run(m.alliance_id);
    else db.prepare('UPDATE alliances SET leader_id = ? WHERE id = ? AND leader_id = ?').run(next.airline_id, m.alliance_id, target.id);
  }
  if (target.is_bot) db.prepare('UPDATE users SET retired = 1 WHERE id = ?').run(target.user_id);
  else db.prepare('UPDATE users SET bonus_cash = bonus_cash + ? WHERE id = ?').run(price, target.user_id);
  db.prepare('DELETE FROM airlines WHERE id = ?').run(target.id);
  db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day,
    `${buyer.name} przejmuje linię ${target.name} (${target.code}) za $${(price / 1e6).toFixed(1)} mln!`);
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
function connectPassengers(routes, airlines, directMarkets, season, events, partners = new Map(), terminals = new Map()) {
  // Przesiadka łączy dwie trasy jednej linii albo dwóch partnerów (sojusz lub codeshare) na wspólnym lotnisku.
  const byAirport = new Map();
  for (const r of routes.values()) for (const ap of [r.origin, r.dest]) {
    if (!byAirport.has(ap)) byAirport.set(ap, []);
    byAirport.get(ap).push(r);
  }
  const level = (airlineId, ap) => terminals.get(airlineId)?.get(ap) || 0;
  const options = [];
  const seen = new Set();
  for (const [hub, rs] of byAirport) {
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const x = rs[i], y = rs[j];
      if (x.airline_id !== y.airline_id && !partners.get(x.airline_id)?.has(y.airline_id)) continue;
      const a = x.origin === hub ? x.dest : x.origin, b = y.origin === hub ? y.dest : y.origin;
      const key = pairKey(a, b);
      const seller = `${Math.min(x.airline_id, y.airline_id)}-${Math.max(x.airline_id, y.airline_id)}|${key}`;
      if (a === b || seen.has(seller)) continue;
      const dist = distanceKm(a, b), via = x.dist + y.dist;
      if (dist < 300 || via > dist * RULES.connectMaxDetour) continue;
      seen.add(seller);
      // Rozbudowany terminal w hubie przyciąga więcej pasażerów z przesiadką.
      const boost = 1 + RULES.terminalTransfer * Math.max(level(x.airline_id, hub), level(y.airline_id, hub));
      options.push({ key, a, b, dist, via, boost, legs: [x, y] });
    }
  }
  const sellers = new Map(); // ile linii (lub par partnerów) oferuje przesiadkę na tej parze miast
  for (const o of options) sellers.set(o.key, (sellers.get(o.key) || 0) + 1);
  for (const o of options) {
    const free = Math.min(...o.legs.map((r) => 2 * r.seats.y - r.pax.y));
    if (free < 1) continue;
    let demand = 2 * dailyDemand(o.a, o.b) * classShare('y', o.dist) * season * eventMult(events, o.a, o.b) * RULES.connectShare * o.boost;
    if (directMarkets.has(o.key)) demand *= 0.3; // większość wybierze lot bezpośredni
    demand /= sellers.get(o.key);
    const price = (o.legs[0].prices.y + o.legs[1].prices.y) * RULES.connectDiscount;
    const reputation = (airlines.get(o.legs[0].airline_id).reputation + airlines.get(o.legs[1].airline_id).reputation) / 2;
    const pax = Math.floor(allocateMarket(demand, classFare('y', o.dist), [{ seats: free, price, reputation }])[0]);
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

// Koniec sezonu: trzy najcenniejsze linie trafiają do galerii sław, a świat zaczyna się od nowa.
// Konta graczy zostają, każdy zakłada nową linię.
export function endSeason(db, day, seasonDays) {
  const { season } = db.prepare('SELECT season FROM game_state WHERE id = 1').get();
  const top = db.prepare('SELECT a.*, u.username, u.is_bot FROM airlines a JOIN users u ON u.id = a.user_id').all()
    .map((a) => ({ ...a, value: companyValue(db, a, day) })).sort((x, y) => y.value - x.value).slice(0, 3);
  top.forEach((a, i) => db.prepare('INSERT INTO hall_of_fame(season, place, airline, code, owner, bot, value, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season, i + 1, a.name, a.code, a.username, a.is_bot, a.value, day));
  db.exec(`
    DELETE FROM used_listings WHERE aircraft_id IS NOT NULL;
    DELETE FROM alliances;
    DELETE FROM airlines;
    UPDATE users SET bonus_cash = 0, retired = 0;
  `);
  db.prepare('UPDATE game_state SET season = ?, season_end_day = ? WHERE id = 1').run(season + 1, day + seasonDays);
  db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, top.length
    ? `Koniec sezonu ${season}! Wygrywa ${top[0].name} (${top[0].username}) z wartością firmy $${(top[0].value / 1e6).toFixed(1)} mln. Rusza sezon ${season + 1}.`
    : `Koniec sezonu ${season}. Rusza sezon ${season + 1}.`);
}

function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

// seasonDays: długość sezonu w dniach gry (bez tej opcji sezony się nie kończą).
export function runTick(db, rng = Math.random, { seasonDays } = {}) {
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
    db.prepare('DELETE FROM takeover_offers WHERE day < ?').run(day - RULES.takeoverOfferDays);
    const events = activeEvents(db, day);
    const season = seasonMult(day);

    const airlines = new Map(
      db.prepare('SELECT a.*, m.alliance_id FROM airlines a LEFT JOIN alliance_members m ON m.airline_id = a.id').all()
        .map((a) => [a.id, { ...a, revenue: 0, costs: 0, pax: 0, seats: 0, condSum: 0, condN: 0, breakdowns: 0, parts: Object.fromEntries(COST_PARTS.map((k) => [k, 0])) }])
    );
    // Kampanie reklamowe: linia → kraj → poziom kampanii.
    const campaigns = new Map();
    for (const c of db.prepare('SELECT * FROM campaigns WHERE start_day <= ? AND end_day >= ?').all(day, day)) {
      const al = airlines.get(c.airline_id);
      if (!al) continue;
      al.parts.marketing += RULES.campaignLevels[c.level].costPerDay;
      if (!campaigns.has(c.airline_id)) campaigns.set(c.airline_id, new Map());
      const m = campaigns.get(c.airline_id);
      m.set(c.country, Math.max(m.get(c.country) ?? -1, c.level));
    }
    const adBoost = (al, a, b) => {
      const m = campaigns.get(al.id);
      if (!m) return 1;
      const lv = Math.max(m.get(AIRPORTS[a].country) ?? -1, m.get(AIRPORTS[b].country) ?? -1);
      return lv < 0 ? 1 : RULES.campaignLevels[lv].appeal;
    };
    // Atrakcyjność linii dla pasażerów: obsługa, pensje, program lojalnościowy i reklama.
    const appeal = (al, a, b) => RULES.serviceLevels[al.service - 1].appeal * (al.loyalty ? RULES.loyaltyAppeal : 1)
      * (al.wage < 90 ? 0.95 : al.wage >= 115 ? 1.03 : 1) * adBoost(al, a, b);
    // Strajk przy zbyt niskich pensjach: połowa lotów linii tego dnia się nie odbywa.
    for (const al of airlines.values()) {
      al.strike = al.wage < 95 && rng() < ((95 - al.wage) / 100) * 0.3;
      if (al.strike) {
        db.prepare('INSERT INTO news(day, text) VALUES (?, ?)').run(day, `Strajk personelu w ${al.name}! Załogi domagają się wyższych pensji, część lotów odwołana.`);
        report(db, al.id, day, 'strike', 'Strajk personelu: połowa lotów odwołana. Podnieś pensje w zakładce „Linia”.');
      }
    }
    const basesByAirline = new Map();
    const terminals = new Map(); // linia → lotnisko → poziom terminalu
    for (const b of db.prepare('SELECT * FROM bases').all()) {
      if (!basesByAirline.has(b.airline_id)) basesByAirline.set(b.airline_id, new Set());
      basesByAirline.get(b.airline_id).add(b.airport);
      if (!b.terminal || !airlines.has(b.airline_id)) continue;
      if (!terminals.has(b.airline_id)) terminals.set(b.airline_id, new Map());
      terminals.get(b.airline_id).set(b.airport, b.terminal);
      airlines.get(b.airline_id).parts.hubs += RULES.terminalUpkeep * AIRPORTS[b.airport].size * b.terminal;
    }
    const partners = partnersMap(db);
    const routes = new Map(
      db.prepare('SELECT * FROM routes').all().map((r) => [r.id, {
        ...r, dist: distanceKm(r.origin, r.dest), prices: routePrices(r),
        seats: { y: 0, j: 0, f: 0 }, cost: 0, pax: { y: 0, j: 0, f: 0 }, revenue: 0, rev: { y: 0, j: 0, f: 0 }, parts: { fuel: 0, ops: 0, staff: 0, fees: 0 }, transfer: 0,
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
    // Wynik każdego samolotu: jego koszty i część przychodu tras proporcjonalna do miejsc, które na nich oferuje.
    const acStats = new Map();
    for (const ac of db.prepare('SELECT * FROM aircraft').all()) {
      if (ac.delivery_day > day) continue; // jeszcze w fabryce
      const t = AIRCRAFT_TYPES[ac.type_id];
      const al = airlines.get(ac.airline_id);
      if (ac.delivery_day === day) report(db, al.id, day, 'delivery', `Dostarczono ${t.name} #${ac.id}. Przypisz go do trasy we „Flocie”.`);
      const inMaint = ac.maintenance_until >= day;
      // Koszty stałe i leasing płaci się każdego dnia, także w dniu rozpoczęcia przeglądu.
      const fixed = t.dailyFixed * (1 + (100 - ac.condition) / 200), lease = ac.leased ? leaseDaily(t) : 0;
      al.parts.fixed += fixed;
      al.parts.lease += lease;
      const st = { al, cost: fixed + lease, legs: [] };
      acStats.set(ac.id, st);
      if (!inMaint && al.auto_maint > 0 && ac.condition < al.auto_maint) {
        al.parts.maint += maintenanceCost(t, ac.condition);
        st.cost += maintenanceCost(t, ac.condition);
        report(db, al.id, day, 'maint', `${t.name} #${ac.id} poszedł na automatyczny przegląd (stan ${Math.round(ac.condition)}%).`);
        startMaint.run(day + RULES.maintenanceDays - 1, ac.id);
        al.condSum += 100;
        al.condN++;
        continue;
      }
      al.condSum += ac.condition;
      al.condN++;
      const legs = (flights.get(ac.id) || []).map((f) => [routes.get(f.route_id), f.round_trips]).filter(([r]) => r);
      if (inMaint || !legs.length) {
        if (!inMaint) updAc.run(Math.max(0, ac.condition - dailyWear(0)), ac.id);
        continue;
      }
      if (al.strike && rng() < 0.5) continue; // lot odwołany przez strajk
      // Mocno zużyty samolot może się zepsuć i nie polecieć.
      if (ac.condition < 30 && rng() < (30 - ac.condition) / 60) {
        al.breakdowns++;
        al.parts.maint += maintenanceCost(t, ac.condition) * 0.2;
        st.cost += maintenanceCost(t, ac.condition) * 0.2;
        report(db, al.id, day, 'breakdown', `Awaria: ${t.name} #${ac.id} nie poleciał (stan ${Math.round(ac.condition)}%). Wyślij go na przegląd.`);
        continue;
      }
      const s = seatMap(t, ac.seats_j, ac.seats_f);
      let trips = 0;
      for (const [r, n] of legs) {
        for (const c of CLASSES) r.seats[c] += s[c] * n;
        const c = legCostParts(t, r.dist, fuel);
        const staff = c.ops * RULES.staffShare * (al.wage / 100), tech = c.ops * (1 - RULES.staffShare);
        r.parts.fuel += 2 * n * c.fuel;
        r.parts.ops += 2 * n * tech;
        r.parts.staff += 2 * n * staff;
        r.parts.fees += 2 * n * c.fees;
        r.cost += 2 * n * (c.fuel + tech + staff + c.fees);
        st.cost += 2 * n * (c.fuel + tech + staff + c.fees);
        st.legs.push({ r, seats: Object.fromEntries(CLASSES.map((k) => [k, s[k] * n])) });
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
      // Reklama zwiększa też ogólny popyt na trasie.
      const ads = Math.max(...list.map((r) => adBoost(airlines.get(r.airline_id), origin, dest)));
      const demand = dailyDemand(origin, dest) * season * eventMult(events, origin, dest) * (1 + (ads - 1) * 0.6);
      const bonus = (r) => {
        // Codeshare: partner (sojusz lub umowa) ma bazę na jednym z końców trasy.
        let m = 1;
        for (const p of partners.get(r.airline_id) || []) {
          const b = basesByAirline.get(p);
          if (b && (b.has(origin) || b.has(dest))) { m = RULES.codeshareBonus; break; }
        }
        const t = terminals.get(r.airline_id);
        const lv = t ? Math.max(t.get(origin) || 0, t.get(dest) || 0) : 0;
        return m * (1 + RULES.terminalAppeal * lv);
      };
      for (const c of CLASSES) {
        const flying = list.filter((r) => r.seats[c] > 0);
        if (!flying.length) continue;
        const offers = flying.map((r) => {
          const al = airlines.get(r.airline_id);
          return { seats: r.seats[c], price: r.prices[c], reputation: al.reputation, bonus: bonus(r) * appeal(al, origin, dest) };
        });
        const pax = allocateMarket(demand * classShare(c, dist), classFare(c, dist), offers);
        flying.forEach((r, i) => {
          r.pax[c] = Math.round(pax[i] * 2); // oba kierunki
          r.rev[c] = r.pax[c] * r.prices[c];
          r.revenue += r.rev[c];
        });
      }
    }

    connectPassengers(routes, airlines, new Set(markets.keys()), season, events, partners, terminals);

    // Konkurenci na każdej parze miast (kody linii), żeby zgłosić nowego rywala w raporcie dnia.
    const rivalsOn = new Map();
    for (const r of routes.values()) {
      const k = pairKey(r.origin, r.dest);
      if (!rivalsOn.has(k)) rivalsOn.set(k, new Map());
      rivalsOn.get(k).set(r.airline_id, airlines.get(r.airline_id));
    }

    const updRoute = db.prepare('UPDATE routes SET last_pax = ?, last_seats = ?, last_revenue = ?, last_cost = ?, last_detail = ?, last_rivals = ? WHERE id = ?');
    for (const r of routes.values()) {
      const pax = r.pax.y + r.pax.j + r.pax.f;
      const seats = Math.round(2 * (r.seats.y + r.seats.j + r.seats.f));
      const detail = { ...Object.fromEntries(CLASSES.map((c) => [c, { pax: r.pax[c], seats: Math.round(2 * r.seats[c]) }])), transfer: r.transfer };
      const others = [...rivalsOn.get(pairKey(r.origin, r.dest))].filter(([id]) => id !== r.airline_id).map(([, a]) => a);
      const name = `${r.origin}–${r.dest}`;
      if (r.last_rivals != null) {
        const before = new Set(JSON.parse(r.last_rivals));
        for (const a of others) if (!before.has(a.code)) report(db, r.airline_id, day, 'rival', `${a.name} (${a.code}) zaczyna latać na Twojej trasie ${name}.`);
      }
      // Trasa przeszła na stratę albo wróciła do zysku (tylko gdy wczoraj ktoś nią leciał).
      if (r.last_seats > 0 && seats > 0) {
        const was = r.last_revenue - r.last_cost, now = r.revenue - r.cost;
        if (was >= 0 && now < 0) report(db, r.airline_id, day, 'loss', `Trasa ${name} przynosi stratę: ${Math.round(now).toLocaleString('pl-PL')} $ dziennie.`);
        else if (was < 0 && now >= 0) report(db, r.airline_id, day, 'gain', `Trasa ${name} znów jest na plusie: +${Math.round(now).toLocaleString('pl-PL')} $ dziennie.`);
      }
      updRoute.run(pax, seats, r.revenue, r.cost, JSON.stringify(detail), JSON.stringify(others.map((a) => a.code)), r.id);
      const al = airlines.get(r.airline_id);
      al.revenue += r.revenue;
      for (const c of CLASSES) al.parts['rev_' + c] += r.rev[c];
      for (const k of ['fuel', 'ops', 'staff', 'fees']) al.parts[k] += r.parts[k];
      al.parts.service += (r.pax.y + 3 * (r.pax.j + r.pax.f)) * RULES.serviceLevels[al.service - 1].costPerPax;
      al.pax += pax - r.transfer / 2; // pasażer z przesiadką leci dwoma odcinkami, liczymy go raz
      al.seats += seats;
    }

    const updAcStats = db.prepare('UPDATE aircraft SET last_revenue = ?, last_cost = ?, last_pax = ?, total_profit = total_profit + ? WHERE id = ?');
    for (const [id, st] of acStats) {
      const { al } = st;
      const perPax = RULES.serviceLevels[al.service - 1].costPerPax;
      let rev = 0, pax = 0, cost = st.cost;
      for (const { r, seats } of st.legs) {
        for (const c of CLASSES) {
          if (!r.seats[c]) continue;
          const share = seats[c] / r.seats[c];
          rev += r.rev[c] * share;
          pax += r.pax[c] * share;
          cost += r.pax[c] * share * perPax * (c === 'y' ? 1 : 3);
        }
      }
      if (al.loyalty) cost += rev * RULES.loyaltyCostShare;
      updAcStats.run(Math.round(rev), Math.round(cost), Math.round(pax), rev - cost, id);
    }

    const updAirline = db.prepare('UPDATE airlines SET cash = ?, reputation = ?, total_pax = total_pax + ? WHERE id = ?');
    const insStat = db.prepare('INSERT OR REPLACE INTO daily_stats(airline_id, day, revenue, costs, pax, detail) VALUES (?, ?, ?, ?, ?, ?)');
    for (const al of airlines.values()) {
      al.parts.interest += (al.debt * RULES.loanInterestYear) / 365;
      if (al.loyalty) al.parts.loyalty += al.revenue * RULES.loyaltyCostShare;
      al.costs = COST_PARTS.filter((k) => !k.startsWith('rev_')).reduce((s, k) => s + al.parts[k], 0);
      const profit = al.revenue - al.costs;
      const lf = al.seats ? al.pax / al.seats : 0;
      let rep = al.reputation;
      if (al.seats > 0) rep += profit > 0 && lf > 0.6 ? 0.15 : profit < 0 ? -0.2 : 0.05;
      if (al.condN && al.condSum / al.condN < 50) rep -= 0.15; // zaniedbana flota
      if (al.seats > 0) rep += RULES.serviceLevels[al.service - 1].rep + (al.wage >= 115 ? 0.03 : al.wage < 90 ? -0.05 : 0);
      if (al.strike) rep -= 1;
      rep -= 0.3 * al.breakdowns;
      rep = Math.min(100, Math.max(0, rep));
      updAirline.run(al.cash + profit, rep, Math.round(al.pax), al.id);
      al.profit = profit;
      const detail = Object.fromEntries(Object.entries(al.parts).map(([k, v]) => [k, Math.round(v)]));
      insStat.run(al.id, day, al.revenue, al.costs, al.pax, JSON.stringify({ ...detail, seats: al.seats }));
    }

    for (const al of airlines.values()) {
      const fresh = db.prepare('SELECT a.* FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND u.is_bot = 0').get(al.id);
      if (fresh) grantAchievements(db, fresh, day, { profit: al.profit });
    }
    refillUsedMarket(db, day, rng);
    db.prepare('DELETE FROM events WHERE end_day < ?').run(day - 30);
    db.prepare('DELETE FROM daily_stats WHERE day < ?').run(day - 60);
    db.prepare('DELETE FROM reports WHERE day < ?').run(day - RULES.reportDays);
    db.prepare('DELETE FROM news WHERE id NOT IN (SELECT id FROM news ORDER BY id DESC LIMIT 200)').run();
    db.prepare('UPDATE game_state SET day = ?, fuel = ? WHERE id = 1').run(day, fuel);
    if (seasonDays) {
      if (state.season_end_day == null) db.prepare('UPDATE game_state SET season_end_day = ? WHERE id = 1').run(day + seasonDays);
      else if (day >= state.season_end_day) endSeason(db, day, seasonDays);
    }
    return day;
  });
}
