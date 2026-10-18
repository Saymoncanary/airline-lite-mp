import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runTick, allocateMarket, maxRoundTrips, roundTripHours, distanceKm, RULES } from '../src/game.js';
import { AIRCRAFT_TYPES } from '../src/data.js';

const calm = () => 0.5; // los bez wydarzeń i zmian cen paliwa

async function startServer() {
  const db = openDb(':memory:');
  const server = createServer(createApp({ db }));
  await new Promise((r) => server.listen(0, r));
  return { db, server, base: `http://localhost:${server.address().port}` };
}

function client(base) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('rejestracja, logowanie i ochrona API', async () => {
  const { server, base } = await startServer();
  const c = client(base);
  assert.equal((await c('GET', '/api/airline')).status, 401);
  assert.equal((await c('POST', '/api/register', { username: 'ab', password: 'x' })).status, 400);
  assert.equal((await c('POST', '/api/register', { username: 'pilot', password: 'tajnehaslo' })).status, 200);
  assert.equal((await c('POST', '/api/register', { username: 'PILOT', password: 'tajnehaslo' })).status, 409);
  assert.equal((await c('GET', '/api/me')).data.user.username, 'pilot');
  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).data.user, null);
  assert.equal((await c('POST', '/api/login', { username: 'pilot', password: 'zle-haslo' })).status, 401);
  assert.equal((await c('POST', '/api/login', { username: 'pilot', password: 'tajnehaslo' })).status, 200);
  assert.equal((await c('GET', '/api/me')).data.user.username, 'pilot');
  // Zapytania spoza JSON-a (np. formularze z obcych stron) są odrzucane.
  const form = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  server.close();
});

