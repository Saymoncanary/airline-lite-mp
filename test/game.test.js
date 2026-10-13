import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runTick, allocateMarket } from '../src/game.js';

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
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id, roundTrips: 99 })).status, 400);
  assert.equal((await a('POST', `/api/aircraft/${fa.id}/assign`, { routeId: ra.data.id })).status, 200);
  assert.equal((await b('POST', `/api/aircraft/${fb.id}/assign`, { routeId: rb.data.id })).status, 200);
  // Nie można sterować cudzym samolotem.
  assert.equal((await b('POST', `/api/aircraft/${fa.id}/assign`, { routeId: rb.data.id })).status, 404);

  for (let i = 0; i < 5; i++) runTick(db);

  const A = (await a('GET', '/api/airline')).data;
  const B = (await b('GET', '/api/airline')).data;
  assert.equal(A.day, 5);
  assert.equal(A.stats.length, 5);
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
