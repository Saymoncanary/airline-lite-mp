// Serwer HTTP: API w JSON + pliki statyczne interfejsu.
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRPORTS, AIRCRAFT_TYPES } from './data.js';
import {
  RULES, CLASSES, MONTHS, LIVERY_LOGOS, ACHIEVEMENTS, achievementStats, isSlotAirport, slotCapacity, slotPrice, slotUsage, distanceKm, baseFare, classFare, classShare, dailyDemand, maxRoundTrips, roundTripHours, leaseDaily, aircraftValue,
  seatMap, validSeatConfig, maintenanceCost, routePrices, seasonMult, gameMonth, activeEvents,
  pairKey, tx, currentDay, addNews, companyValue, takeoverPrice, mergeAirlines, report, buyoutPrice, routeGroups,
} from './game.js';
import {
  hashPassword, verifyPassword, createSession, userFromToken, destroySession,
  loginBlocked, recordLoginFailure, clearLoginFailures,
} from './auth.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.geojson': 'application/geo+json', '.png': 'image/png', '.ico': 'image/x-icon' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };
const money = (n) => `$${(n / 1e6).toFixed(1)} mln`;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, safeDecode(v.join('='))]));
}
// Błędnie zakodowany tekst (np. obce ciasteczko „x=%zz”) nie może wywracać zapytania.
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) fail(413, 'Za duże zapytanie');
  }
  try { return body ? JSON.parse(body) : {}; } catch { fail(400, 'Niepoprawny JSON'); }
}