test('pełna rozgrywka dwóch graczy z konkurencją', async () => {
  const { db, server, base } = await startServer();
  const a = client(base), b = client(base);
  await a('POST', '/api/register', { username: 'anna', password: 'haslo1234' });
  await b('POST', '/api/register', { username: 'bartek', password: 'haslo1234' });
  assert.equal((await a('POST', '/api/airline', { name: 'Anna Air', code: 'AA', hub: 'WAW' })).status, 200);
  assert.equal((await b('POST', '/api/airline', { name: 'Anna Air', code: 'BB', hub: 'KRK' })).status, 409);
  assert.equal((await b('POST', '/api/airline', { name: 'Bartek Wings', code: 'BW', hub: 'LHR' })).status, 200);

  // Trasa musi startować z bazy.
  assert.equal((await a('POST', '/api/routes', { origin: 'KRK', dest: 'LHR' })).status, 400);
  const ra = await a('POST', '/api/routes', { origin: 'WAW', dest: 'LHR' });
  const rb = await b('POST', '/api/routes', { origin: 'LHR', dest: 'WAW', price: 400 });
  assert.equal(ra.status, 200);
  assert.equal((await a('POST', '/api/routes', { origin: 'WAW', dest: 'LHR' })).status, 409);

  assert.equal((await a('POST', '/api/aircraft', { typeId: 'A320', mode: 'buy' })).status, 200);
  assert.equal((await b('POST', '/api/aircraft', { typeId: 'A320', mode: 'lease' })).status, 200);
  assert.equal((await a('POST', '/api/aircraft', { typeId: 'B77W', mode: 'buy' })).status, 400); // za mało gotówki

  const fa = (await a('GET', '/api/airline')).data.fleet[0];
  const fb = (await b('GET', '/api/airline')).data.fleet[0];
  // Nowy samolot trzeba poczekać, aż zostanie dostarczony.
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id })).status, 400);
  for (let i = 0; i < 5; i++) runTick(db, calm);
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id, roundTrips: 99 })).status, 400);
  // Londyn ma limit slotów: bez nich nie da się latać, baza w LHR dostaje sloty na start.
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id })).status, 400);
  const slots = (await a('GET', '/api/slots')).data.find((s) => s.code === 'LHR');
  assert.equal(slots.used, 10);
  assert.equal((await a('POST', '/api/slots', { airport: 'LHR', count: 6 })).status, 200);
  assert.equal((await a('POST', '/api/slots', { airport: 'WAW', count: 1 })).status, 400);
  assert.equal((await a('GET', '/api/slots')).data.find((s) => s.code === 'LHR').mine, 6);
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id })).status, 200);
  assert.equal((await b('POST', `/api/aircraft/${fb.id}/assign`, { routeId: rb.data.id })).status, 200);
  // Nie można sterować cudzym samolotem.
  assert.equal((await b('POST', `/api/aircraft/${fa.id}/assign`, { routeId: rb.data.id })).status, 404);

  for (let i = 0; i < 5; i++) runTick(db, calm);

  const A = (await a('GET', '/api/airline')).data;
  const B = (await b('GET', '/api/airline')).data;
  assert.equal(A.day, 10);
  assert.equal(A.stats.length, 10);
  assert.ok(A.fleet[0].condition < 100, 'latający samolot się zużywa');
  assert.ok(A.routes[0].last_pax > 0);
  // Tańsza linia (Anna, cena referencyjna) przyciąga więcej pasażerów niż droższa.
  assert.ok(A.routes[0].last_pax > B.routes[0].last_pax, `${A.routes[0].last_pax} vs ${B.routes[0].last_pax}`);
  assert.ok(A.routes[0].last_revenue - A.routes[0].last_cost > 0, 'trasa powinna zarabiać na lotach');

  const lb = (await a('GET', '/api/leaderboard')).data;
  assert.equal(lb.length, 2);
  assert.ok(lb[0].value >= lb[1].value);

  // Kredyt i baza
  assert.equal((await a('POST', '/api/loan', { amount: 50e6 })).status, 200);
  assert.equal((await a('POST', '/api/loan', { amount: 400e6 })).status, 400);
  assert.equal((await a('POST', '/api/loan', { amount: -20e6 })).status, 200);
  assert.equal((await a('GET', '/api/airline')).data.airline.debt, 30e6);
  assert.equal((await a('POST', '/api/bases', { airport: 'KRK' })).status, 200);
  assert.equal((await a('POST', '/api/routes', { origin: 'KRK', dest: 'BCN' })).status, 200);

  // Sprzedaż samolotu
  const cashBefore = (await a('GET', '/api/airline')).data.airline.cash;
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/sell`)).status, 200);
  assert.ok((await a('GET', '/api/airline')).data.airline.cash > cashBefore);
  server.close();
});

test('podział rynku nie przekracza popytu ani liczby miejsc', () => {
  const offers = [{ seats: 500, price: 100, reputation: 50 }, { seats: 200, price: 80, reputation: 70 }];
  const pax = allocateMarket(600, 100, offers);
  assert.ok(pax[0] <= 500 && pax[1] <= 200);
  assert.ok(pax[0] + pax[1] <= 600 * 1.6 + 1e-9);
  assert.equal(pax[1], 200); // tańsza i lepsza oferta wypełnia się całkowicie
});

test('klasy, przeglądy, rynek wtórny i sojusze', async () => {
  const { db, server, base } = await startServer();
  const a = client(base), b = client(base);
  await a('POST', '/api/register', { username: 'ola', password: 'haslo1234' });
  await b('POST', '/api/register', { username: 'piotr', password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Ola Air', code: 'OA', hub: 'WAW' });
  await b('POST', '/api/airline', { name: 'Piotr Jet', code: 'PJ', hub: 'CDG' });
  assert.equal((await a('POST', '/api/aircraft', { typeId: 'B788', mode: 'lease' })).status, 200);
  await b('POST', '/api/aircraft', { typeId: 'A320', mode: 'buy' });
  for (let i = 0; i < 8; i++) runTick(db, calm);

  // Klasy podróży: konfiguracja foteli i ceny w trzech klasach.
  const ac = (await a('GET', '/api/airline')).data.fleet[0];
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/config`, { j: 200, f: 0 })).status, 400);
  const cfg = await a('POST', `/api/aircraft/${ac.id}/config`, { j: 30, f: 8 });
  assert.deepEqual(cfg.data.seatMap, { y: 248 - 60 - 24, j: 30, f: 8 });
  const r = await a('POST', '/api/routes', { origin: 'WAW', dest: 'JFK' });
  await a('POST', '/api/slots', { airport: 'JFK', count: 2 });
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: r.data.id })).status, 200);
  runTick(db, calm);
  const route = (await a('GET', '/api/airline')).data.routes[0];
  assert.ok(route.detail.j.pax > 0 && route.detail.f.pax > 0 && route.detail.y.pax > 0);
  assert.equal((await a('PATCH', `/api/routes/${route.id}`, { price_j: 2500 })).status, 200);
  assert.equal((await a('GET', '/api/airline')).data.routes[0].prices.j, 2500);

  // Przegląd przywraca pełną sprawność i uziemia samolot na 2 dni.
  for (let i = 0; i < 10; i++) runTick(db, calm);
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/maintenance`)).status, 200);
  const after = (await a('GET', '/api/airline')).data.fleet[0];
  assert.equal(after.condition, 100);
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/maintenance`)).status, 400);

  // Rynek wtórny: oferty brokera i sprzedaż między graczami.
  const used = (await a('GET', '/api/used')).data;
  assert.ok(used.length >= 10);
  const cheap = used.filter((u) => !u.sellerId).sort((x, y) => x.price - y.price)[0];
  assert.equal((await a('POST', `/api/used/${cheap.id}/buy`)).status, 200);
  assert.equal((await a('GET', '/api/airline')).data.fleet.length, 2);
  const pj = (await b('GET', '/api/airline')).data;
  assert.equal((await b('POST', `/api/aircraft/${pj.fleet[0].id}/list`, { price: 50e6 })).status, 200);
  const offer = (await a('GET', '/api/used')).data.find((u) => u.sellerId);
  const sellerCash = pj.airline.cash;
  assert.equal((await b('POST', `/api/used/${offer.id}/buy`)).status, 400); // własnego nie kupisz
  assert.equal((await a('POST', `/api/used/${offer.id}/buy`)).status, 200);
  assert.equal((await b('GET', '/api/airline')).data.airline.cash, sellerCash + 50e6);
  assert.equal((await a('GET', '/api/airline')).data.fleet.length, 3);

  // Sojusze i czat.
  assert.equal((await a('POST', '/api/alliances', { name: 'Star Polska' })).status, 200);
  const list = (await b('GET', '/api/alliances')).data;
  assert.equal((await b('POST', `/api/alliances/${list[0].id}/join`)).status, 200);
  assert.equal((await b('POST', '/api/alliance/chat', { text: 'Cześć!' })).status, 200);
  const chat = (await a('GET', '/api/alliance/chat')).data;
  assert.equal(chat[0].text, 'Cześć!');
  assert.equal((await a('GET', '/api/airline')).data.alliance.members.length, 2);
  assert.equal((await b('POST', '/api/alliance/kick', { airlineId: 1 })).status, 403);
  assert.equal((await a('POST', '/api/alliance/leave')).status, 200);
  assert.equal((await b('GET', '/api/airline')).data.alliance.leader_id, (await b('GET', '/api/airline')).data.airline.id);
  server.closeAllConnections(); server.close();
});

