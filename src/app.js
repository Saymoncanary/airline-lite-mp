// Serwer HTTP: API w JSON + pliki statyczne interfejsu.
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRPORTS, AIRCRAFT_TYPES } from './data.js';
import {
  RULES, distanceKm, baseFare, dailyDemand, maxRoundTrips, leaseDaily, aircraftValue,
  pairKey, tx, currentDay, addNews, companyValue,
} from './game.js';
import {
  hashPassword, verifyPassword, createSession, userFromToken, destroySession,
  loginBlocked, recordLoginFailure, clearLoginFailures,
} from './auth.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };
const money = (n) => `$${(n / 1e6).toFixed(1)} mln`;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) fail(413, 'Za duże zapytanie');
  }
  try { return body ? JSON.parse(body) : {}; } catch { fail(400, 'Niepoprawny JSON'); }
}

export function createApp({ db, secureCookies = false }) {
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler });
  };

  const sessionCookie = (token, maxAge) =>
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  function getAirline(userId) {
    return db.prepare('SELECT * FROM airlines WHERE user_id = ?').get(userId);
  }
  function requireAirline(ctx) {
    const a = getAirline(ctx.user.id);
    if (!a) fail(400, 'Najpierw załóż linię lotniczą');
    return a;
  }
  function spend(airline, amount) {
    if (airline.cash < amount) fail(400, `Brak środków (potrzeba ${money(amount)})`);
    db.prepare('UPDATE airlines SET cash = cash - ? WHERE id = ?').run(amount, airline.id);
  }
  function airportOr400(code) {
    const a = AIRPORTS[String(code || '').toUpperCase()];
    if (!a) fail(400, `Nieznane lotnisko: ${code}`);
    return a.code;
  }

  // --- Konto ---------------------------------------------------------------
  on('POST', '/api/register', async (ctx) => {
    const { username, password } = await readJson(ctx.req);
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) fail(400, 'Login: 3-20 znaków (litery, cyfry, _)');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) fail(400, 'Hasło musi mieć co najmniej 8 znaków');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'Ten login jest zajęty');
    const { salt, hash } = await hashPassword(password);
    const { lastInsertRowid } = db.prepare('INSERT INTO users(username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)').run(username, hash, salt, Date.now());
    const s = createSession(db, Number(lastInsertRowid));
    ctx.res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge));
    return { ok: true };
  });

  on('POST', '/api/login', async (ctx) => {
    if (loginBlocked(ctx.ip)) fail(429, 'Za dużo prób logowania. Spróbuj za kilka minut.');
    const { username, password } = await readJson(ctx.req);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
    if (!u || typeof password !== 'string' || !(await verifyPassword(password, u.salt, u.pass_hash))) {
      recordLoginFailure(ctx.ip);
      fail(401, 'Nieprawidłowy login lub hasło');
    }
    clearLoginFailures(ctx.ip);
    const s = createSession(db, u.id);
    ctx.res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge));
    return { ok: true };
  });

  on('POST', '/api/logout', async (ctx) => {
    destroySession(db, ctx.token);
    ctx.res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  });

  on('GET', '/api/me', (ctx) => ({ user: ctx.user, airline: ctx.user ? getAirline(ctx.user.id) || null : null }));

  on('GET', '/api/static', () => ({ airports: Object.values(AIRPORTS), aircraftTypes: Object.values(AIRCRAFT_TYPES), rules: RULES }));

  // --- Linia lotnicza ------------------------------------------------------
  on('POST', '/api/airline', async (ctx) => {
    const body = await readJson(ctx.req);
    if (getAirline(ctx.user.id)) fail(400, 'Masz już linię lotniczą');
    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim().toUpperCase();
    if (name.length < 3 || name.length > 40) fail(400, 'Nazwa: 3-40 znaków');
    if (!/^[A-Z0-9]{2}$/.test(code)) fail(400, 'Kod linii: 2 znaki (np. LO)');
    const hub = airportOr400(body.hub);
    if (db.prepare('SELECT 1 FROM airlines WHERE name = ? OR code = ?').get(name, code)) fail(409, 'Nazwa lub kod linii są już zajęte');
    tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO airlines(user_id, name, code, hub, cash, founded_day) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ctx.user.id, name, code, hub, RULES.startingCash, currentDay(db));
      db.prepare('INSERT INTO bases(airline_id, airport) VALUES (?, ?)').run(Number(lastInsertRowid), hub);
      addNews(db, `Nowa linia ${name} (${code}) startuje! Baza: ${AIRPORTS[hub].city} (${hub}).`);
    });
    return { ok: true };
  });

  on('GET', '/api/airline', (ctx) => {
    const airline = requireAirline(ctx);
    const day = currentDay(db);
    const bases = db.prepare('SELECT airport FROM bases WHERE airline_id = ?').all(airline.id).map((b) => b.airport);
    const fleet = db.prepare('SELECT * FROM aircraft WHERE airline_id = ? ORDER BY id').all(airline.id).map((a) => {
      const t = AIRCRAFT_TYPES[a.type_id];
      return { ...a, value: a.leased ? 0 : aircraftValue(t, day - a.acquired_day), leaseDaily: a.leased ? leaseDaily(t) : 0 };
    });
    const routes = db.prepare('SELECT * FROM routes WHERE airline_id = ? ORDER BY id').all(airline.id).map((r) => ({
      ...r, distance: distanceKm(r.origin, r.dest), baseFare: baseFare(distanceKm(r.origin, r.dest)),
    }));
    const stats = db.prepare('SELECT day, revenue, costs, pax FROM daily_stats WHERE airline_id = ? ORDER BY day DESC LIMIT 30').all(airline.id).reverse();
    return { day, airline: { ...airline, value: companyValue(db, airline, day) }, bases, fleet, routes, stats };
  });

  // --- Flota ---------------------------------------------------------------
  on('POST', '/api/aircraft', async (ctx) => {
    const { typeId, mode } = await readJson(ctx.req);
    const t = AIRCRAFT_TYPES[typeId] || fail(400, 'Nieznany typ samolotu');
    if (!['buy', 'lease'].includes(mode)) fail(400, 'Tryb: buy lub lease');
    tx(db, () => {
      const airline = requireAirline(ctx);
      spend(airline, mode === 'buy' ? t.price : t.price * RULES.leaseDepositPct);
      db.prepare('INSERT INTO aircraft(airline_id, type_id, leased, acquired_day) VALUES (?, ?, ?, ?)')
        .run(airline.id, t.id, mode === 'lease' ? 1 : 0, currentDay(db));
    });
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/assign', async (ctx) => {
    const { routeId, roundTrips } = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const ac = db.prepare('SELECT * FROM aircraft WHERE id = ? AND airline_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie znaleziono samolotu');
    if (routeId == null) {
      db.prepare('UPDATE aircraft SET route_id = NULL, round_trips = 0 WHERE id = ?').run(ac.id);
      return { ok: true };
    }
    const r = db.prepare('SELECT * FROM routes WHERE id = ? AND airline_id = ?').get(Number(routeId), airline.id) || fail(404, 'Nie znaleziono trasy');
    const t = AIRCRAFT_TYPES[ac.type_id];
    const dist = distanceKm(r.origin, r.dest);
    if (dist > t.rangeKm) fail(400, `Za mały zasięg: ${t.rangeKm} km, trasa ma ${dist} km`);
    const max = maxRoundTrips(t, dist);
    const n = Number(roundTrips ?? max);
    if (!(n > 0 && n <= max && (Number.isInteger(n) || n === 0.5))) fail(400, `Liczba rotacji dziennie: od 1 do ${max}`);
    db.prepare('UPDATE aircraft SET route_id = ?, round_trips = ? WHERE id = ?').run(r.id, n, ac.id);
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/sell', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const ac = db.prepare('SELECT * FROM aircraft WHERE id = ? AND airline_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie znaleziono samolotu');
      const t = AIRCRAFT_TYPES[ac.type_id];
      if (ac.leased) spend(airline, leaseDaily(t) * RULES.earlyReturnLeaseDays);
      else db.prepare('UPDATE airlines SET cash = cash + ? WHERE id = ?').run(aircraftValue(t, currentDay(db) - ac.acquired_day), airline.id);
      db.prepare('DELETE FROM aircraft WHERE id = ?').run(ac.id);
    });
    return { ok: true };
  });

  // --- Trasy ---------------------------------------------------------------
  on('GET', '/api/market', (ctx) => {
    const a = airportOr400(ctx.query.get('origin'));
    const b = airportOr400(ctx.query.get('dest'));
    if (a === b) fail(400, 'Wybierz dwa różne lotniska');
    const dist = distanceKm(a, b);
    const competitors = db.prepare(
      `SELECT al.name, al.code, r.price, r.last_seats AS seats, r.last_pax AS pax FROM routes r JOIN airlines al ON al.id = r.airline_id
       WHERE (r.origin = ? AND r.dest = ?) OR (r.origin = ? AND r.dest = ?)`
    ).all(a, b, b, a);
    return { distance: dist, baseFare: baseFare(dist), dailyDemand: dailyDemand(a, b), competitors };
  });

  on('POST', '/api/routes', async (ctx) => {
    const body = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const origin = airportOr400(body.origin);
    const dest = airportOr400(body.dest);
    if (origin === dest) fail(400, 'Wybierz dwa różne lotniska');
    if (!db.prepare('SELECT 1 FROM bases WHERE airline_id = ? AND airport = ?').get(airline.id, origin)) fail(400, 'Trasa musi startować z Twojej bazy');
    const exists = db.prepare('SELECT origin, dest FROM routes WHERE airline_id = ?').all(airline.id).some((r) => pairKey(r.origin, r.dest) === pairKey(origin, dest));
    if (exists) fail(409, 'Już latasz na tej trasie');
    const price = Math.round(Number(body.price) || baseFare(distanceKm(origin, dest)));
    if (!(price >= 10 && price <= 20000)) fail(400, 'Cena biletu: 10-20000 USD');
    const { lastInsertRowid } = db.prepare('INSERT INTO routes(airline_id, origin, dest, price, created_day) VALUES (?, ?, ?, ?, ?)')
      .run(airline.id, origin, dest, price, currentDay(db));
    addNews(db, `${airline.name} otwiera trasę ${AIRPORTS[origin].city} – ${AIRPORTS[dest].city}.`);
    return { ok: true, id: Number(lastInsertRowid) };
  });

  on('PATCH', '/api/routes/:id', async (ctx) => {
    const { price } = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const p = Math.round(Number(price));
    if (!(p >= 10 && p <= 20000)) fail(400, 'Cena biletu: 10-20000 USD');
    const r = db.prepare('UPDATE routes SET price = ? WHERE id = ? AND airline_id = ?').run(p, Number(ctx.params.id), airline.id);
    if (!r.changes) fail(404, 'Nie znaleziono trasy');
    return { ok: true };
  });

  on('DELETE', '/api/routes/:id', async (ctx) => {
    await readJson(ctx.req);
    const airline = requireAirline(ctx);
    tx(db, () => {
      db.prepare('UPDATE aircraft SET route_id = NULL, round_trips = 0 WHERE route_id = ? AND airline_id = ?').run(Number(ctx.params.id), airline.id);
      const r = db.prepare('DELETE FROM routes WHERE id = ? AND airline_id = ?').run(Number(ctx.params.id), airline.id);
      if (!r.changes) fail(404, 'Nie znaleziono trasy');
    });
    return { ok: true };
  });

  // --- Finanse i bazy ------------------------------------------------------
  on('POST', '/api/bases', async (ctx) => {
    const body = await readJson(ctx.req);
    const code = airportOr400(body.airport);
    tx(db, () => {
      const airline = requireAirline(ctx);
      if (db.prepare('SELECT 1 FROM bases WHERE airline_id = ? AND airport = ?').get(airline.id, code)) fail(409, 'Już masz tu bazę');
      spend(airline, AIRPORTS[code].size * RULES.baseCostPerSize);
      db.prepare('INSERT INTO bases(airline_id, airport) VALUES (?, ?)').run(airline.id, code);
      addNews(db, `${airline.name} otwiera nową bazę: ${AIRPORTS[code].city} (${code}).`);
    });
    return { ok: true };
  });

  on('POST', '/api/loan', async (ctx) => {
    const amount = Math.round(Number((await readJson(ctx.req)).amount));
    if (!Number.isFinite(amount) || amount === 0) fail(400, 'Podaj kwotę');
    tx(db, () => {
      const airline = requireAirline(ctx);
      if (amount > 0 && airline.debt + amount > RULES.maxDebt) fail(400, `Limit kredytu to ${money(RULES.maxDebt)}`);
      if (amount < 0 && -amount > airline.debt) fail(400, 'Nie możesz spłacić więcej niż wynosi dług');
      if (amount < 0) spend(airline, -amount);
      else db.prepare('UPDATE airlines SET cash = cash + ? WHERE id = ?').run(amount, airline.id);
      db.prepare('UPDATE airlines SET debt = debt + ? WHERE id = ?').run(amount, airline.id);
    });
    return { ok: true };
  });

  // --- Rywalizacja ---------------------------------------------------------
  on('GET', '/api/leaderboard', () => {
    const day = currentDay(db);
    const rows = db.prepare(
      `SELECT a.*, u.username,
        (SELECT COUNT(*) FROM aircraft WHERE airline_id = a.id) AS fleet,
        (SELECT COUNT(*) FROM routes WHERE airline_id = a.id) AS routes,
        (SELECT COALESCE(SUM(last_pax), 0) FROM routes WHERE airline_id = a.id) AS pax
       FROM airlines a JOIN users u ON u.id = a.user_id`
    ).all();
    return rows
      .map((a) => ({ name: a.name, code: a.code, owner: a.username, hub: a.hub, reputation: a.reputation, fleet: a.fleet, routes: a.routes, pax: a.pax, value: companyValue(db, a, day) }))
      .sort((x, y) => y.value - x.value);
  });

  on('GET', '/api/news', () => db.prepare('SELECT day, text FROM news ORDER BY id DESC LIMIT 30').all());

  on('GET', '/api/routes/all', () =>
    db.prepare('SELECT r.origin, r.dest, a.code FROM routes r JOIN airlines a ON a.id = r.airline_id').all());

  // --- Obsługa żądań -------------------------------------------------------
  async function serveStatic(pathname, res) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return false;
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && (await serveStatic(url.pathname, res))) return;
        return send(404, { error: 'Nie znaleziono' });
      }
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) return send(404, { error: 'Nie znaleziono' });
      // Wymaganie JSON-a chroni przed atakami CSRF z formularzy innych stron.
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Wymagany JSON' });
      const token = parseCookies(req.headers.cookie).sid;
      const ctx = {
        req, res, token, query: url.searchParams,
        ip: req.socket.remoteAddress,
        user: userFromToken(db, token),
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(url.pathname.match(route.re)[i + 1])])),
      };
      const isPublic = ['/api/register', '/api/login', '/api/me', '/api/static', '/api/leaderboard', '/api/news'].includes(url.pathname);
      if (!ctx.user && !isPublic) return send(401, { error: 'Zaloguj się' });
      send(200, await route.handler(ctx));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'Błąd serwera' });
    }
  };
}