export function createApp({ db, clock = null, secureCookies = false, trustProxy = false }) {
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
  // Zapis operacji gotówkowej w dzienniku linii (+ wpływ, − wydatek).
  function ledger(airlineId, amount, text) {
    db.prepare('INSERT INTO ledger(airline_id, day, amount, text) VALUES (?, ?, ?, ?)').run(airlineId, currentDay(db), amount, text);
  }
  function spend(airline, amount, text) {
    if (airline.cash < amount) fail(400, `Brak środków (potrzeba ${money(amount)})`);
    db.prepare('UPDATE airlines SET cash = cash - ? WHERE id = ?').run(amount, airline.id);
    ledger(airline.id, -amount, text);
  }
  function earn(airlineId, amount, text) {
    db.prepare('UPDATE airlines SET cash = cash + ? WHERE id = ?').run(amount, airlineId);
    ledger(airlineId, amount, text);
  }
  function airportOr400(code) {
    const a = AIRPORTS[String(code || '').toUpperCase()];
    if (!a) fail(400, `Nieznane lotnisko: ${code}`);
    return a.code;
  }

  // --- Konto ---------------------------------------------------------------
  on('POST', '/api/register', async (ctx) => {
    const { username, password } = await readJson(ctx.req);
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) fail(400, 'Login: 3-20 znaków (litery, cyfry, _)');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) fail(400, 'Hasło musi mieć co najmniej 8 znaków');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'Ten login jest zajęty');
    const { salt, hash } = await hashPassword(password);
    // Ktoś mógł zająć ten login w czasie liczenia skrótu hasła.
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'Ten login jest zajęty');
    const { lastInsertRowid } = db.prepare('INSERT INTO users(username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)').run(username, hash, salt, Date.now());
    const s = createSession(db, Number(lastInsertRowid));
    ctx.res.setHeader('Set-Cookie', sessionCookie(s.token, s.maxAge));
    return { ok: true };
  });

  on('POST', '/api/login', async (ctx) => {
    const { username, password } = await readJson(ctx.req);
    const key = `${ctx.ip}|${String(username || '').toLowerCase()}`;
    if (loginBlocked(key)) fail(429, 'Za dużo prób logowania. Spróbuj za kilka minut.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
    if (!u || typeof password !== 'string' || !(await verifyPassword(password, u.salt, u.pass_hash))) {
      recordLoginFailure(key);
      fail(401, 'Nieprawidłowy login lub hasło');
    }
    clearLoginFailures(key);
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

  on('GET', '/api/static', () => ({ airports: Object.values(AIRPORTS), aircraftTypes: Object.values(AIRCRAFT_TYPES), rules: RULES, logos: LIVERY_LOGOS,
    achievements: ACHIEVEMENTS.map(({ key, name, desc, reward }) => ({ key, name, desc, reward })) }));

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
    // Losowe barwy na start; gracz zmieni je w zakładce „Linia”.
    const palette = ['#1d4ed8', '#dc2626', '#16a34a', '#7c3aed', '#ea580c', '#0e7490', '#be185d', '#ca8a04', '#0f172a'];
    const c1 = palette[Math.floor(Math.random() * palette.length)];
    const c2 = palette.filter((c) => c !== c1)[Math.floor(Math.random() * (palette.length - 1))];
    tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO airlines(user_id, name, code, hub, cash, founded_day, color1, color2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.user.id, name, code, hub, RULES.startingCash, currentDay(db), c1, c2);
      db.prepare('INSERT INTO bases(airline_id, airport) VALUES (?, ?)').run(Number(lastInsertRowid), hub);
      // Kto sprzedał linię w tym sezonie, zaczyna za pieniądze ze sprzedaży zamiast kapitału startowego
      // (inaczej sprzedawanie linii znajomemu i zakładanie nowej tworzyłoby pieniądze z niczego).
      const { bonus_cash: bonus } = db.prepare('SELECT bonus_cash FROM users WHERE id = ?').get(ctx.user.id);
      if (bonus > 0) {
        db.prepare('UPDATE airlines SET cash = ? WHERE id = ?').run(bonus, Number(lastInsertRowid));
        ledger(Number(lastInsertRowid), bonus, 'Kapitał ze sprzedaży poprzedniej linii');
        db.prepare('UPDATE users SET bonus_cash = 0 WHERE id = ?').run(ctx.user.id);
      }
      if (isSlotAirport(hub)) {
        const free = Math.min(RULES.hubFreeSlots, slotCapacity(hub, db) - db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM slots WHERE airport = ?').get(hub).n);
        if (free > 0) db.prepare('INSERT INTO slots(airline_id, airport, count) VALUES (?, ?, ?)').run(Number(lastInsertRowid), hub, free);
      }
      addNews(db, `Nowa linia ${name} (${code}) startuje! Baza: ${AIRPORTS[hub].city} (${hub}).`);
    });
    return { ok: true };
  });

  on('POST', '/api/airline/livery', async (ctx) => {
    const { color1, color2, logo } = await readJson(ctx.req);
    const hex = /^#[0-9a-fA-F]{6}$/;
    if (!hex.test(color1) || !hex.test(color2)) fail(400, 'Kolor w formacie #RRGGBB');
    if (!LIVERY_LOGOS.includes(logo)) fail(400, 'Nieznany symbol');
    db.prepare('UPDATE airlines SET color1 = ?, color2 = ?, logo = ? WHERE id = ?').run(color1.toLowerCase(), color2.toLowerCase(), logo, requireAirline(ctx).id);
    return { ok: true };
  });

  on('POST', '/api/airline/staff', async (ctx) => {
    const body = await readJson(ctx.req);
    const wage = Math.round(Number(body.wage)), service = Number(body.service);
    if (!(wage >= RULES.wageMin && wage <= RULES.wageMax)) fail(400, `Pensje: ${RULES.wageMin}-${RULES.wageMax}% normy`);
    if (!(Number.isInteger(service) && service >= 1 && service <= RULES.serviceLevels.length)) fail(400, 'Nieznany poziom obsługi');
    db.prepare('UPDATE airlines SET wage = ?, service = ?, loyalty = ? WHERE id = ?').run(wage, service, body.loyalty ? 1 : 0, requireAirline(ctx).id);
    return { ok: true };
  });

  // --- Sloty ------------------------------------------------------------------
  const slotsUsed = (code) => db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM slots WHERE airport = ?').get(code).n;
  on('GET', '/api/slots', (ctx) => {
    const airline = requireAirline(ctx);
    const use = slotUsage(db, airline.id);
    return Object.values(AIRPORTS).filter((a) => isSlotAirport(a.code)).map((a) => {
      const used = slotsUsed(a.code), cap = slotCapacity(a.code, db);
      return {
        code: a.code, city: a.city, country: a.country, capacity: cap, used, price: slotPrice(a.code, used, cap),
        sellPrice: Math.round(slotPrice(a.code, Math.max(0, used - 1), cap) * RULES.slotSellBack),
        mine: db.prepare('SELECT count FROM slots WHERE airline_id = ? AND airport = ?').get(airline.id, a.code)?.count || 0,
        myUse: use.get(a.code) || 0,
      };
    }).sort((x, y) => y.mine - x.mine || x.city.localeCompare(y.city, 'pl'));
  });

  on('POST', '/api/slots', async (ctx) => {
    const body = await readJson(ctx.req);
    const code = airportOr400(body.airport), count = Number(body.count);
    if (!isSlotAirport(code)) fail(400, 'To lotnisko nie ma limitu slotów');
    if (!Number.isInteger(count) || count === 0 || Math.abs(count) > 20) fail(400, 'Liczba slotów: od 1 do 20');
    tx(db, () => {
      const airline = requireAirline(ctx);
      const mine = db.prepare('SELECT count FROM slots WHERE airline_id = ? AND airport = ?').get(airline.id, code)?.count || 0;
      let used = slotsUsed(code), total = 0;
      if (count > 0) {
        const cap = slotCapacity(code, db);
        if (used + count > cap) fail(400, `Na ${code} zostało tylko ${cap - used} wolnych slotów`);
        for (let i = 0; i < count; i++) total += slotPrice(code, used++, cap);
        spend(airline, total, `Zakup ${count} slotów: ${AIRPORTS[code].city} (${code})`);
      } else {
        const n = -count;
        if (n > mine) fail(400, 'Nie masz tylu slotów');
        if (mine - n < (slotUsage(db, airline.id).get(code) || 0)) fail(400, 'Te sloty są zajęte przez Twoje loty. Najpierw zmniejsz rotacje.');
        for (let i = 0; i < n; i++) total += Math.round(slotPrice(code, --used, slotCapacity(code, db)) * RULES.slotSellBack);
        earn(airline.id, total, `Sprzedaż ${n} slotów: ${AIRPORTS[code].city} (${code})`);
      }
      db.prepare('INSERT INTO slots(airline_id, airport, count) VALUES (?, ?, ?) ON CONFLICT(airline_id, airport) DO UPDATE SET count = count + excluded.count')
        .run(airline.id, code, count);
      db.prepare('DELETE FROM slots WHERE count <= 0').run();
    });
    return { ok: true };
  });

  // Linie, które latały na te lotniska przed wprowadzeniem slotów, dostają sloty za darmo.
  for (const { id } of db.prepare('SELECT id FROM airlines').all()) {
    for (const [ap, n] of slotUsage(db, id)) {
      db.prepare('INSERT INTO slots(airline_id, airport, count) VALUES (?, ?, ?) ON CONFLICT(airline_id, airport) DO UPDATE SET count = MAX(count, excluded.count)').run(id, ap, n);
    }
  }

  // --- Marketing -------------------------------------------------------------
  on('GET', '/api/campaigns', (ctx) =>
    db.prepare('SELECT * FROM campaigns WHERE airline_id = ? AND end_day > ? ORDER BY end_day').all(requireAirline(ctx).id, currentDay(db)));

  on('POST', '/api/campaigns', async (ctx) => {
    const body = await readJson(ctx.req);
    const level = Number(body.level), country = String(body.country || '');
    if (!RULES.campaignLevels[level]) fail(400, 'Nieznany rozmiar kampanii');
    if (!Object.values(AIRPORTS).some((a) => a.country === country)) fail(400, 'Nieznany kraj');
    tx(db, () => {
      const airline = requireAirline(ctx);
      const day = currentDay(db);
      const active = db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE airline_id = ? AND end_day >= ?').get(airline.id, day + 1).n;
      if (active >= RULES.maxCampaigns) fail(400, `Możesz prowadzić najwyżej ${RULES.maxCampaigns} kampanii naraz`);
      db.prepare('INSERT INTO campaigns(airline_id, country, level, start_day, end_day) VALUES (?, ?, ?, ?, ?)')
        .run(airline.id, country, level, day + 1, day + RULES.campaignDays);
    });
    return { ok: true };
  });

  on('DELETE', '/api/campaigns/:id', async (ctx) => {
    await readJson(ctx.req);
    const r = db.prepare('UPDATE campaigns SET end_day = ? WHERE id = ? AND airline_id = ? AND end_day > ?')
      .run(currentDay(db), Number(ctx.params.id), requireAirline(ctx).id, currentDay(db));
    if (!r.changes) fail(404, 'Nie ma takiej kampanii');
    return { ok: true };
  });

  function myAlliance(airlineId) {
    const m = db.prepare('SELECT alliance_id FROM alliance_members WHERE airline_id = ?').get(airlineId);
    if (!m) return null;
    const al = db.prepare('SELECT * FROM alliances WHERE id = ?').get(m.alliance_id);
    const members = db.prepare(
      `SELECT a.id, a.name, a.code, a.hub, m.joined_day FROM alliance_members m JOIN airlines a ON a.id = m.airline_id
       WHERE m.alliance_id = ? ORDER BY m.joined_day, a.id`
    ).all(al.id).map((a) => ({ ...a, bases: db.prepare('SELECT airport FROM bases WHERE airline_id = ?').all(a.id).map((b) => b.airport) }));
    return { ...al, members };
  }

  on('GET', '/api/airline', (ctx) => {
    const airline = requireAirline(ctx);
    const day = currentDay(db);
    const bases = db.prepare('SELECT airport FROM bases WHERE airline_id = ?').all(airline.id).map((b) => b.airport);
    const flightsOf = db.prepare('SELECT route_id, round_trips FROM flights WHERE aircraft_id = ? ORDER BY route_id');
    const fleet = db.prepare(
      'SELECT a.*, l.id AS listing_id, l.price AS listing_price FROM aircraft a LEFT JOIN used_listings l ON l.aircraft_id = a.id WHERE a.airline_id = ? ORDER BY a.id'
    ).all(airline.id).map((a) => {
      const t = AIRCRAFT_TYPES[a.type_id];
      return {
        ...a, value: a.leased ? 0 : aircraftValue(t, Math.max(0, day - a.acquired_day), a.condition),
        flights: flightsOf.all(a.id), leaseDaily: a.leased ? leaseDaily(t) : 0,
        buyout: a.leased ? buyoutPrice(t, Math.max(0, day - a.acquired_day)) : 0, seatMap: seatMap(t, a.seats_j, a.seats_f), maintenanceCost: maintenanceCost(t, a.condition),
      };
    });
    const routes = db.prepare('SELECT * FROM routes WHERE airline_id = ? ORDER BY id').all(airline.id).map((r) => {
      const dist = distanceKm(r.origin, r.dest);
      return {
        ...r, distance: dist, prices: routePrices(r), detail: r.last_detail ? JSON.parse(r.last_detail) : null,
        refFares: Object.fromEntries(CLASSES.map((c) => [c, classFare(c, dist)])),
      };
    });
    const stats = db.prepare('SELECT day, revenue, costs, pax FROM daily_stats WHERE airline_id = ? ORDER BY day DESC LIMIT 30').all(airline.id).reverse();
    const world = {
      fuel: db.prepare('SELECT fuel FROM game_state WHERE id = 1').get().fuel,
      season: seasonMult(day), month: MONTHS[gameMonth(day)],
      events: activeEvents(db, day).filter((e) => e.kind !== 'fuel').map((e) => ({ text: e.text, endDay: e.end_day })),
    };
    const nextDayIn = clock ? Math.max(0, clock.nextTickAt - Date.now()) : null;
    const achievements = db.prepare('SELECT key, day FROM achievements WHERE airline_id = ?').all(airline.id);
    const progress = achievementStats(db, airline, day, { profit: stats.at(-1) ? stats.at(-1).revenue - stats.at(-1).costs : 0 });
    const goals = ACHIEVEMENTS.map((g) => ({ key: g.key, progress: g.progress(progress) }));
    return { day, nextDayIn, airline: { ...airline, value: companyValue(db, airline, day) }, bases, fleet, routes, stats, world, alliance: myAlliance(airline.id), achievements, goals,
      takeoverOffers: db.prepare('SELECT COUNT(*) AS n FROM takeover_offers WHERE target_id = ?').get(airline.id).n,
      codeshareOffers: db.prepare("SELECT COUNT(*) AS n FROM codeshares WHERE b_id = ? AND status = 'pending'").get(airline.id).n,
      terminals: Object.fromEntries(db.prepare('SELECT airport, terminal FROM bases WHERE airline_id = ?').all(airline.id).map((b) => [b.airport, b.terminal])),
      reports: db.prepare('SELECT day, kind, text FROM reports WHERE airline_id = ? AND day >= ? ORDER BY id DESC LIMIT 60').all(airline.id, day - 2) };
  });

  on('POST', '/api/airline/settings', async (ctx) => {
    const { autoMaint } = await readJson(ctx.req);
    const v = Math.round(Number(autoMaint));
    if (!(v >= 0 && v <= 95)) fail(400, 'Próg przeglądu: 0-95% (0 = wyłączone)');
    db.prepare('UPDATE airlines SET auto_maint = ? WHERE id = ?').run(v, requireAirline(ctx).id);
    return { ok: true };
  });

  // --- Flota ---------------------------------------------------------------
  function myAircraft(ctx, airline) {
    return db.prepare('SELECT * FROM aircraft WHERE id = ? AND airline_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie znaleziono samolotu');
  }

  // Nowe samoloty się zamawia: przylatują po kilku dniach gry, zależnie od wielkości.
  on('POST', '/api/aircraft', async (ctx) => {
    const { typeId, mode, count = 1 } = await readJson(ctx.req);
    const t = (typeof typeId === 'string' && Object.hasOwn(AIRCRAFT_TYPES, typeId) && AIRCRAFT_TYPES[typeId]) || fail(400, 'Nieznany typ samolotu');
    if (!['buy', 'lease'].includes(mode)) fail(400, 'Tryb: buy lub lease');
    if (!Number.isInteger(count) || count < 1 || count > RULES.maxOrder) fail(400, `Liczba samolotów: 1-${RULES.maxOrder}`);
    const day = currentDay(db);
    const delivery = day + RULES.deliveryDays[t.cat];
    tx(db, () => {
      const airline = requireAirline(ctx);
      const each = mode === 'buy' ? t.price : t.price * RULES.leaseDepositPct;
      spend(airline, each * count, `${mode === 'buy' ? 'Zakup' : 'Leasing (wpłata)'}: ${count > 1 ? `${count}× ` : ''}${t.name}`);
      const ins = db.prepare('INSERT INTO aircraft(airline_id, type_id, leased, acquired_day, delivery_day) VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < count; i++) ins.run(airline.id, t.id, mode === 'lease' ? 1 : 0, delivery, delivery);
    });
    return { ok: true, count, deliveryDays: delivery - day };
  });

  // Ustawia liczbę rotacji samolotu na jednej trasie (0 = zdejmuje go z tej trasy).
  // routeId = null zdejmuje samolot ze wszystkich tras.
  on('POST', '/api/aircraft/:id/assign', async (ctx) => {
    // fit = true: gdy brakuje godzin albo slotów, przypisz tyle rotacji, ile się zmieści.
    const { routeId, roundTrips, fit = false } = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const ac = myAircraft(ctx, airline);
    if (routeId == null) {
      db.prepare('DELETE FROM flights WHERE aircraft_id = ?').run(ac.id);
      return { ok: true };
    }
    const r = db.prepare('SELECT * FROM routes WHERE id = ? AND airline_id = ?').get(Number(routeId), airline.id) || fail(404, 'Nie znaleziono trasy');
    const others = db.prepare('SELECT r.id, r.origin, r.dest FROM flights f JOIN routes r ON r.id = f.route_id WHERE f.aircraft_id = ? AND f.route_id != ?').all(ac.id, r.id);
    if (roundTrips === 0) {
      // Zdjęcie trasy nie może rozerwać sieci samolotu na dwie osobne części.
      if (routeGroups(others).length > 1) fail(400, `Bez trasy ${r.origin}–${r.dest} pozostałe trasy tego samolotu nie byłyby połączone. Najpierw zdejmij trasy po jednej stronie.`);
      db.prepare('DELETE FROM flights WHERE aircraft_id = ? AND route_id = ?').run(ac.id, r.id);
      return { ok: true };
    }
    // Nowa trasa musi mieć wspólne lotnisko z którąś z tras, na których samolot już lata.
    if (others.length && !others.some((x) => [x.origin, x.dest].some((ap) => ap === r.origin || ap === r.dest))) {
      fail(400, `Samolot lata już na ${others.map((x) => `${x.origin}–${x.dest}`).join(', ')}. Trasa ${r.origin}–${r.dest} nie ma z nimi wspólnego lotniska, więc samolot nie może jej obsługiwać.`);
    }
    if (ac.delivery_day > currentDay(db)) fail(400, 'Ten samolot nie został jeszcze dostarczony');
    const t = AIRCRAFT_TYPES[ac.type_id];
    const dist = distanceKm(r.origin, r.dest);
    if (dist > t.rangeKm) fail(400, `Za mały zasięg: ${t.rangeKm} km, trasa ma ${dist} km`);
    const usedHours = db.prepare('SELECT f.round_trips, r.origin, r.dest FROM flights f JOIN routes r ON r.id = f.route_id WHERE f.aircraft_id = ? AND f.route_id != ?')
      .all(ac.id, r.id).reduce((h, f) => h + f.round_trips * roundTripHours(t, distanceKm(f.origin, f.dest)), 0);
    const max = maxRoundTrips(t, dist, RULES.operatingHours - usedHours);
    if (!max) fail(400, 'Ten samolot nie ma już wolnych godzin na tę trasę');
    let n = Number(roundTrips ?? max);
    const valid = (x) => x > 0 && (Number.isInteger(x) || x === 0.5);
    if (fit && valid(n) && n > max) n = max;
    if (!(valid(n) && n <= max)) fail(400, `Liczba rotacji dziennie na tej trasie: od ${max < 1 ? 0.5 : 1} do ${max}`);
    const have = (ap) => db.prepare('SELECT count FROM slots WHERE airline_id = ? AND airport = ?').get(airline.id, ap)?.count || 0;
    const need = (x) => slotUsage(db, airline.id, { aircraft_id: ac.id, route_id: r.id, round_trips: x, origin: r.origin, dest: r.dest });
    const slotOk = (x) => [r.origin, r.dest].every((ap) => !isSlotAirport(ap) || need(x).get(ap) <= have(ap));
    const wanted = n;
    // Za mało slotów: przy fit schodzimy do największej liczby rotacji, na którą starcza slotów.
    if (fit) while (n > 0.5 && !slotOk(n)) n = n > 1 ? n - 1 : 0.5;
    for (const ap of [r.origin, r.dest]) {
      if (isSlotAirport(ap) && need(n).get(ap) > have(ap)) {
        fail(400, `Brak slotów na lotnisku ${ap}: masz ${have(ap)}, potrzeba ${need(n).get(ap)}. Kup sloty w zakładce „Trasy”.`);
      }
    }
    db.prepare('INSERT INTO flights(aircraft_id, route_id, round_trips) VALUES (?, ?, ?) ON CONFLICT(aircraft_id, route_id) DO UPDATE SET round_trips = excluded.round_trips')
      .run(ac.id, r.id, n);
    return { ok: true, roundTrips: n, reduced: n < wanted };
  });

  on('POST', '/api/aircraft/:id/config', async (ctx) => {
    const body = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const ac = myAircraft(ctx, airline);
    const t = AIRCRAFT_TYPES[ac.type_id];
    const j = Number(body.j), f = Number(body.f);
    if (!validSeatConfig(t, j, f)) fail(400, `Za dużo foteli premium: biznes zajmuje ${RULES.classSpace.j}, a pierwsza ${RULES.classSpace.f} miejsca ekonomiczne (razem max ${t.seats})`);
    db.prepare('UPDATE aircraft SET seats_j = ?, seats_f = ? WHERE id = ?').run(j, f, ac.id);
    return { ok: true, seatMap: seatMap(t, j, f) };
  });

  // Wykup samolotu z leasingu: od tej chwili jest własny (bez rat, można go sprzedać i wystawić na rynek).
  on('POST', '/api/aircraft/:id/buyout', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const ac = myAircraft(ctx, airline);
      if (!ac.leased) fail(400, 'Ten samolot jest już Twój');
      if (ac.delivery_day > currentDay(db)) fail(400, 'Ten samolot nie został jeszcze dostarczony');
      const t = AIRCRAFT_TYPES[ac.type_id];
      spend(airline, buyoutPrice(t, Math.max(0, currentDay(db) - ac.acquired_day)), `Wykup z leasingu: ${t.name} #${ac.id}`);
      db.prepare('UPDATE aircraft SET leased = 0 WHERE id = ?').run(ac.id);
    });
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/maintenance', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const ac = myAircraft(ctx, airline);
      const day = currentDay(db);
      if (ac.delivery_day > day) fail(400, 'Ten samolot nie został jeszcze dostarczony');
      if (ac.maintenance_until > day) fail(400, 'Samolot jest już na przeglądzie');
      if (ac.condition >= 99) fail(400, 'Samolot jest w idealnym stanie');
      spend(airline, maintenanceCost(AIRCRAFT_TYPES[ac.type_id], ac.condition), `Przegląd: ${AIRCRAFT_TYPES[ac.type_id].name} #${ac.id}`);
      db.prepare('UPDATE aircraft SET condition = 100, maintenance_until = ? WHERE id = ?').run(day + RULES.maintenanceDays, ac.id);
    });
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/sell', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const ac = myAircraft(ctx, airline);
      const t = AIRCRAFT_TYPES[ac.type_id];
      if (ac.leased) spend(airline, leaseDaily(t) * RULES.earlyReturnLeaseDays, `Kara za zwrot leasingu: ${t.name} #${ac.id}`);
      else earn(airline.id, aircraftValue(t, Math.max(0, currentDay(db) - ac.acquired_day), ac.condition), `Sprzedaż brokerowi: ${t.name} #${ac.id}`);
      db.prepare('DELETE FROM aircraft WHERE id = ?').run(ac.id);
    });
    return { ok: true };
  });

  // --- Rynek wtórny --------------------------------------------------------
  on('GET', '/api/used', () => {
    const day = currentDay(db);
    return db.prepare(
      `SELECT l.*, a.airline_id AS seller_id, al.name AS seller, a.acquired_day, a.condition AS ac_condition, a.type_id AS ac_type
       FROM used_listings l LEFT JOIN aircraft a ON a.id = l.aircraft_id LEFT JOIN airlines al ON al.id = a.airline_id
       ORDER BY l.price`
    ).all().map((l) => ({
      id: l.id, typeId: l.ac_type || l.type_id, price: l.price, seller: l.seller || 'Broker AeroTrade', sellerId: l.seller_id || null,
      ageDays: l.aircraft_id ? Math.max(0, day - l.acquired_day) : l.age_days,
      condition: l.aircraft_id ? l.ac_condition : l.condition,
    }));
  });

  on('POST', '/api/used/:id/buy', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const day = currentDay(db);
      const l = db.prepare('SELECT * FROM used_listings WHERE id = ?').get(Number(ctx.params.id)) || fail(404, 'Ta oferta jest już nieaktualna');
      if (l.aircraft_id) {
        const ac = db.prepare('SELECT * FROM aircraft WHERE id = ?').get(l.aircraft_id);
        if (ac.airline_id === airline.id) fail(400, 'To Twój samolot');
        spend(airline, l.price, `Zakup używanego: ${AIRCRAFT_TYPES[ac.type_id].name}`);
        earn(ac.airline_id, l.price, `Sprzedaż na rynku wtórnym: ${AIRCRAFT_TYPES[ac.type_id].name} #${ac.id}`);
        db.prepare('UPDATE aircraft SET airline_id = ?, total_profit = 0 WHERE id = ?').run(airline.id, ac.id);
        db.prepare('DELETE FROM flights WHERE aircraft_id = ?').run(ac.id);
        const seller = db.prepare('SELECT name FROM airlines WHERE id = ?').get(ac.airline_id);
        addNews(db, `${airline.name} kupuje używany ${AIRCRAFT_TYPES[ac.type_id].name} od ${seller.name}.`);
      } else {
        spend(airline, l.price, `Zakup używanego: ${AIRCRAFT_TYPES[l.type_id].name}`);
        db.prepare('INSERT INTO aircraft(airline_id, type_id, leased, acquired_day, condition) VALUES (?, ?, 0, ?, ?)')
          .run(airline.id, l.type_id, day - l.age_days, l.condition);
      }
      db.prepare('DELETE FROM used_listings WHERE id = ?').run(l.id);
    });
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/list', async (ctx) => {
    const price = Math.round(Number((await readJson(ctx.req)).price));
    if (!(price >= 1e5 && price <= 2e9)) fail(400, 'Cena: od $0,1 mln do $2000 mln');
    const airline = requireAirline(ctx);
    const ac = myAircraft(ctx, airline);
    if (ac.leased) fail(400, 'Samolotu w leasingu nie możesz sprzedać innym');
    if (ac.delivery_day > currentDay(db)) fail(400, 'Ten samolot nie został jeszcze dostarczony');
    db.prepare('INSERT INTO used_listings(type_id, price, aircraft_id, listed_day) VALUES (?, ?, ?, ?) ON CONFLICT(aircraft_id) DO UPDATE SET price = excluded.price')
      .run(ac.type_id, price, ac.id, currentDay(db));
    return { ok: true };
  });

  on('POST', '/api/aircraft/:id/unlist', async (ctx) => {
    const ac = myAircraft(ctx, requireAirline(ctx));
    db.prepare('DELETE FROM used_listings WHERE aircraft_id = ?').run(ac.id);
    return { ok: true };
  });

  // --- Trasy ---------------------------------------------------------------
  on('GET', '/api/market', (ctx) => {
    const a = airportOr400(ctx.query.get('origin'));
    const b = airportOr400(ctx.query.get('dest'));
    if (a === b) fail(400, 'Wybierz dwa różne lotniska');
    const dist = distanceKm(a, b);
    const competitors = db.prepare(
      `SELECT al.name, al.code, r.price, r.price_j, r.price_f, r.origin, r.dest, r.last_seats AS seats, r.last_pax AS pax FROM routes r JOIN airlines al ON al.id = r.airline_id
       WHERE (r.origin = ? AND r.dest = ?) OR (r.origin = ? AND r.dest = ?)`
    ).all(a, b, b, a).map((c) => ({ name: c.name, code: c.code, seats: c.seats, pax: c.pax, prices: routePrices(c) }));
    const demand = dailyDemand(a, b);
    return {
      distance: dist, baseFare: baseFare(dist), dailyDemand: demand, competitors,
      classes: Object.fromEntries(CLASSES.map((c) => [c, { fare: classFare(c, dist), demand: Math.round(demand * classShare(c, dist)) }])),
    };
  });

  // Statystyki lotniska (kliknięcie na mapie): popyt, konkurencja i Twoje połączenia.
  on('GET', '/api/airport/:code', (ctx) => {
    const airline = requireAirline(ctx);
    const code = airportOr400(ctx.params.code);
    const season = seasonMult(currentDay(db));
    const routes = db.prepare(
      `SELECT r.*, al.name, al.code AS al_code, al.color1, al.color2, al.logo FROM routes r JOIN airlines al ON al.id = r.airline_id
       WHERE r.origin = ? OR r.dest = ? ORDER BY r.last_pax DESC`
    ).all(code, code).map((r) => ({
      airline: r.name, code: r.al_code, color1: r.color1, color2: r.color2, logo: r.logo, mine: r.airline_id === airline.id,
      other: r.origin === code ? r.dest : r.origin, distance: distanceKm(r.origin, r.dest), pax: r.last_pax, seats: r.last_seats, prices: routePrices(r),
    }));
    const airlines = new Map();
    for (const r of routes) {
      const x = airlines.get(r.code) || { name: r.airline, code: r.code, color1: r.color1, color2: r.color2, logo: r.logo, mine: r.mine, routes: 0, pax: 0, seats: 0 };
      x.routes++; x.pax += r.pax; x.seats += r.seats;
      airlines.set(r.code, x);
    }
    const flown = new Map();
    for (const r of routes) flown.set(r.other, (flown.get(r.other) || 0) + 1);
    const mineTo = new Set(routes.filter((r) => r.mine).map((r) => r.other));
    const market = (other) => {
      const dist = distanceKm(code, other);
      return { code: other, distance: dist, demand: Math.round(dailyDemand(code, other) * season), fare: classFare('y', dist), rivals: flown.get(other) || 0, mine: mineTo.has(other) };
    };
    const bases = db.prepare('SELECT airport FROM bases WHERE airline_id = ?').all(airline.id).map((b) => b.airport);
    const top = Object.keys(AIRPORTS).filter((c) => c !== code && distanceKm(code, c) >= 300)
      .map(market).sort((x, y) => y.demand - x.demand).slice(0, 10);
    const slot = isSlotAirport(code) ? (() => {
      const used = slotsUsed(code);
      const cap = slotCapacity(code, db);
      return { capacity: cap, used, price: slotPrice(code, used, cap), mine: db.prepare('SELECT count FROM slots WHERE airline_id = ? AND airport = ?').get(airline.id, code)?.count || 0 };
    })() : null;
    return {
      airport: AIRPORTS[code], isBase: bases.includes(code), slot,
      totals: { routes: routes.length, pax: routes.reduce((s, r) => s + r.pax, 0), seats: routes.reduce((s, r) => s + r.seats, 0) },
      airlines: [...airlines.values()].sort((x, y) => y.pax - x.pax), routes: routes.slice(0, 40),
      fromBases: bases.filter((b) => b !== code).map(market), top,
    };
  });

  const parsePrice = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    const p = Math.round(Number(v));
    if (!(p >= 10 && p <= 50000)) fail(400, 'Cena biletu: 10-50000 USD');
    return p;
  };

  on('POST', '/api/routes', async (ctx) => {
    const body = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const origin = airportOr400(body.origin);
    const dest = airportOr400(body.dest);
    if (origin === dest) fail(400, 'Wybierz dwa różne lotniska');
    if (!db.prepare('SELECT 1 FROM bases WHERE airline_id = ? AND airport = ?').get(airline.id, origin)) fail(400, 'Trasa musi startować z Twojej bazy');
    const exists = db.prepare('SELECT origin, dest FROM routes WHERE airline_id = ?').all(airline.id).some((r) => pairKey(r.origin, r.dest) === pairKey(origin, dest));
    if (exists) fail(409, 'Już latasz na tej trasie');
    const dist = distanceKm(origin, dest);
    const { lastInsertRowid } = db.prepare('INSERT INTO routes(airline_id, origin, dest, price, price_j, price_f, created_day) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(airline.id, origin, dest, parsePrice(body.price, classFare('y', dist)), parsePrice(body.price_j, classFare('j', dist)), parsePrice(body.price_f, classFare('f', dist)), currentDay(db));
    addNews(db, `${airline.name} otwiera trasę ${AIRPORTS[origin].city} – ${AIRPORTS[dest].city}.`);
    return { ok: true, id: Number(lastInsertRowid) };
  });

  on('PATCH', '/api/routes/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    const airline = requireAirline(ctx);
    const r = db.prepare('SELECT * FROM routes WHERE id = ? AND airline_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie znaleziono trasy');
    const cur = routePrices(r);
    db.prepare('UPDATE routes SET price = ?, price_j = ?, price_f = ? WHERE id = ?')
      .run(parsePrice(body.price, cur.y), parsePrice(body.price_j, cur.j), parsePrice(body.price_f, cur.f), r.id);
    return { ok: true };
  });

  on('DELETE', '/api/routes/:id', async (ctx) => {
    await readJson(ctx.req);
    const airline = requireAirline(ctx);
    tx(db, () => {
      const id = Number(ctx.params.id);
      const planes = db.prepare('SELECT aircraft_id FROM flights WHERE route_id = ?').all(id).map((f) => f.aircraft_id);
      const r = db.prepare('DELETE FROM routes WHERE id = ? AND airline_id = ?').run(id, airline.id);
      if (!r.changes) fail(404, 'Nie znaleziono trasy');
      // Gdy zamknięta trasa łączyła dwie części sieci samolotu, zostaje on na większej części.
      for (const acId of planes) {
        const groups = routeGroups(db.prepare('SELECT r.id, r.origin, r.dest FROM flights f JOIN routes r ON r.id = f.route_id WHERE f.aircraft_id = ?').all(acId));
        if (groups.length < 2) continue;
        groups.sort((a, b) => b.length - a.length);
        for (const g of groups.slice(1)) for (const x of g) db.prepare('DELETE FROM flights WHERE aircraft_id = ? AND route_id = ?').run(acId, x.id);
      }
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
      spend(airline, AIRPORTS[code].size * RULES.baseCostPerSize, `Nowa baza: ${AIRPORTS[code].city} (${code})`);
      db.prepare('INSERT INTO bases(airline_id, airport) VALUES (?, ?)').run(airline.id, code);
      addNews(db, `${airline.name} otwiera nową bazę: ${AIRPORTS[code].city} (${code}).`);
    });
    return { ok: true };
  });

  // Rozbudowa terminalu w bazie: więcej pasażerów z przesiadką, większa atrakcyjność tras i (na dużych lotniskach) sloty.
  on('POST', '/api/bases/:code/terminal', async (ctx) => {
    const code = airportOr400(ctx.params.code);
    tx(db, () => {
      const airline = requireAirline(ctx);
      const b = db.prepare('SELECT * FROM bases WHERE airline_id = ? AND airport = ?').get(airline.id, code) || fail(404, 'Nie masz tu bazy');
      if (b.terminal >= RULES.terminalMax) fail(400, 'Terminal jest już w pełni rozbudowany');
      spend(airline, AIRPORTS[code].size * RULES.terminalCost[b.terminal], `Rozbudowa terminalu: ${AIRPORTS[code].city} (${code}), poziom ${b.terminal + 1}`);
      db.prepare('UPDATE bases SET terminal = terminal + 1 WHERE airline_id = ? AND airport = ?').run(airline.id, code);
      if (isSlotAirport(code)) {
        db.prepare('INSERT INTO slots(airline_id, airport, count) VALUES (?, ?, ?) ON CONFLICT(airline_id, airport) DO UPDATE SET count = count + excluded.count')
          .run(airline.id, code, RULES.terminalSlots);
      }
      addNews(db, `${airline.name} rozbudowuje terminal w ${AIRPORTS[code].city} (poziom ${b.terminal + 1}).`);
    });
    return { ok: true };
  });

  // --- Umowy codeshare między liniami ------------------------------------------
  const csPartner = (c, me) => (c.a_id === me ? c.b_id : c.a_id);
  const csActive = (id) => db.prepare("SELECT COUNT(*) AS n FROM codeshares WHERE (a_id = ? OR b_id = ?) AND status = 'active'").get(id, id).n;

  on('GET', '/api/codeshares', (ctx) => {
    const airline = requireAirline(ctx);
    const info = (id) => {
      const a = db.prepare('SELECT a.id, a.name, a.code, a.hub, a.color1, a.color2, a.logo, u.is_bot FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(id);
      return { ...a, bot: !!a.is_bot, bases: db.prepare('SELECT airport FROM bases WHERE airline_id = ?').all(id).map((b) => b.airport) };
    };
    const rows = db.prepare('SELECT * FROM codeshares WHERE a_id = ? OR b_id = ?').all(airline.id, airline.id);
    const linked = new Set(rows.map((c) => csPartner(c, airline.id)));
    const ally = myAlliance(airline.id);
    const allies = new Set(ally ? ally.members.map((m) => m.id) : []);
    return {
      active: rows.filter((c) => c.status === 'active').map((c) => ({ ...info(csPartner(c, airline.id)), airlineId: csPartner(c, airline.id), id: c.id, day: c.day })),
      incoming: rows.filter((c) => c.status === 'pending' && c.b_id === airline.id).map((c) => ({ ...info(c.a_id), airlineId: c.a_id, id: c.id })),
      outgoing: rows.filter((c) => c.status === 'pending' && c.a_id === airline.id).map((c) => ({ ...info(c.b_id), airlineId: c.b_id, id: c.id })),
      candidates: db.prepare('SELECT id FROM airlines WHERE id != ? ORDER BY name').all(airline.id)
        .filter((a) => !linked.has(a.id) && !allies.has(a.id)).map((a) => info(a.id)),
      max: RULES.maxCodeshares,
    };
  });

  // Linia komputerowa przyjmuje umowę od razu; gracz musi ją zaakceptować.
  on('POST', '/api/codeshares', async (ctx) => {
    const { airlineId } = await readJson(ctx.req);
    return tx(db, () => {
      const airline = requireAirline(ctx);
      const other = db.prepare('SELECT a.*, u.is_bot FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(Number(airlineId)) || fail(404, 'Nie ma takiej linii');
      if (other.id === airline.id) fail(400, 'Nie możesz zawrzeć umowy z samym sobą');
      if (db.prepare('SELECT 1 FROM codeshares WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)').get(airline.id, other.id, other.id, airline.id)) fail(409, 'Umowa z tą linią już istnieje lub czeka na odpowiedź');
      if (csActive(airline.id) >= RULES.maxCodeshares) fail(400, `Możesz mieć najwyżej ${RULES.maxCodeshares} umów codeshare`);
      const day = currentDay(db);
      if (other.is_bot) {
        if (csActive(other.id) >= RULES.maxCodeshares) fail(400, `${other.name} ma już komplet umów codeshare`);
        db.prepare("INSERT INTO codeshares(a_id, b_id, status, day) VALUES (?, ?, 'active', ?)").run(airline.id, other.id, day);
        addNews(db, `${airline.name} i ${other.name} podpisują umowę codeshare.`);
        return { ok: true, active: true };
      }
      db.prepare("INSERT INTO codeshares(a_id, b_id, status, day) VALUES (?, ?, 'pending', ?)").run(airline.id, other.id, day);
      report(db, other.id, day, 'codeshare', `${airline.name} proponuje umowę codeshare. Odpowiedz w zakładce „Sojusz”.`);
      return { ok: true, active: false };
    });
  });

  on('POST', '/api/codeshares/:id/accept', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const c = db.prepare("SELECT * FROM codeshares WHERE id = ? AND b_id = ? AND status = 'pending'").get(Number(ctx.params.id), airline.id) || fail(404, 'Nie ma takiej propozycji');
      if (csActive(airline.id) >= RULES.maxCodeshares) fail(400, `Masz już ${RULES.maxCodeshares} umów codeshare`);
      if (csActive(c.a_id) >= RULES.maxCodeshares) fail(400, 'Druga linia ma już komplet umów codeshare');
      const day = currentDay(db);
      db.prepare("UPDATE codeshares SET status = 'active', day = ? WHERE id = ?").run(day, c.id);
      const other = db.prepare('SELECT name FROM airlines WHERE id = ?').get(c.a_id);
      addNews(db, `${other.name} i ${airline.name} podpisują umowę codeshare.`);
      report(db, c.a_id, day, 'codeshare', `${airline.name} przyjmuje Twoją propozycję codeshare.`);
    });
    return { ok: true };
  });

  // Odrzucenie propozycji, wycofanie własnej albo zerwanie aktywnej umowy.
  on('DELETE', '/api/codeshares/:id', (ctx) => {
    const airline = requireAirline(ctx);
    const c = db.prepare('SELECT * FROM codeshares WHERE id = ? AND (a_id = ? OR b_id = ?)').get(Number(ctx.params.id), airline.id, airline.id) || fail(404, 'Nie ma takiej umowy');
    db.prepare('DELETE FROM codeshares WHERE id = ?').run(c.id);
    if (c.status === 'active') report(db, csPartner(c, airline.id), currentDay(db), 'codeshare', `${airline.name} zrywa umowę codeshare z Twoją linią.`);
    return { ok: true };
  });

  // Szczegółowe finanse: wyniki dzienne z podziałem, dziennik operacji, wyniki tras i flota.
  on('GET', '/api/finance', (ctx) => {
    const airline = requireAirline(ctx);
    const day = currentDay(db);
    const days = db.prepare('SELECT day, revenue, costs, pax, detail FROM daily_stats WHERE airline_id = ? ORDER BY day DESC LIMIT 60')
      .all(airline.id).reverse().map((d) => ({ ...d, detail: d.detail ? JSON.parse(d.detail) : null }));
    const entries = db.prepare('SELECT day, amount, text FROM ledger WHERE airline_id = ? ORDER BY id DESC LIMIT 40').all(airline.id);
    const fleet = db.prepare('SELECT type_id, leased, acquired_day, condition, delivery_day FROM aircraft WHERE airline_id = ?').all(airline.id);
    let fleetValue = 0, leasePerDay = 0, owned = 0, leased = 0;
    for (const a of fleet) {
      const t = AIRCRAFT_TYPES[a.type_id];
      if (a.leased) { leased++; leasePerDay += leaseDaily(t); } else { owned++; fleetValue += aircraftValue(t, Math.max(0, day - a.acquired_day), a.condition); }
    }
    const planes = db.prepare('SELECT f.route_id, COUNT(*) AS n FROM flights f JOIN aircraft a ON a.id = f.aircraft_id WHERE a.airline_id = ? GROUP BY f.route_id').all(airline.id);
    const routes = db.prepare('SELECT id, origin, dest, last_pax, last_seats, last_revenue, last_cost FROM routes WHERE airline_id = ?').all(airline.id)
      .map((r) => ({ ...r, planes: planes.find((x) => x.route_id === r.id)?.n || 0 }));
    return {
      day, cash: airline.cash, debt: airline.debt, fleetValue, leasePerDay, owned, leased,
      value: companyValue(db, airline, day), interestPerDay: (airline.debt * RULES.loanInterestYear) / 365,
      days, entries, routes,
    };
  });

  on('POST', '/api/loan', async (ctx) => {
    const amount = Math.round(Number((await readJson(ctx.req)).amount));
    if (!Number.isFinite(amount) || amount === 0) fail(400, 'Podaj kwotę');
    tx(db, () => {
      const airline = requireAirline(ctx);
      if (amount > 0 && airline.debt + amount > RULES.maxDebt) fail(400, `Limit kredytu to ${money(RULES.maxDebt)}`);
      if (amount < 0 && -amount > airline.debt) fail(400, 'Nie możesz spłacić więcej niż wynosi dług');
      if (amount < 0) spend(airline, -amount, 'Spłata kredytu');
      else earn(airline.id, amount, 'Nowy kredyt');
      db.prepare('UPDATE airlines SET debt = debt + ? WHERE id = ?').run(amount, airline.id);
    });
    return { ok: true };
  });

  // --- Sojusze -------------------------------------------------------------
  on('GET', '/api/alliances', () => {
    const day = currentDay(db);
    return db.prepare('SELECT * FROM alliances ORDER BY id').all().map((al) => {
      const members = db.prepare('SELECT a.* FROM alliance_members m JOIN airlines a ON a.id = m.airline_id WHERE m.alliance_id = ?').all(al.id);
      return {
        id: al.id, name: al.name, members: members.map((m) => ({ name: m.name, code: m.code })),
        leader: members.find((m) => m.id === al.leader_id)?.name || '',
        value: members.reduce((s, m) => s + companyValue(db, m, day), 0),
      };
    }).sort((a, b) => b.value - a.value);
  });

  on('POST', '/api/alliances', async (ctx) => {
    const name = String((await readJson(ctx.req)).name || '').trim();
    if (name.length < 3 || name.length > 30) fail(400, 'Nazwa sojuszu: 3-30 znaków');
    tx(db, () => {
      const airline = requireAirline(ctx);
      if (myAlliance(airline.id)) fail(400, 'Najpierw opuść obecny sojusz');
      if (db.prepare('SELECT 1 FROM alliances WHERE name = ?').get(name)) fail(409, 'Ta nazwa jest zajęta');
      const day = currentDay(db);
      const { lastInsertRowid } = db.prepare('INSERT INTO alliances(name, leader_id, created_day) VALUES (?, ?, ?)').run(name, airline.id, day);
      db.prepare('INSERT INTO alliance_members(airline_id, alliance_id, joined_day) VALUES (?, ?, ?)').run(airline.id, Number(lastInsertRowid), day);
      addNews(db, `${airline.name} zakłada sojusz „${name}”.`);
    });
    return { ok: true };
  });

  on('POST', '/api/alliances/:id/join', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      if (myAlliance(airline.id)) fail(400, 'Najpierw opuść obecny sojusz');
      const al = db.prepare('SELECT * FROM alliances WHERE id = ?').get(Number(ctx.params.id)) || fail(404, 'Nie ma takiego sojuszu');
      const n = db.prepare('SELECT COUNT(*) AS n FROM alliance_members WHERE alliance_id = ?').get(al.id).n;
      if (n >= RULES.allianceMaxMembers) fail(400, `Sojusz ma już ${RULES.allianceMaxMembers} członków`);
      db.prepare('INSERT INTO alliance_members(airline_id, alliance_id, joined_day) VALUES (?, ?, ?)').run(airline.id, al.id, currentDay(db));
      addNews(db, `${airline.name} dołącza do sojuszu „${al.name}”.`);
    });
    return { ok: true };
  });

  function removeFromAlliance(airlineId) {
    const m = db.prepare('SELECT alliance_id FROM alliance_members WHERE airline_id = ?').get(airlineId) || fail(400, 'Nie należysz do sojuszu');
    db.prepare('DELETE FROM alliance_members WHERE airline_id = ?').run(airlineId);
    const al = db.prepare('SELECT * FROM alliances WHERE id = ?').get(m.alliance_id);
    const next = db.prepare('SELECT airline_id FROM alliance_members WHERE alliance_id = ? ORDER BY joined_day, airline_id LIMIT 1').get(al.id);
    if (!next) db.prepare('DELETE FROM alliances WHERE id = ?').run(al.id);
    else if (al.leader_id === airlineId) db.prepare('UPDATE alliances SET leader_id = ? WHERE id = ?').run(next.airline_id, al.id);
    return al;
  }

  on('POST', '/api/alliance/leave', async (ctx) => {
    tx(db, () => {
      const airline = requireAirline(ctx);
      const al = removeFromAlliance(airline.id);
      addNews(db, `${airline.name} opuszcza sojusz „${al.name}”.`);
    });
    return { ok: true };
  });

  on('POST', '/api/alliance/kick', async (ctx) => {
    const { airlineId } = await readJson(ctx.req);
    tx(db, () => {
      const airline = requireAirline(ctx);
      const mine = myAlliance(airline.id) || fail(400, 'Nie należysz do sojuszu');
      if (mine.leader_id !== airline.id) fail(403, 'Tylko lider może usuwać członków');
      if (Number(airlineId) === airline.id) fail(400, 'Aby odejść, użyj przycisku „Opuść sojusz”');
      if (!mine.members.some((m) => m.id === Number(airlineId))) fail(404, 'Ta linia nie należy do sojuszu');
      removeFromAlliance(Number(airlineId));
    });
    return { ok: true };
  });

  on('GET', '/api/alliance/chat', (ctx) => {
    const airline = requireAirline(ctx);
    const m = db.prepare('SELECT alliance_id FROM alliance_members WHERE airline_id = ?').get(airline.id) || fail(400, 'Nie należysz do sojuszu');
    return db.prepare(
      `SELECT * FROM (SELECT msg.id, msg.text, msg.created_at, a.name, a.code FROM alliance_messages msg JOIN airlines a ON a.id = msg.airline_id
       WHERE msg.alliance_id = ? ORDER BY msg.id DESC LIMIT 100) ORDER BY id`
    ).all(m.alliance_id);
  });

  on('POST', '/api/alliance/chat', async (ctx) => {
    const text = String((await readJson(ctx.req)).text || '').trim();
    if (!text || text.length > 500) fail(400, 'Wiadomość: 1-500 znaków');
    const airline = requireAirline(ctx);
    const m = db.prepare('SELECT alliance_id FROM alliance_members WHERE airline_id = ?').get(airline.id) || fail(400, 'Nie należysz do sojuszu');
    db.prepare('INSERT INTO alliance_messages(alliance_id, airline_id, text, created_at) VALUES (?, ?, ?, ?)').run(m.alliance_id, airline.id, text, Date.now());
    db.prepare('DELETE FROM alliance_messages WHERE alliance_id = ? AND id NOT IN (SELECT id FROM alliance_messages WHERE alliance_id = ? ORDER BY id DESC LIMIT 500)').run(m.alliance_id, m.alliance_id);
    return { ok: true };
  });

  // --- Fuzje i przejęcia ---------------------------------------------------
  on('GET', '/api/takeovers', (ctx) => {
    const airline = requireAirline(ctx);
    const day = currentDay(db);
    const name = (id) => db.prepare('SELECT name, code FROM airlines WHERE id = ?').get(id);
    const targets = db.prepare(
      `SELECT a.*, u.username, u.is_bot, (SELECT COUNT(*) FROM aircraft WHERE airline_id = a.id) AS fleet,
        (SELECT COUNT(*) FROM routes WHERE airline_id = a.id) AS routes
       FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id != ?`
    ).all(airline.id).map((a) => ({
      id: a.id, name: a.name, code: a.code, bot: !!a.is_bot, owner: a.username, hub: a.hub, color1: a.color1, color2: a.color2, logo: a.logo,
      fleet: a.fleet, routes: a.routes, value: companyValue(db, a, day), price: takeoverPrice(db, a, day),
      offered: !!db.prepare('SELECT 1 FROM takeover_offers WHERE buyer_id = ? AND target_id = ?').get(airline.id, a.id),
    })).sort((x, y) => x.price - y.price);
    const offer = (o, id) => ({ id: o.id, price: o.price, day: o.day, expires: o.day + RULES.takeoverOfferDays, ...name(id) });
    return {
      targets,
      incoming: db.prepare('SELECT * FROM takeover_offers WHERE target_id = ? ORDER BY id').all(airline.id).map((o) => offer(o, o.buyer_id)),
      outgoing: db.prepare('SELECT * FROM takeover_offers WHERE buyer_id = ? ORDER BY id').all(airline.id).map((o) => offer(o, o.target_id)),
    };
  });

  // Linię komputerową przejmuje się od razu; graczowi składa się ofertę, którą on akceptuje albo odrzuca.
  on('POST', '/api/takeovers', async (ctx) => {
    const { airlineId } = await readJson(ctx.req);
    return tx(db, () => {
      const airline = requireAirline(ctx);
      const target = db.prepare('SELECT a.*, u.is_bot FROM airlines a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(Number(airlineId)) || fail(404, 'Nie ma takiej linii');
      if (target.id === airline.id) fail(400, 'Nie możesz przejąć własnej linii');
      const price = takeoverPrice(db, target);
      if (airline.cash < price) fail(400, `Brak środków (potrzeba ${money(price)})`);
      if (target.is_bot) {
        mergeAirlines(db, airline.id, target.id, price);
        return { ok: true, merged: true };
      }
      db.prepare('INSERT INTO takeover_offers(buyer_id, target_id, price, day) VALUES (?, ?, ?, ?) ON CONFLICT(buyer_id, target_id) DO UPDATE SET price = excluded.price, day = excluded.day')
        .run(airline.id, target.id, price, currentDay(db));
      addNews(db, `${airline.name} składa ofertę przejęcia linii ${target.name} za ${money(price)}.`);
      report(db, target.id, currentDay(db), 'offer', `${airline.name} chce przejąć Twoją linię za ${money(price)}. Odpowiedz na Pulpicie.`);
      return { ok: true, merged: false };
    });
  });

  on('POST', '/api/takeovers/:id/accept', async (ctx) => {
    const r = tx(db, () => {
      const airline = requireAirline(ctx);
      const o = db.prepare('SELECT * FROM takeover_offers WHERE id = ? AND target_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie ma takiej oferty');
      const buyer = db.prepare('SELECT * FROM airlines WHERE id = ?').get(o.buyer_id);
      // Kupujący nie zapłaci więcej, niż zaoferował, a gdy linia straciła na wartości od złożenia oferty
      // (np. właściciel wyprowadził gotówkę), oferta przepada.
      const now = takeoverPrice(db, airline);
      if (now < o.price * 0.9) {
        db.prepare('DELETE FROM takeover_offers WHERE id = ?').run(o.id);
        return { ok: false, error: `Wartość Twojej linii spadła od złożenia oferty (dziś ${money(now)}), więc oferta wygasła` };
      }
      const price = Math.min(now, o.price);
      if (buyer.cash < price) fail(400, `${buyer.name} nie ma już pieniędzy na tę ofertę`);
      mergeAirlines(db, buyer.id, airline.id, price);
      return { ok: true };
    });
    if (!r.ok) fail(409, r.error);
    return r;
  });

  on('POST', '/api/takeovers/:id/reject', async (ctx) => {
    const airline = requireAirline(ctx);
    const o = db.prepare('SELECT * FROM takeover_offers WHERE id = ? AND target_id = ?').get(Number(ctx.params.id), airline.id) || fail(404, 'Nie ma takiej oferty');
    db.prepare('DELETE FROM takeover_offers WHERE id = ?').run(o.id);
    addNews(db, `${airline.name} odrzuca ofertę przejęcia od ${db.prepare('SELECT name FROM airlines WHERE id = ?').get(o.buyer_id).name}.`);
    return { ok: true };
  });

  on('DELETE', '/api/takeovers/:id', (ctx) => {
    const airline = requireAirline(ctx);
    const r = db.prepare('DELETE FROM takeover_offers WHERE id = ? AND buyer_id = ?').run(Number(ctx.params.id), airline.id);
    if (!r.changes) fail(404, 'Nie ma takiej oferty');
    return { ok: true };
  });

  // --- Rywalizacja ---------------------------------------------------------
  on('GET', '/api/leaderboard', () => {
    const day = currentDay(db);
    const rows = db.prepare(
      `SELECT a.*, u.username, u.is_bot, al.name AS alliance,
        (SELECT COUNT(*) FROM aircraft WHERE airline_id = a.id) AS fleet,
        (SELECT COUNT(*) FROM routes WHERE airline_id = a.id) AS routes,
        (SELECT COALESCE(SUM(last_pax), 0) FROM routes WHERE airline_id = a.id) AS pax
       FROM airlines a JOIN users u ON u.id = a.user_id
       LEFT JOIN alliance_members m ON m.airline_id = a.id LEFT JOIN alliances al ON al.id = m.alliance_id`
    ).all();
    return rows
      .map((a) => ({ name: a.name, code: a.code, bot: !!a.is_bot, color1: a.color1, color2: a.color2, logo: a.logo, owner: a.username, hub: a.hub, alliance: a.alliance, reputation: a.reputation, fleet: a.fleet, routes: a.routes, pax: a.pax, value: companyValue(db, a, day) }))
      .sort((x, y) => y.value - x.value);
  });

  on('GET', '/api/season', () => {
    const g = db.prepare('SELECT day, season, season_end_day FROM game_state WHERE id = 1').get();
    const left = g.season_end_day == null ? null : Math.max(0, g.season_end_day - g.day);
    return {
      season: g.season, endDay: g.season_end_day, daysLeft: left, secondsLeft: left == null || !clock ? null : left * clock.tickSeconds,
      hall: db.prepare('SELECT * FROM hall_of_fame ORDER BY season DESC, place').all(),
    };
  });

  on('GET', '/api/news', () => db.prepare('SELECT day, text FROM news ORDER BY id DESC LIMIT 30').all());

  on('GET', '/api/routes/all', () =>
    db.prepare('SELECT r.origin, r.dest, a.code, a.color1 FROM routes r JOIN airlines a ON a.id = r.airline_id').all());

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
        // Za serwerem pośredniczącym (np. Railway) prawdziwy adres gracza dopisuje ostatni serwer w X-Forwarded-For.
        ip: (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress,
        user: userFromToken(db, token),
        params: Object.fromEntries(route.keys.map((k, i) => [k, safeDecode(url.pathname.match(route.re)[i + 1])])),
      };
      const isPublic = ['/api/register', '/api/login', '/api/me', '/api/static', '/api/leaderboard', '/api/news', '/api/season'].includes(url.pathname);
      if (!ctx.user && !isPublic) return send(401, { error: 'Zaloguj się' });
      send(200, await route.handler(ctx));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'Błąd serwera' });
    }
  };
}