test('wydarzenia losowe i cena paliwa', () => {
  const db = openDb(':memory:');
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) runTick(db, rng);
  const fuel = db.prepare('SELECT fuel FROM game_state').get().fuel;
  assert.ok(fuel >= 0.5 && fuel <= 2);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM news').get().n > 5, 'powinny pojawić się wydarzenia');
});

test('jeden samolot na kilku trasach', async () => {
  const { db, server, base } = await startServer();
  const a = client(base);
  await a('POST', '/api/register', { username: 'kasia', password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Kasia Air', code: 'KA', hub: 'WAW' });
  await a('POST', '/api/aircraft', { typeId: 'A320', mode: 'buy' });
  for (let i = 0; i < 6; i++) runTick(db, calm);
  const ac = (await a('GET', '/api/airline')).data.fleet[0];
  const ber = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'BER' })).data.id;
  const prg = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'PRG' })).data.id;
  const t = AIRCRAFT_TYPES.A320;
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: ber, roundTrips: 2 })).status, 200);
  const left = RULES.operatingHours - 2 * roundTripHours(t, distanceKm('WAW', 'BER'));
  const max = maxRoundTrips(t, distanceKm('WAW', 'PRG'), left);
  assert.ok(max >= 1);
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: prg, roundTrips: max + 1 })).status, 400);
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: prg, roundTrips: max })).status, 200);
  // Zwiększenie rotacji na pierwszej trasie nie zmieści się już w dobie.
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: ber, roundTrips: 2 + max + 1 })).status, 400);
  runTick(db, calm);
  const data = (await a('GET', '/api/airline')).data;
  assert.equal(data.fleet[0].flights.length, 2);
  assert.ok(data.routes.every((r) => r.last_seats > 0 && r.last_pax > 0));
  // Finanse: podział wyniku dnia i dziennik operacji.
  const fin = (await a('GET', '/api/finance')).data;
  const d = fin.days[fin.days.length - 1];
  assert.ok(d.detail.rev_y > 0 && d.detail.fuel > 0 && d.detail.fixed > 0);
  const parts = Object.entries(d.detail).filter(([k]) => !k.startsWith('rev_') && k !== 'seats').reduce((s, [, v]) => s + v, 0);
  assert.ok(Math.abs(parts - d.costs) < 10);
  assert.equal(fin.routes.find((r) => r.id === prg).planes, 1);
  // Wynik samolotu: jedyny samolot linii ma cały jej przychód i koszty (poza odsetkami i reklamą).
  const plane = data.fleet[0];
  assert.ok(Math.abs(plane.last_revenue - d.revenue) < 2, `${plane.last_revenue} vs ${d.revenue}`);
  assert.ok(Math.abs(plane.last_cost - (d.costs - d.detail.interest - d.detail.marketing)) < 3, `${plane.last_cost} vs ${d.costs}`);
  assert.ok(plane.last_pax > 0 && plane.total_profit < plane.last_revenue - plane.last_cost); // wcześniej stał w hangarze
  const buy = fin.entries.find((e) => e.text === 'Zakup: Airbus A320neo');
  assert.equal(buy.amount, -AIRCRAFT_TYPES.A320.price);
  // Osiągnięcia: pierwszy lot i własny samolot dają nagrody.
  const got = (await a('GET', '/api/airline')).data.achievements.map((x) => x.key);
  assert.ok(got.includes('first_route') && got.includes('own_plane'), got.join(','));
  assert.ok(fin.entries.some((e) => e.text === 'Nagroda za osiągnięcie: Pierwszy lot' && e.amount === 1e6));
  // Zamknięcie trasy i zdjęcie z trasy usuwają przypisania.
  assert.equal((await a('DELETE', `/api/routes/${ber}`)).status, 200);
  assert.deepEqual((await a('GET', '/api/airline')).data.fleet[0].flights.map((f) => f.route_id), [prg]);
  assert.equal((await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: prg, roundTrips: 0 })).status, 200);
  assert.equal((await a('GET', '/api/airline')).data.fleet[0].flights.length, 0);
  server.closeAllConnections();
  server.close();
});

test('przesiadki przez hub', async () => {
  const { db, server, base } = await startServer();
  const a = client(base);
  await a('POST', '/api/register', { username: 'hubert', password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Hub Air', code: 'HU', hub: 'WAW' });
  await a('POST', '/api/aircraft', { typeId: 'A320C', mode: 'buy' });
  await a('POST', '/api/aircraft', { typeId: 'A320C', mode: 'buy' });
  for (let i = 0; i < 6; i++) runTick(db, calm);
  const fleet = (await a('GET', '/api/airline')).data.fleet;
  const ber = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'BER' })).data.id;
  const krk = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'KRK' })).data.id;
  await a('POST', `/api/aircraft/${fleet[0].id}/assign`, { routeId: ber });
  await a('POST', `/api/aircraft/${fleet[1].id}/assign`, { routeId: krk });
  runTick(db, calm);
  const routes = (await a('GET', '/api/airline')).data.routes;
  for (const r of routes) assert.ok(r.detail.transfer > 0, `${r.origin}-${r.dest} powinna mieć przesiadki`);
  assert.equal(routes[0].detail.transfer, routes[1].detail.transfer);
  server.closeAllConnections();
  server.close();
});

test('personel, obsługa, reklama i program lojalnościowy', async () => {
  const { db, server, base } = await startServer();
  const a = client(base);
  await a('POST', '/api/register', { username: 'marek', password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Marek Air', code: 'MK', hub: 'WAW' });
  await a('POST', '/api/aircraft', { typeId: 'A320C', mode: 'buy' });
  for (let i = 0; i < 6; i++) runTick(db, calm);
  const ac = (await a('GET', '/api/airline')).data.fleet[0];
  const r = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'CDG' })).data.id;
  await a('POST', '/api/slots', { airport: 'CDG', count: 6 });
  await a('POST', `/api/aircraft/${ac.id}/assign`, { routeId: r });
  assert.equal((await a('POST', '/api/airline/staff', { wage: 50, service: 2 })).status, 400);
  assert.equal((await a('POST', '/api/airline/staff', { wage: 120, service: 9 })).status, 400);
  runTick(db, calm);
  const before = (await a('GET', '/api/airline')).data.routes[0].last_pax;
  assert.equal((await a('POST', '/api/airline/staff', { wage: 120, service: 4, loyalty: true })).status, 200);
  assert.equal((await a('POST', '/api/campaigns', { country: 'Francja', level: 2 })).status, 200);
  assert.equal((await a('POST', '/api/campaigns', { country: 'Atlantyda', level: 0 })).status, 400);
  assert.equal((await a('GET', '/api/campaigns')).data.length, 1);
  runTick(db, calm);
  const after = (await a('GET', '/api/airline')).data.routes[0].last_pax;
  assert.ok(after >= before, `reklama i obsługa nie powinny zmniejszyć liczby pasażerów (${before} → ${after})`);
  const d = (await a('GET', '/api/finance')).data.days.at(-1).detail;
  assert.equal(d.marketing, 250e3);
  assert.ok(d.service > 0 && d.loyalty > 0 && d.staff > 0);
  server.closeAllConnections();
  server.close();
});

test('komputerowi rywale rozwijają swoje linie', async () => {
  const { ensureBots, runBots } = await import('../src/bots.js');
  const { tx, currentDay } = await import('../src/game.js');
  const db = openDb(':memory:');
  tx(db, () => ensureBots(db, 3, 0));
  tx(db, () => ensureBots(db, 3, 0)); // drugi raz nic nie dodaje
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM airlines').get().n, 3);
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 120; i++) {
    tx(db, () => runBots(db, currentDay(db) + 1, rng));
    runTick(db, rng);
  }
  for (const al of db.prepare('SELECT * FROM airlines').all()) {
    const fleet = db.prepare('SELECT COUNT(*) AS n FROM aircraft WHERE airline_id = ?').get(al.id).n;
    const pax = db.prepare('SELECT COALESCE(SUM(last_pax), 0) AS n FROM routes WHERE airline_id = ?').get(al.id).n;
    assert.ok(fleet >= 2, `${al.name}: flota ${fleet}`);
    assert.ok(pax > 0, `${al.name}: brak pasażerów`);
    assert.ok(al.cash > 0, `${al.name}: gotówka ${al.cash}`);
  }
  // Na konto bota nie da się zalogować (pusty hash hasła).
  assert.equal(db.prepare("SELECT pass_hash FROM users WHERE username = 'bot-ES'").get().pass_hash, '');
});

test('koniec sezonu: galeria sław i nowy świat', async () => {
  const { db, server, base } = await startServer();
  const a = client(base), b = client(base);
  await a('POST', '/api/register', { username: 'zosia', password: 'haslo1234' });
  await b('POST', '/api/register', { username: 'kuba', password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Zosia Air', code: 'ZA', hub: 'WAW' });
  await b('POST', '/api/airline', { name: 'Kuba Fly', code: 'KF', hub: 'KRK' });
  await b('POST', '/api/loan', { amount: 50e6 }); // dług obniża wartość firmy
  await a('POST', '/api/alliances', { name: 'Sezonowi' });
  runTick(db, calm, { seasonDays: 3 });
  assert.equal((await a('GET', '/api/season')).data.daysLeft, 3);
  for (let i = 0; i < 3; i++) runTick(db, calm, { seasonDays: 3 });
  const s = (await a('GET', '/api/season')).data;
  assert.equal(s.season, 2);
  assert.deepEqual(s.hall.map((h) => [h.place, h.code]), [[1, 'ZA'], [2, 'KF']]);
  assert.equal((await a('GET', '/api/airline')).status, 400);
  assert.equal((await a('GET', '/api/alliances')).data.length, 0);
  assert.equal((await a('POST', '/api/airline', { name: 'Zosia Air 2', code: 'ZB', hub: 'WAW' })).status, 200);
  assert.equal((await a('GET', '/api/airline')).data.airline.cash, 200e6);
  server.closeAllConnections();
  server.close();
});

test('fuzje i przejęcia oraz statystyki lotniska', async () => {
  const { ensureBots } = await import('../src/bots.js');
  const { tx, takeoverPrice } = await import('../src/game.js');
  const { db, server, base } = await startServer();
  const a = client(base), b = client(base), c = client(base);
  for (const [cl, u] of [[a, 'ala'], [b, 'bolek'], [c, 'celina']]) await cl('POST', '/api/register', { username: u, password: 'haslo1234' });
  await a('POST', '/api/airline', { name: 'Ala Air', code: 'AL', hub: 'WAW' });
  await b('POST', '/api/airline', { name: 'Bolek Jet', code: 'BJ', hub: 'KRK' });
  await c('POST', '/api/airline', { name: 'Celina Sky', code: 'CS', hub: 'GDN' });
  await a('POST', '/api/aircraft', { typeId: 'A320', mode: 'buy' });
  await b('POST', '/api/aircraft', { typeId: 'A320', mode: 'buy' });
  for (let i = 0; i < 6; i++) runTick(db, calm);
  const ra = (await a('POST', '/api/routes', { origin: 'WAW', dest: 'KRK' })).data.id;
  const rb = (await b('POST', '/api/routes', { origin: 'KRK', dest: 'WAW' })).data.id;
  const rb2 = (await b('POST', '/api/routes', { origin: 'KRK', dest: 'PRG' })).data.id;
  const acA = (await a('GET', '/api/airline')).data.fleet[0].id, acB = (await b('GET', '/api/airline')).data.fleet[0].id;
  await a('POST', `/api/aircraft/${acA}/assign`, { routeId: ra, roundTrips: 2 });
  await b('POST', `/api/aircraft/${acB}/assign`, { routeId: rb, roundTrips: 2 });
  await b('POST', `/api/aircraft/${acB}/assign`, { routeId: rb2, roundTrips: 1 });
  await b('POST', '/api/alliances', { name: 'Południe' });
  const alId = (await c('GET', '/api/alliances')).data[0].id;
  assert.equal((await c('POST', `/api/alliances/${alId}/join`)).status, 200);
  runTick(db, calm);

  // Statystyki lotniska: trasy wszystkich linii i popyt z moich baz.
  const ap = (await a('GET', '/api/airport/KRK')).data;
  assert.equal(ap.airport.code, 'KRK');
  assert.deepEqual(ap.airlines.map((x) => x.code).sort(), ['AL', 'BJ']);
  assert.equal(ap.totals.routes, 3);
  assert.deepEqual(ap.fromBases.map((x) => [x.code, x.mine, x.rivals]), [['WAW', true, 2]]);
  assert.ok(ap.top.length === 10 && ap.top[0].demand > 0);
  assert.equal((await a('GET', '/api/airport/XXX')).status, 400);
  assert.ok((await a('GET', '/api/airport/LHR')).data.slot.capacity > 0);

  // Oferta dla gracza: odrzucenie, potem akceptacja.
  const bId = db.prepare("SELECT id FROM airlines WHERE code = 'BJ'").get().id;
  assert.equal((await a('POST', '/api/takeovers', { airlineId: bId })).status, 400); // za mało pieniędzy
  db.prepare("UPDATE airlines SET cash = 1e9 WHERE code = 'AL'").run();
  assert.equal((await a('POST', '/api/takeovers', { airlineId: bId })).data.merged, false);
  let inc = (await b('GET', '/api/takeovers')).data.incoming;
  assert.equal(inc.length, 1);
  assert.equal((await b('GET', '/api/airline')).data.takeoverOffers, 1);
  assert.equal((await b('POST', `/api/takeovers/${inc[0].id}/reject`)).status, 200);
  assert.equal((await a('GET', '/api/takeovers')).data.outgoing.length, 0);
  await a('POST', '/api/takeovers', { airlineId: bId });
  inc = (await b('GET', '/api/takeovers')).data.incoming;
  const price = inc[0].price;
  const bCash = db.prepare('SELECT cash FROM airlines WHERE id = ?').get(bId).cash;
  assert.equal((await b('POST', `/api/takeovers/${inc[0].id}/accept`)).status, 200);
  const d = (await a('GET', '/api/airline')).data;
  assert.equal(d.fleet.length, 2);
  assert.deepEqual(d.bases.sort(), ['KRK', 'WAW']);
  assert.equal(d.routes.length, 2); // WAW–KRK połączone w jedną trasę
  assert.deepEqual(d.fleet.find((x) => x.id === acB).flights.map((f) => f.route_id).sort(), [ra, rb2].sort());
  assert.ok(Math.abs(d.airline.cash - (1e9 - price + bCash)) < 1);
  const al = (await c('GET', '/api/alliances')).data[0];
  assert.equal(al.members.length, 1);
  assert.equal((await c('GET', '/api/airline')).data.alliance.leader_id, db.prepare("SELECT id FROM airlines WHERE code = 'CS'").get().id);
  // Sprzedający zakłada nową linię z kapitałem powiększonym o cenę.
  assert.equal((await b('GET', '/api/airline')).status, 400);
  await b('POST', '/api/airline', { name: 'Bolek Jet 2', code: 'B2', hub: 'KRK' });
  assert.equal((await b('GET', '/api/airline')).data.airline.cash, price);

  // Linia komputerowa: przejęcie od razu i bez powrotu do końca sezonu.
  tx(db, () => ensureBots(db, 1, 7));
  const bot = db.prepare("SELECT * FROM airlines WHERE code = 'ES'").get();
  const botPrice = takeoverPrice(db, bot);
  assert.equal((await a('POST', '/api/takeovers', { airlineId: bot.id })).data.merged, true);
  assert.ok((await a('GET', '/api/airline')).data.bases.includes('MUC'));
  tx(db, () => ensureBots(db, 1, 8));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM airlines WHERE code = 'ES'").get().n, 0);
  assert.ok(botPrice >= RULES.takeoverMin);
  server.closeAllConnections();
  server.close();
});

test('odporność API na dziwne dane', async () => {
  const { server, base } = await startServer();
  const c = client(base);
  assert.equal((await c('POST', '/api/register', { username: ['bobby'], password: 'haslo1234' })).status, 400);
  const regs = await Promise.all([0, 1, 2].map(() => client(base)('POST', '/api/register', { username: 'tlok', password: 'haslo1234' })));
  assert.deepEqual(regs.map((r) => r.status).sort(), [200, 409, 409]);
  await c('POST', '/api/register', { username: 'dziwny', password: 'haslo1234' });
  await c('POST', '/api/airline', { name: 'Dziwna Linia', code: 'DZ', hub: 'WAW' });
  assert.equal((await c('POST', '/api/aircraft', { typeId: '__proto__', mode: 'buy' })).status, 400);
  // Kilka samolotów naraz: jedna płatność w dzienniku, każdy samolot osobno we flocie.
  assert.equal((await c('POST', '/api/aircraft', { typeId: 'ATR72', mode: 'lease', count: 0 })).status, 400);
  assert.equal((await c('POST', '/api/aircraft', { typeId: 'ATR72', mode: 'lease', count: 2.5 })).status, 400);
  assert.equal((await c('POST', '/api/aircraft', { typeId: 'ATR72', mode: 'buy', count: 3 })).data.count, 3);
  const d = (await c('GET', '/api/airline')).data;
  assert.equal(d.fleet.length, 3);
  assert.equal(d.airline.cash, RULES.startingCash - 3 * AIRCRAFT_TYPES.ATR72.price);
  assert.equal((await c('POST', '/api/aircraft', { typeId: 'A359', mode: 'buy', count: 20 })).status, 400); // za mało pieniędzy
  assert.equal((await c('GET', '/api/airline')).data.fleet.length, 3);
  assert.equal((await c('GET', '/api/airport/%E0')).status, 400);
  const bad = await fetch(base + '/api/me', { headers: { cookie: 'x=%zz' } });
  assert.equal(bad.status, 200);
  server.closeAllConnections();
  server.close();
});
