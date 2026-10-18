'use strict';

const state = { me: null, st: null, data: null, tab: 'dashboard', map: null, chatTimer: null, routeCountry: 'Polska', routeContinent: 'Europa' };
const $ = (sel) => document.querySelector(sel);
const view = () => $('#view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)} mld`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)} mln`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)} tys.`;
  return `${s}$${Math.round(a)}`;
};
const signed = (n) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${usd(n)}</span>`;
const pct = (x) => `${Math.round(x * 100)}%`;
const airport = (code) => state.st.airportsBy[code];
const REGIONS = ['Polska', 'Europa Zachodnia', 'Europa Południowa', 'Europa Środkowo-Wschodnia', 'Skandynawia', 'Turcja, Kaukaz',
  'Rosja i Azja Centralna', 'Bliski Wschód', 'Afryka', 'Azja Południowa', 'Azja Wschodnia', 'Azja Południowo-Wschodnia', 'Oceania',
  'Ameryka Północna', 'Karaiby i Ameryka Środkowa', 'Ameryka Południowa'];
// Lista lotnisk pogrupowana według regionów świata.
// Kontynenty do wyboru celu trasy (z regionów; Rosję liczymy do Europy).
const CONTINENTS = ['Europa', 'Azja', 'Afryka', 'Ameryka Północna', 'Ameryka Południowa', 'Australia i Oceania'];
const REGION_CONTINENT = {
  'Turcja, Kaukaz': 'Azja', 'Rosja i Azja Centralna': 'Azja', 'Bliski Wschód': 'Azja', 'Azja Południowa': 'Azja',
  'Azja Wschodnia': 'Azja', 'Azja Południowo-Wschodnia': 'Azja', Afryka: 'Afryka', Oceania: 'Australia i Oceania',
  'Ameryka Północna': 'Ameryka Północna', 'Karaiby i Ameryka Środkowa': 'Ameryka Północna', 'Ameryka Południowa': 'Ameryka Południowa',
};
const continentOf = (a) => (a.country === 'Rosja' ? 'Europa' : REGION_CONTINENT[a.region] || 'Europa');
// Kraje danego kontynentu: Polska na początku, reszta alfabetycznie.
function countries(continent) {
  const all = [...new Set(state.st.airports.filter((a) => continentOf(a) === continent).map((a) => a.country))].sort((a, b) => a.localeCompare(b, 'pl'));
  return all.includes('Polska') ? ['Polska', ...all.filter((c) => c !== 'Polska')] : all;
}
function airportOptions({ selected, filter = () => true, label = (a) => `${esc(a.city)} (${a.code})` } = {}) {
  return REGIONS.map((r) => {
    const list = state.st.airports.filter((a) => a.region === r && filter(a));
    return list.length ? `<optgroup label="${esc(r)}">${list.map((a) => `<option value="${a.code}" ${a.code === selected ? 'selected' : ''}>${label(a)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
const apLabel = (code) => `${code} · ${airport(code).city}`;
const type = (id) => state.st.typesBy[id];
const gameDate = (day) => {
  const d = new Date(Date.UTC(2027, 0, 1) + day * 864e5);
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
  return data;
}

// Wykonuje akcję gracza, pokazuje komunikat i odświeża dane.
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

function distanceKm(a, b) {
  const A = airport(a), B = airport(b), r = Math.PI / 180;
  const h = Math.sin(((B.lat - A.lat) * r) / 2) ** 2 + Math.cos(A.lat * r) * Math.cos(B.lat * r) * Math.sin(((B.lon - A.lon) * r) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}
function roundTripHours(t, dist) {
  return 2 * (dist / t.speed + state.st.rules.turnaroundHours);
}
function maxRoundTrips(t, dist, hoursLeft = state.st.rules.operatingHours) {
  const rt = roundTripHours(t, dist);
  const n = Math.floor(hoursLeft / rt + 1e-9);
  return n >= 1 ? n : rt / 2 <= hoursLeft + 1e-9 ? 0.5 : 0;
}

// --- Start -----------------------------------------------------------------
async function boot() {
  const st = await api('GET', '/api/static');
  st.airportsBy = Object.fromEntries(st.airports.map((a) => [a.code, a]));
  st.typesBy = Object.fromEntries(st.aircraftTypes.map((t) => [t.id, t]));
  st.airports.sort((a, b) => a.city.localeCompare(b.city, 'pl'));
  state.st = st;
  await route();
  setInterval(() => state.data && refresh(true), 10000);
  setInterval(tickCountdown, 1000);
}

async function route() {
  state.me = await api('GET', '/api/me');
  if (!state.me.user) return renderAuth();
  if (!state.me.airline) return renderFound();
  await refresh();
}

async function refresh(auto = false) {
  const members = (d) => JSON.stringify(d?.alliance?.members.map((m) => m.id) ?? null);
  const before = members(state.data);
  const dayBefore = state.data?.day;
  try {
    state.data = await api('GET', '/api/airline');
    state.nextDayAt = state.data.nextDayIn == null ? null : Date.now() + state.data.nextDayIn;
  } catch (e) {
    // Nowy sezon usunął linię: wracamy do zakładania nowej.
    if (/załóż linię/.test(e.message)) return location.reload();
    if (!auto) toast(e.message, true);
    return;
  }
  renderTop();
  tickCountdown();
  // Przy automatycznym odświeżaniu nie przerysowujemy formularzy, w których gracz coś wpisuje.
  const allianceChanged = state.tab === 'alliance' && before !== members(state.data) && !$('#chat-text')?.value && !$('#al-name')?.value;
  // Nowy dzień gry: przerysowujemy bieżącą zakładkę, chyba że gracz akurat coś w niej wpisuje
  // (mapa i czat sojuszu odświeżają się po swojemu).
  const newDay = auto && dayBefore != null && state.data.day !== dayBefore && !['map', 'alliance', 'dashboard', 'ranking'].includes(state.tab) && !editing();
  // Ranking odświeżamy w miejscu, żeby strona nie przewijała się do góry.
  if (auto && state.tab === 'ranking') ranking($('#tab'));
  else if (newDay) keepScroll(renderMain);
  else if (!auto || state.tab === 'dashboard' || allianceChanged) renderMain();
}

// Czy gracz zaczął coś wpisywać lub wybierać w bieżącej zakładce (wtedy jej nie przerysowujemy).
function editing() {
  const tab = $('#tab');
  if (!tab) return false;
  return state.dirty || (tab.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName));
}

// Przerysowanie bez skakania strony: przywracamy przewinięcie także po doładowaniu danych zakładki.
function keepScroll(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
  setTimeout(() => window.scrollTo(0, y), 400);
}

// Odliczanie do następnego dnia gry, liczone od czasu podanego przez serwer.
function tickCountdown() {
  const el = $('#countdown');
  if (!el || state.nextDayAt == null) return;
  const left = Math.max(0, Math.ceil((state.nextDayAt - Date.now()) / 1000));
  el.textContent = left > 0 ? `· następny dzień za ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '· nowy dzień…';
  if (left === 0 && !tickCountdown.pending) {
    tickCountdown.pending = true;
    setTimeout(() => refresh(true).finally(() => (tickCountdown.pending = false)), 1500);
  }
}

function renderTop() {
  const { airline, day } = state.data || {};
  $('#topinfo').innerHTML = airline
    ? `<span>📅 <b>${gameDate(day)}</b> <span id="countdown" class="muted"></span></span>
       <span>${esc(airline.name)} (${esc(airline.code)})</span>
       <span>Gotówka: <b>${usd(airline.cash)}</b></span>
       <span>Wartość: <b>${usd(airline.value)}</b></span>
       <span>${esc(state.me.user.username)}</span>
       <button class="secondary" id="logout">Wyloguj</button>`
    : state.me?.user
      ? `<span>${esc(state.me.user.username)}</span><button class="secondary" id="logout">Wyloguj</button>`
      : '';
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await api('POST', '/api/logout'); location.reload(); };
}

// --- Rejestracja / logowanie ------------------------------------------------
function renderAuth(mode = 'login') {
  renderTop();
  const isLogin = mode === 'login';
  view().innerHTML = `
    <div class="card auth">
      <h2>${isLogin ? 'Logowanie' : 'Rejestracja'}</h2>
      <form id="authform">
        <label>Login <input name="username" autocomplete="username" required></label>
        <label>Hasło <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required></label>
        ${isLogin ? '' : '<label>Powtórz hasło <input name="password2" type="password" autocomplete="new-password" required></label>'}
        <button>${isLogin ? 'Zaloguj się' : 'Załóż konto'}</button>
      </form>
      <p class="muted">${isLogin ? 'Nie masz konta?' : 'Masz już konto?'} <a href="#" id="switch">${isLogin ? 'Zarejestruj się' : 'Zaloguj się'}</a></p>
    </div>
    <div class="card auth"><h3>Ranking linii</h3><div id="pubrank" class="muted">Ładowanie…</div></div>`;
  $('#switch').onclick = (e) => { e.preventDefault(); renderAuth(isLogin ? 'register' : 'login'); };
  $('#authform').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!isLogin && f.password !== f.password2) return toast('Hasła się różnią', true);
    try {
      await api('POST', isLogin ? '/api/login' : '/api/register', { username: f.username, password: f.password });
      await route();
    } catch (err) {
      toast(err.message, true);
    }
  };
  api('GET', '/api/leaderboard').then((rows) => {
    $('#pubrank').innerHTML = rows.length
      ? `<ol>${rows.slice(0, 10).map((r) => `<li>${esc(r.name)} — ${usd(r.value)}</li>`).join('')}</ol>`
      : 'Jeszcze nikt nie gra. Bądź pierwszy!';
  });
}

// --- Zakładanie linii -------------------------------------------------------
function renderFound() {
  renderTop();
  view().innerHTML = `
    <div class="card auth" style="max-width:480px">
      <h2>Załóż swoją linię lotniczą</h2>
      <p class="muted">Na start dostajesz ${state.me.user.bonus > 0 ? `<b>${usd(state.me.user.bonus)}</b> ze sprzedaży poprzedniej linii` : usd(state.st.rules.startingCash)}. Wybierz port macierzysty: duże lotnisko to duży popyt, ale i silna konkurencja.</p>
      <form id="foundform">
        <label>Nazwa linii <input name="name" maxlength="40" required></label>
        <label>Kod (2 znaki) <input name="code" maxlength="2" required style="text-transform:uppercase"></label>
        <label>Baza (hub)
          <select name="hub">${airportOptions({ selected: 'WAW', label: (a) => `${esc(a.city)} (${a.code}) · rynek ${a.size}/10` })}</select>
        </label>
        <button>Załóż linię</button>
      </form>
    </div>`;
  $('#foundform').onsubmit = (e) => {
    e.preventDefault();
    act(async () => { await api('POST', '/api/airline', Object.fromEntries(new FormData(e.target))); await route(); }, 'Linia założona! Kup pierwszy samolot.');
  };
}

// --- Główny widok -----------------------------------------------------------
const TABS = [
  ['dashboard', 'Pulpit'], ['routes', 'Trasy'], ['fleet', 'Flota'], ['shop', 'Nowe samoloty'], ['used', 'Rynek wtórny'],
  ['map', 'Mapa'], ['finance', 'Finanse'], ['airline', 'Linia'], ['alliance', 'Sojusz'], ['ranking', 'Ranking'],
];
const CLS = [['y', 'Ekon.'], ['j', 'Biznes'], ['f', 'Pierwsza']];

function renderMain() {
  if (state.map) { state.map.remove(); state.map = null; }
  clearInterval(state.chatTimer);
  state.dirty = false;
  view().innerHTML = `<nav class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div id="tab"></div>`;
  view().querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderMain(); }));
  // Zmiana w formularzu, której gracz jeszcze nie zatwierdził, wstrzymuje automatyczne przerysowanie.
  for (const ev of ['input', 'change']) $('#tab').addEventListener(ev, () => (state.dirty = true));
  ({ dashboard, routes: routesTab, fleet, shop, used: usedTab, map: mapTab, finance, airline: airlineTab, alliance: allianceTab, ranking })[state.tab]($('#tab'));
}

const livery = (a) => ({ color1: a.color1, color2: a.color2, logo: a.logo, code: a.code });
// Mały znak linii: symbol na tle jej kolorów.
const badge = (a) => `<span class="badge" style="background:${a.color1};color:${a.color2}">${esc(a.logo === 'CODE' ? a.code : a.logo)}</span>`;

const condClass = (c) => (c >= 70 ? 'pos' : c >= 40 ? 'warn' : 'neg');

function dashboard(el) {
  const { airline, fleet, routes, stats, world, day } = state.data;
  const last = stats[stats.length - 1];
  const profit = last ? last.revenue - last.costs : 0;
  const maxAbs = Math.max(1, ...stats.map((s) => Math.abs(s.revenue - s.costs)));
  const fuelPct = Math.round(world.fuel * 100);
  const seasonPct = Math.round((world.season - 1) * 100);
  const avgCond = fleet.length ? fleet.reduce((s, a) => s + a.condition, 0) / fleet.length : 100;
  el.innerHTML = `
    <div class="card"><div class="grid">
      <div class="stat"><div class="k">Gotówka</div><div class="v">${usd(airline.cash)}</div></div>
      <div class="stat"><div class="k">Wartość firmy</div><div class="v">${usd(airline.value)}</div></div>
      <div class="stat"><div class="k">Zysk wczoraj</div><div class="v">${signed(profit)}</div></div>
      <div class="stat"><div class="k">Pasażerowie wczoraj</div><div class="v">${(last?.pax || 0).toLocaleString('pl-PL')}</div></div>
      <div class="stat"><div class="k">Flota / trasy</div><div class="v">${fleet.length} / ${routes.length}</div></div>
      <div class="stat"><div class="k">Reputacja</div><div class="v">${airline.reputation.toFixed(1)}</div></div>
      <div class="stat"><div class="k">Średni stan floty</div><div class="v ${condClass(avgCond)}">${Math.round(avgCond)}%</div></div>
    </div></div>
    <div class="card"><h3>Sytuacja na świecie</h3>
      <div class="grid">
        <div class="stat"><div class="k">Cena paliwa</div><div class="v ${fuelPct > 110 ? 'neg' : fuelPct < 90 ? 'pos' : ''}">${fuelPct}% normy</div></div>
        <div class="stat"><div class="k">Sezon: ${world.month}</div><div class="v ${seasonPct >= 0 ? 'pos' : 'neg'}">popyt ${seasonPct >= 0 ? '+' : ''}${seasonPct}%</div></div>
      </div>
      ${world.events.length ? `<ul class="news">${world.events.map((e) => `<li>${esc(e.text)} <span class="muted">(do ${gameDate(e.endDay)})</span></li>`).join('')}</ul>` : '<p class="muted">Brak nadzwyczajnych wydarzeń.</p>'}
    </div>
    <div class="card"><h3>Dzienny zysk (ostatnie 30 dni)</h3>
      ${stats.length ? `<div class="chart">${stats.map((s) => {
        const p = s.revenue - s.costs, h = Math.max(1, (Math.abs(p) / maxAbs) * 50);
        return `<div title="Dzień ${s.day}: ${usd(p)}"><span class="${p >= 0 ? 'up' : 'down'}" style="height:${h}%"></span></div>`;
      }).join('')}</div>` : '<p class="muted">Brak danych. Wyniki pojawią się po pierwszym dniu gry.</p>'}
    </div>
    ${state.data.takeoverOffers ? '<div class="card offer-alert" id="dash-offers"></div>' : ''}
    ${fleet.length === 0 ? '<div class="card"><b>Pierwsze kroki:</b> 1) zamów samolot w „Nowe samoloty” albo kup używany na „Rynku wtórnym”, 2) otwórz trasę ze swojej bazy w zakładce „Trasy”, 3) gdy samolot dotrze, przypisz go do trasy we „Flocie”.</div>' : ''}
    <div class="card"><h3>Wiadomości ze świata lotnictwa</h3><ul class="news" id="news"><li class="muted">Ładowanie…</li></ul></div>`;
  if (state.data.takeoverOffers) {
    // Ostatnio pobrane oferty pokazujemy od razu, żeby przyciski nie znikały przy każdym odświeżeniu.
    if (state.incoming) takeoverIncoming($('#dash-offers'), state.incoming);
    api('GET', '/api/takeovers').then((t) => { state.incoming = t.incoming; const box = $('#dash-offers'); if (box) takeoverIncoming(box, t.incoming); });
  }
  api('GET', '/api/news').then((rows) => {
    const n = $('#news');
    if (n) n.innerHTML = rows.map((r) => `<li><span class="muted">${gameDate(r.day)}:</span> ${esc(r.text)}</li>`).join('') || '<li class="muted">Cisza w eterze.</li>';
  });
}

function routesTab(el) {
  const { routes, fleet, bases } = state.data;
  const assigned = (rid) => fleet.filter((a) => a.flights.some((f) => f.route_id === rid));
  const lf = (d) => (d && d.seats ? pct(d.pax / d.seats) : '—');
  el.innerHTML = `
    <div class="card"><h3>Otwórz nową trasę</h3>
      <div class="row">
        <label>Skąd (baza)<select id="r-origin">${bases.map((b) => `<option value="${b}" ${b === state.routeOrigin ? 'selected' : ''}>${esc(apLabel(b))}</option>`).join('')}</select></label>
        <label>Kontynent<select id="r-continent">${CONTINENTS.map((c) => `<option ${c === state.routeContinent ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Kraj<select id="r-country"></select></label>
        <label>Miasto<select id="r-dest"></select></label>
        ${CLS.map(([c, n]) => `<label>Cena: ${n}<input id="r-price-${c}" type="number" min="10" style="width:100px"></label>`).join('')}
        <button id="r-open">Otwórz trasę</button>
      </div>
      <div id="r-market" class="muted"></div>
    </div>
    <div class="card"><h3>Twoje trasy</h3>
      ${routes.length ? `<div class="table-wrap"><table>
        <tr><th>Trasa</th><th>Dystans</th><th>Ceny biletów (ekon. / biznes / pierwsza)</th><th>Samoloty</th><th>Pasażerowie/dzień</th><th>Obłożenie (E/B/P)</th><th>Przychód</th><th>Koszt lotów</th><th></th></tr>
        ${routes.map((r) => `<tr>
          <td>${r.origin} ⇄ ${r.dest}<div class="muted">${esc(airport(r.origin).city)} – ${esc(airport(r.dest).city)}</div></td>
          <td>${r.distance.toLocaleString('pl-PL')} km</td>
          <td>${CLS.map(([c, n]) => `<input type="number" title="${n} (ref. $${r.refFares[c]})" value="${r.prices[c]}" min="10" data-price="${r.id}" data-cls="${c}" style="width:68px">`).join(' ')}
            <div class="muted">ref. $${r.refFares.y} / $${r.refFares.j} / $${r.refFares.f}</div></td>
          <td>${assigned(r.id).length}</td>
          <td>${r.last_pax.toLocaleString('pl-PL')}${r.detail?.transfer ? `<div class="muted">w tym ${r.detail.transfer} z przesiadką</div>` : ''}</td>
          <td>${r.detail ? CLS.map(([c]) => lf(r.detail[c])).join(' / ') : '—'}</td>
          <td>${usd(r.last_revenue)}</td>
          <td>${usd(r.last_cost)}</td>
          <td><button class="danger" data-close="${r.id}">Zamknij</button></td>
        </tr>`).join('')}
      </table></div>
      <p class="muted">Obłożenie pokazuje „—”, gdy samoloty na trasie nie mają foteli danej klasy. Fotele ustawisz we „Flocie”.
        Gdy latasz z jednego lotniska do dwóch miast, część pasażerów między tymi miastami poleci z przesiadką i zajmie wolne miejsca ekonomiczne.</p>` : '<p class="muted">Nie masz jeszcze tras.</p>'}
    </div>
    <div class="card"><h3>Sloty na zatłoczonych lotniskach</h3>
      <p class="muted">Na największych lotniskach każda rotacja dziennie potrzebuje slotu. Pula slotów jest wspólna dla wszystkich linii,
        a każdy kolejny kosztuje więcej. Niepotrzebne sloty można sprzedać za ${Math.round(state.st.rules.slotSellBack * 100)}% ceny.</p>
      <div id="slots" class="muted">Ładowanie…</div>
    </div>`;
  api('GET', '/api/slots').then((list) => {
    const box = $('#slots');
    if (!box) return;
    const row = (x) => `<tr class="${x.mine ? 'me' : ''}"><td>${esc(x.city)} (${x.code})<div class="muted">${esc(x.country)}</div></td>
      <td class="num">${x.used} / ${x.capacity}</td><td class="num"><b>${x.mine}</b></td><td class="num">${x.myUse}</td>
      <td class="num">${x.used < x.capacity ? usd(x.price) : '<span class="neg">brak</span>'}</td>
      <td class="actions"><button data-slot="${x.code}" data-n="1" ${x.used < x.capacity ? '' : 'disabled'}>Kup 1</button>
        <button class="secondary" data-slot="${x.code}" data-n="5" ${x.used + 5 <= x.capacity ? '' : 'disabled'}>Kup 5</button>
        <button class="secondary" data-slot="${x.code}" data-n="-1" ${x.mine > x.myUse ? '' : 'disabled'} title="Odzyskasz ${usd(x.sellPrice)}">Sprzedaj 1</button></td></tr>`;
    box.classList.remove('muted');
    box.innerHTML = `<div class="table-wrap"><table>
      <tr><th>Lotnisko</th><th class="num">Zajęte sloty (wszyscy)</th><th class="num">Twoje sloty</th><th class="num">Używasz</th><th class="num">Cena slotu</th><th></th></tr>
      ${list.map(row).join('')}</table></div>`;
    box.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => act(() => api('POST', '/api/slots', { airport: b.dataset.slot, count: Number(b.dataset.n) }),
      Number(b.dataset.n) > 0 ? 'Sloty kupione' : 'Slot sprzedany')));
  });

  const showMarket = async () => {
    const o = $('#r-origin').value, d = $('#r-dest').value;
    if (!o || o === d) { $('#r-market').textContent = ''; return; }
    const req = (state.marketReq = (state.marketReq || 0) + 1);
    try {
      const m = await api('GET', `/api/market?origin=${o}&dest=${d}`);
      // Gracz zdążył wybrać inny kierunek albo zmienić zakładkę.
      if (req !== state.marketReq || !$("#r-market")) return;
      for (const [c] of CLS) $(`#r-price-${c}`).placeholder = m.classes[c].fare;
      const slotNote = [o, d].filter((c) => airport(c).size >= state.st.rules.slotMinSize)
        .map((c) => `<br><span class="warn">${esc(airport(c).city)} (${c}) ma limit slotów: przed przypisaniem samolotu kup sloty (tabela niżej).</span>`).join('');
      $('#r-market').innerHTML = `Dystans ${m.distance.toLocaleString('pl-PL')} km · popyt dziennie w każdą stronę:
        ekonomiczna ${m.classes.y.demand} os. ($${m.classes.y.fare}), biznes ${m.classes.j.demand} os. ($${m.classes.j.fare}), pierwsza ${m.classes.f.demand} os. ($${m.classes.f.fare}).
        ${m.competitors.length ? `<br>Konkurencja: ${m.competitors.map((c) => `${esc(c.name)} ($${c.prices.y} / $${c.prices.j} / $${c.prices.f}, ${c.seats} miejsc/dzień)`).join(', ')}` : '<br>Brak konkurencji na tej trasie.'}${slotNote}`;
    } catch (e) { if ($('#r-market')) $('#r-market').textContent = e.message; }
  };
  const fillCities = () => {
    state.routeCountry = $('#r-country').value;
    $('#r-dest').innerHTML = state.st.airports.filter((a) => a.country === state.routeCountry)
      .map((a) => `<option value="${a.code}" ${a.code === state.routeDest ? 'selected' : ''}>${esc(a.city)} (${a.code}) · rynek ${a.size}/10</option>`).join('');
    state.routeDest = null;
    showMarket();
  };
  const fillCountries = () => {
    state.routeContinent = $('#r-continent').value;
    const list = countries(state.routeContinent);
    if (!list.includes(state.routeCountry)) state.routeCountry = list[0];
    $('#r-country').innerHTML = list.map((c) => `<option ${c === state.routeCountry ? 'selected' : ''}>${esc(c)}</option>`).join('');
    fillCities();
  };
  state.routeOrigin = null;
  $('#r-continent').onchange = fillCountries;
  $('#r-country').onchange = fillCities;
  $('#r-origin').onchange = showMarket;
  $('#r-dest').onchange = showMarket;
  fillCountries();
  const val = (c) => Number($(`#r-price-${c}`).value) || undefined;
  $('#r-open').onclick = () => act(() => api('POST', '/api/routes', { origin: $('#r-origin').value, dest: $('#r-dest').value, price: val('y'), price_j: val('j'), price_f: val('f') }), 'Trasa otwarta. Przypisz do niej samolot we Flocie.');
  const key = { y: 'price', j: 'price_j', f: 'price_f' };
  el.querySelectorAll('[data-price]').forEach((i) => (i.onchange = () => act(() => api('PATCH', `/api/routes/${i.dataset.price}`, { [key[i.dataset.cls]]: Number(i.value) }), 'Cena zmieniona')));
  el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => confirm('Zamknąć trasę? Samoloty wrócą do hangaru.') && act(() => api('DELETE', `/api/routes/${b.dataset.close}`), 'Trasa zamknięta')));
}

function fleet(el) {
  const { fleet: planes, routes, day, airline } = state.data;
  const R = state.st.rules;
  const status = (a) => {
    if (a.delivery_day > day) return `<span class="warn">Dostawa za ${a.delivery_day - day} dn.</span>`;
    if (a.maintenance_until > day) return `<span class="warn">Przegląd do ${gameDate(a.maintenance_until)}</span>`;
    if (a.listing_id) return `<span class="warn">Na sprzedaż: ${usd(a.listing_price)}</span>`;
    return a.flights.length ? `<span class="pos">Lata${a.flights.length > 1 ? ` (${a.flights.length} trasy)` : ''}</span>` : '<span class="muted">W hangarze</span>';
  };
  const routeById = (id) => routes.find((x) => x.id === id);
  // Godziny na dobę, które samolot spędza na swoich trasach (bez trasy `skip`).
  const hoursUsed = (a, t, skip) => a.flights.reduce((h, f) => {
    const r = routeById(f.route_id);
    return r && f.route_id !== skip ? h + f.round_trips * roundTripHours(t, distanceKm(r.origin, r.dest)) : h;
  }, 0);
  // Jaką część dostępnych godzin lotu na dobę samolot faktycznie wykorzystuje.
  const usage = (a, t) => {
    const hours = hoursUsed(a, t);
    if (!hours) return '<span class="muted">0%</span>';
    const p = Math.round((hours / R.operatingHours) * 100);
    return `<b class="${p >= 75 ? 'pos' : p >= 40 ? 'warn' : 'neg'}">${p}%</b><div class="muted">${hours.toFixed(1)} z ${R.operatingHours} h</div>`;
  };
  // Lista tras samolotu z liczbą rotacji i wybór kolejnej trasy.
  const flightsCell = (a, t, delivered) => {
    const lines = a.flights.map((f) => {
      const r = routeById(f.route_id);
      const max = maxRoundTrips(t, distanceKm(r.origin, r.dest), R.operatingHours - hoursUsed(a, t, f.route_id));
      return `<div class="flight">${r.origin}–${r.dest}
        <input type="number" data-rt="${a.id}" data-rid="${r.id}" value="${f.round_trips}" min="0.5" max="${max}" step="0.5" style="width:56px" title="Rotacje dziennie (max ${max})">
        <button class="secondary small" data-unassign="${a.id}" data-rid="${r.id}" title="Zdejmij z tej trasy">✕</button></div>`;
    }).join('');
    const left = R.operatingHours - hoursUsed(a, t);
    const opts = routes.filter((r) => !a.flights.some((f) => f.route_id === r.id)).map((r) => {
      const dist = distanceKm(r.origin, r.dest), max = maxRoundTrips(t, dist, left), ok = dist <= t.rangeKm && max > 0;
      return `<option value="${r.id}" data-max="${max}" ${ok ? '' : 'disabled'}>${r.origin}–${r.dest}${dist > t.rangeKm ? ' (za daleko)' : ok ? ` (max ${max})` : ' (brak godzin)'}</option>`;
    }).join('');
    const add = opts && delivered
      ? `<select data-add="${a.id}"><option value="">${a.flights.length ? '+ dodaj trasę' : '— w hangarze —'}</option>${opts}</select>`
      : a.flights.length ? '' : '<span class="muted">— w hangarze —</span>';
    return lines + add;
  };
  // Wynik samolotu z ostatniego dnia: jego część przychodu tras minus wszystkie jego koszty.
  const profitCell = (a, delivered) => {
    if (!delivered) return '<span class="muted">—</span>';
    return `<b>${signed(a.last_revenue - a.last_cost)}</b>
      <div class="muted">przychód ${usd(a.last_revenue)}</div><div class="muted">koszty ${usd(a.last_cost)}</div>
      <div class="muted">${a.last_pax.toLocaleString('pl-PL')} pas. · łącznie ${signed(a.total_profit)}</div>`;
  };
  const working = planes.filter((a) => a.delivery_day <= day);
  const ranked = [...working].sort((x, y) => (y.last_revenue - y.last_cost) - (x.last_revenue - x.last_cost));
  const name = (a) => `${esc(type(a.type_id).name)} #${a.id}`;
  el.innerHTML = `<div class="card"><h3>Twoja flota</h3>
    ${ranked.length > 1 ? `<p>Wczoraj najlepszy wynik miał <b>${name(ranked[0])}</b> (${signed(ranked[0].last_revenue - ranked[0].last_cost)}),
      a najsłabszy <b>${name(ranked.at(-1))}</b> (${signed(ranked.at(-1).last_revenue - ranked.at(-1).last_cost)}).</p>` : ''}
    <div class="row">
      <label>Automatyczny przegląd, gdy stan spadnie poniżej (%)<input id="automaint" type="number" min="0" max="95" value="${airline.auto_maint}" style="width:90px"></label>
      <p class="muted">0 = wyłączone. Zużyte samoloty kosztują więcej, psują się i obniżają reputację.</p>
    </div>
    ${planes.length ? `<div class="table-wrap"><table>
      <tr><th>#</th><th>Typ</th><th>Status</th><th>Stan</th><th>Fotele (biznes / pierwsza)</th><th>Trasy i rotacje/dzień</th><th>Wykorzystanie</th><th class="num">Zysk wczoraj</th><th></th></tr>
      ${planes.map((a) => {
        const t = type(a.type_id);
        const delivered = a.delivery_day <= day;
        return `<tr>
          <td>${a.id}</td>
          <td class="fleet-type">${planeSvg(t, livery(airline))}${esc(t.name)}<div class="muted">${a.leased ? `Leasing (${usd(a.leaseDaily)}/dzień)` : `Własny, wart ${usd(a.value)}`} · ${Math.max(0, Math.round((day - a.acquired_day) / 365 * 10) / 10)} lat</div></td>
          <td>${status(a)}</td>
          <td><b class="${condClass(a.condition)}">${Math.round(a.condition)}%</b></td>
          <td><input type="number" min="0" value="${a.seats_j}" data-j="${a.id}" style="width:60px"> <input type="number" min="0" value="${a.seats_f}" data-f="${a.id}" style="width:60px">
            <div class="muted">${a.seatMap.y} E · ${a.seatMap.j} B · ${a.seatMap.f} P</div></td>
          <td>${flightsCell(a, t, delivered)}</td>
          <td>${usage(a, t)}</td>
          <td class="num nowrap">${profitCell(a, delivered)}</td>
          <td class="actions">
            <button class="secondary" data-maint="${a.id}" ${delivered && a.maintenance_until <= day && a.condition < 99 ? '' : 'disabled'} title="Przegląd trwa ${R.maintenanceDays} dni">Przegląd ${usd(a.maintenanceCost)}</button>
            ${a.leased ? '' : a.listing_id ? `<button class="secondary" data-unlist="${a.id}">Wycofaj ofertę</button>` : `<button class="secondary" data-list="${a.id}" ${delivered ? '' : 'disabled'}>Wystaw na rynek</button>`}
            <button class="danger" data-sell="${a.id}">${a.leased ? 'Zwróć' : 'Sprzedaj'}</button>
          </td>
        </tr>`;
      }).join('')}
    </table></div>
    <p class="muted">Wykorzystanie to część z ${R.operatingHours} godzin na dobę, którą samolot spędza w locie i na obsłudze między lotami. Im bliżej 100%, tym lepiej zarabia.
      Zysk samolotu to jego część przychodu z tras (według liczby miejsc, które na nich oferuje) minus jego koszty: paliwo, załoga, opłaty, obsługa pasażerów, koszty stałe, leasing i przeglądy. „Łącznie” liczy się od zakupu. Jeden samolot może latać na kilku trasach, dopóki starcza mu godzin. Rotacja = lot tam i z powrotem. Fotel biznes zajmuje ${R.classSpace.j}, a pierwszej klasy ${R.classSpace.f} miejsca ekonomiczne. „Sprzedaj” sprzedaje od razu brokerowi, „Wystaw na rynek” pozwala ustalić własną cenę dla innych graczy.</p>` : '<p class="muted">Nie masz jeszcze samolotów. Zajrzyj do „Nowe samoloty” albo na „Rynek wtórny”.</p>'}
  </div>`;

  $('#automaint').onchange = (e) => act(() => api('POST', '/api/airline/settings', { autoMaint: Number(e.target.value) }), 'Ustawienie zapisane');
  const assign = (id, routeId, roundTrips) =>
    act(() => api('POST', `/api/aircraft/${id}/assign`, { routeId, roundTrips }), roundTrips === 0 ? 'Samolot zdjęty z trasy' : 'Samolot przypisany');
  el.querySelectorAll('[data-add]').forEach((s) => (s.onchange = () => {
    if (s.value) assign(s.dataset.add, Number(s.value), Number(s.selectedOptions[0].dataset.max));
  }));
  el.querySelectorAll('[data-rt]').forEach((i) => (i.onchange = () => assign(i.dataset.rt, Number(i.dataset.rid), Number(i.value) || 0)));
  el.querySelectorAll('[data-unassign]').forEach((b) => (b.onclick = () => assign(b.dataset.unassign, Number(b.dataset.rid), 0)));
  const config = (id) => act(() => api('POST', `/api/aircraft/${id}/config`, {
    j: Number(el.querySelector(`[data-j="${id}"]`).value) || 0, f: Number(el.querySelector(`[data-f="${id}"]`).value) || 0,
  }), 'Układ foteli zmieniony');
  el.querySelectorAll('[data-j]').forEach((i) => (i.onchange = () => config(i.dataset.j)));
  el.querySelectorAll('[data-f]').forEach((i) => (i.onchange = () => config(i.dataset.f)));
  el.querySelectorAll('[data-maint]').forEach((b) => (b.onclick = () => act(() => api('POST', `/api/aircraft/${b.dataset.maint}/maintenance`), 'Samolot poszedł na przegląd')));
  el.querySelectorAll('[data-unlist]').forEach((b) => (b.onclick = () => act(() => api('POST', `/api/aircraft/${b.dataset.unlist}/unlist`), 'Oferta wycofana')));
  el.querySelectorAll('[data-list]').forEach((b) => (b.onclick = () => {
    const a = planes.find((p) => p.id === Number(b.dataset.list));
    const v = prompt(`Za ile (w mln USD) wystawić ${type(a.type_id).name}? Broker dałby ${usd(a.value)}.`, (a.value / 1e6).toFixed(1));
    if (v) act(() => api('POST', `/api/aircraft/${a.id}/list`, { price: Math.round(Number(v.replace(',', '.')) * 1e6) }), 'Samolot wystawiony na rynek wtórny');
  }));
  el.querySelectorAll('[data-sell]').forEach((b) => (b.onclick = () => {
    const a = planes.find((p) => p.id === Number(b.dataset.sell));
    const msg = a.leased
      ? `Zwrócić samolot? Kara: ${usd(a.leaseDaily * R.earlyReturnLeaseDays)}.`
      : `Sprzedać samolot brokerowi za ${usd(a.value)}?`;
    if (confirm(msg)) act(() => api('POST', `/api/aircraft/${a.id}/sell`), 'Gotowe');
  }));
}

const CATEGORIES = [
  ['turbo', 'Turbośmigłowe'], ['regional', 'Regionalne odrzutowe'],
  ['narrow', 'Wąskokadłubowe'], ['wide', 'Szerokokadłubowe (dalekiego zasięgu)'],
];

function shop(el) {
  const R = state.st.rules;
  const f = (state.shopFilter ||= { cat: '', maker: 'Airbus' });
  // Zakładki producentów: najwięcej modeli najpierw.
  const count = (m) => state.st.aircraftTypes.filter((t) => t.maker === m).length;
  const makers = [...new Set(state.st.aircraftTypes.map((t) => t.maker))].sort((a, b) => count(b) - count(a) || a.localeCompare(b));
  const list = state.st.aircraftTypes.filter((t) => (!f.cat || t.cat === f.cat) && (!f.maker || t.maker === f.maker));
  const cash = state.data.airline.cash;
  const row = (t) => `<tr>
    <td class="plane-cell">${planePhoto(t)}</td><td><b>${esc(t.name)}</b><div class="muted">${esc(t.maker)}</div></td><td>${t.seats}</td><td>${t.rangeKm.toLocaleString('pl-PL')} km</td><td>${t.speed} km/h</td>
    <td>$${t.costPerKm}</td><td>${usd(t.dailyFixed)}</td><td>${R.deliveryDays[t.cat]} dni</td><td>${usd(t.price)}</td>
    <td>${usd(t.price * R.leaseDepositPct)} na start<br><span class="muted">+ ${usd(t.price * R.leaseDailyPct)}/dzień</span></td>
    <td><div class="order"><label class="qty">Sztuk <input type="number" min="1" max="${R.maxOrder}" value="1" data-qty="${t.id}"></label>
      <button data-buy="${t.id}" ${cash < t.price ? 'disabled title="Za mało gotówki"' : ''}>Zamów</button> <button class="secondary" data-lease="${t.id}">Leasing</button></div></td>
  </tr>`;
  el.innerHTML = `<div class="card"><h3>Zamów nowy samolot u producenta</h3>
    <nav class="tabs makers">
      ${makers.map((m) => `<button data-maker="${esc(m)}" class="${f.maker === m ? 'active' : ''}">${esc(m)}</button>`).join('')}
      <button data-maker="" class="${f.maker ? '' : 'active'}">Wszyscy</button>
    </nav>
    <div class="row">
      <label>Kategoria<select id="f-cat" style="min-width:240px"><option value="">Wszystkie</option>${CATEGORIES.map(([id, n]) => `<option value="${id}" ${f.cat === id ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="muted">${list.length} z ${state.st.aircraftTypes.length} typów · nowe samoloty przylatują po kilku dniach gry</p>
    </div>
    <div class="table-wrap"><table>
      <tr><th></th><th>Model</th><th>Miejsca</th><th>Zasięg</th><th>Prędkość</th><th>Koszt/km</th><th>Koszt stały/dzień</th><th>Dostawa</th><th>Cena</th><th>Leasing</th><th></th></tr>
      ${CATEGORIES.map(([id, name]) => {
        const group = list.filter((t) => t.cat === id);
        return group.length ? `<tr><th colspan="11" class="group">${name}</th></tr>${group.map(row).join('')}` : '';
      }).join('') || '<tr><td colspan="11" class="muted">Ten producent nie ma samolotów w tej kategorii.</td></tr>'}
    </table></div></div>`;
  loadPlanePhotos(el);
  $('#f-cat').onchange = (e) => { f.cat = e.target.value; shop(el); };
  el.querySelectorAll('[data-maker]').forEach((b) => (b.onclick = () => { f.maker = b.dataset.maker; shop(el); }));
  const qty = (id) => Math.min(R.maxOrder, Math.max(1, Math.round(Number(el.querySelector(`[data-qty="${id}"]`).value) || 1)));
  // Przyciski pokazują łączny koszt dla wybranej liczby samolotów.
  const updateRow = (id) => {
    const t = type(id), n = qty(id), buy = el.querySelector(`[data-buy="${id}"]`), lease = el.querySelector(`[data-lease="${id}"]`);
    buy.textContent = n > 1 ? `Zamów ${n} · ${usd(t.price * n)}` : 'Zamów';
    lease.textContent = n > 1 ? `Leasing ${n} · ${usd(t.price * R.leaseDepositPct * n)}` : 'Leasing';
    buy.disabled = cash < t.price * n;
    buy.title = buy.disabled ? 'Za mało gotówki' : '';
  };
  el.querySelectorAll('[data-qty]').forEach((i) => (i.oninput = () => updateRow(i.dataset.qty)));
  const order = async (typeId, mode) => {
    const r = await api('POST', '/api/aircraft', { typeId, mode, count: qty(typeId) });
    const few = r.count % 10 >= 2 && r.count % 10 <= 4 && (r.count % 100 < 12 || r.count % 100 > 14);
    toast(r.count > 1 ? `Zamówiono ${r.count} ${few ? 'samoloty' : 'samolotów'}! Przylecą za ${r.deliveryDays} dni gry.` : `Zamówione! Samolot przyleci za ${r.deliveryDays} dni gry.`);
  };
  el.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => act(() => order(b.dataset.buy, 'buy'))));
  el.querySelectorAll('[data-lease]').forEach((b) => (b.onclick = () => act(() => order(b.dataset.lease, 'lease'))));
}

async function usedTab(el) {
  el.innerHTML = '<div class="card muted">Ładowanie…</div>';
  const rows = await api('GET', '/api/used');
  const myId = state.data.airline.id, cash = state.data.airline.cash;
  el.innerHTML = `<div class="card"><h3>Rynek wtórny</h3>
    <p class="muted">Używane samoloty są tańsze i dostępne od ręki, ale starsze i bardziej zużyte. Oferty brokera zmieniają się co jakiś czas, a gracze wystawiają tu własne maszyny z zakładki „Flota”.</p>
    ${rows.length ? `<div class="table-wrap"><table>
      <tr><th>Model</th><th>Sprzedawca</th><th>Wiek</th><th>Stan</th><th>Miejsca</th><th>Zasięg</th><th>Cena</th><th>Nowy kosztuje</th><th></th></tr>
      ${rows.map((u) => {
        const t = type(u.typeId);
        const mine = u.sellerId === myId;
        return `<tr class="${mine ? 'me' : ''}">
          <td><b>${esc(t.name)}</b><div class="muted">${esc(t.maker)}</div></td>
          <td>${esc(u.seller)}</td>
          <td>${(u.ageDays / 365).toFixed(1)} lat</td>
          <td><b class="${condClass(u.condition)}">${Math.round(u.condition)}%</b></td>
          <td>${t.seats}</td><td>${t.rangeKm.toLocaleString('pl-PL')} km</td>
          <td><b>${usd(u.price)}</b></td><td class="muted">${usd(t.price)}</td>
          <td>${mine ? '<span class="muted">Twoja oferta</span>' : `<button data-usedbuy="${u.id}" ${cash < u.price ? 'disabled title="Za mało gotówki"' : ''}>Kup</button>`}</td>
        </tr>`;
      }).join('')}
    </table></div>` : '<p class="muted">Brak ofert. Broker wystawi nowe samoloty następnego dnia gry.</p>'}
  </div>`;
  el.querySelectorAll('[data-usedbuy]').forEach((b) => (b.onclick = () => act(async () => {
    await api('POST', `/api/used/${b.dataset.usedbuy}/buy`);
    if (state.tab === 'used') usedTab(el);
  }, 'Kupione! Samolot czeka w hangarze.')));
}

const INCOME_ROWS = [['rev_y', 'Klasa ekonomiczna'], ['rev_j', 'Klasa biznes'], ['rev_f', 'Pierwsza klasa']];
const COST_ROWS = [['fuel', 'Paliwo'], ['ops', 'Obsługa techniczna'], ['staff', 'Pensje załóg'], ['fees', 'Opłaty lotniskowe'],
  ['fixed', 'Utrzymanie samolotów'], ['lease', 'Raty leasingu'], ['maint', 'Przeglądy i awarie'], ['service', 'Obsługa pokładowa'],
  ['marketing', 'Reklama'], ['loyalty', 'Program lojalnościowy'], ['interest', 'Odsetki od kredytu']];
const COST_COLORS = {
  fuel: '#f59e0b', ops: '#3fa9f5', staff: '#22d3ee', fees: '#a78bfa', fixed: '#64748b', lease: '#f472b6', maint: '#f06a6a',
  service: '#84cc16', marketing: '#fb923c', loyalty: '#e879f9', interest: '#94a3b8',
};

async function finance(el) {
  const { airline, bases } = state.data;
  const R = state.st.rules;
  if (!el.innerHTML) el.innerHTML = '<div class="card muted">Wczytuję finanse…</div>';
  let F;
  try { F = await api('GET', '/api/finance'); } catch (e) { el.innerHTML = `<div class="card neg">${esc(e.message)}</div>`; return; }
  if (!el.isConnected) return; // gracz przełączył zakładkę
  const last = (n) => F.days.slice(-n);
  const total = (list, k) => list.reduce((s, d) => s + d[k], 0);
  const part = (list, k) => list.reduce((s, d) => s + (d.detail?.[k] ?? 0), 0);
  const periods = [['Ostatni dzień', last(1)], ['7 dni', last(7)], ['30 dni', last(30)]];
  const margin = (list) => { const r = total(list, 'revenue'); return r ? (r - total(list, 'costs')) / r : 0; };
  const lf = (list) => { const seats = part(list, 'seats'); return seats ? pct(total(list, 'pax') / seats) : '—'; };
  const avg7 = last(7).length ? (total(last(7), 'revenue') - total(last(7), 'costs')) / last(7).length : 0;
  const y = last(1)[0];

  // Wykres przychodów i kosztów z ostatnich 30 dni.
  const series = last(30);
  const chart = () => {
    if (series.length < 2) return '<p class="muted">Wykres pojawi się po kilku dniach gry.</p>';
    const W = 600, H = 170, max = Math.max(1, ...series.map((d) => Math.max(d.revenue, d.costs)));
    const x = (i) => 30 + (i / (series.length - 1)) * (W - 40), yy = (v) => H - 20 - (v / max) * (H - 35);
    const path = (k) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yy(d[k]).toFixed(1)}`).join(' ');
    return `<svg class="fin-chart" viewBox="0 0 ${W} ${H}">
      <line x1="30" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="var(--line)"/>
      <text x="2" y="${yy(max) + 4}" class="axis">${usd(max)}</text><text x="2" y="${H - 16}" class="axis">0</text>
      <text x="30" y="${H - 3}" class="axis">${gameDate(series[0].day)}</text><text x="${W - 10}" y="${H - 3}" class="axis" text-anchor="end">${gameDate(series[series.length - 1].day)}</text>
      <path d="${path('revenue')}" fill="none" stroke="var(--good)" stroke-width="2.5"/>
      <path d="${path('costs')}" fill="none" stroke="var(--bad)" stroke-width="2.5"/>
    </svg><div class="legend"><span class="pos">■ Przychody</span> <span class="neg">■ Koszty</span></div>`;
  };
  // Struktura kosztów (30 dni) jako pasek procentowy.
  const costTotal = COST_ROWS.reduce((s, [k]) => s + part(series, k), 0);
  const structure = costTotal ? `<div class="costbar">${COST_ROWS.map(([k, n]) => {
    const v = part(series, k) / costTotal;
    return v > 0.005 ? `<span style="width:${(v * 100).toFixed(1)}%;background:${COST_COLORS[k]}" title="${n}: ${pct(v)}"></span>` : '';
  }).join('')}</div><div class="legend">${COST_ROWS.map(([k, n]) => part(series, k) > 0 ? `<span><i style="background:${COST_COLORS[k]}"></i>${n} ${pct(part(series, k) / costTotal)}</span>` : '').join('')}</div>` : '';

  const routes = F.routes.map((r) => ({ ...r, profit: r.last_revenue - r.last_cost })).sort((a, b) => b.profit - a.profit);
  const stat = (k, v, sub = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`;
  el.innerHTML = `
    <div class="card"><h3>Podsumowanie</h3><div class="grid">
      ${stat('Gotówka', usd(F.cash))}
      ${stat('Dług', usd(F.debt), `odsetki ${usd(F.interestPerDay)}/dzień`)}
      ${stat('Wartość floty', usd(F.fleetValue), `${F.owned} własnych · ${F.leased} w leasingu`)}
      ${stat('Wartość firmy', usd(F.value), 'gotówka + flota − dług')}
      ${stat('Wynik ostatniego dnia', y ? signed(y.revenue - y.costs) : '—')}
      ${stat('Średni wynik (7 dni)', signed(avg7), 'na dzień')}
      ${stat('Marża (30 dni)', pct(margin(series)))}
      ${stat('Raty leasingu', usd(F.leasePerDay), 'na dzień')}
    </div></div>
    <div class="card"><h3>Rachunek wyników</h3><div class="table-wrap"><table class="pl">
      <tr><th></th>${periods.map(([n]) => `<th class="num">${n}</th>`).join('')}</tr>
      <tr><th colspan="4" class="group">Przychody</th></tr>
      ${INCOME_ROWS.map(([k, n]) => `<tr><td>${n}</td>${periods.map(([, l]) => `<td class="num">${usd(part(l, k))}</td>`).join('')}</tr>`).join('')}
      <tr class="sum"><td>Razem przychody</td>${periods.map(([, l]) => `<td class="num pos">${usd(total(l, 'revenue'))}</td>`).join('')}</tr>
      <tr><th colspan="4" class="group">Koszty</th></tr>
      ${COST_ROWS.map(([k, n]) => `<tr><td>${n}</td>${periods.map(([, l]) => `<td class="num">${usd(part(l, k))}</td>`).join('')}</tr>`).join('')}
      <tr class="sum"><td>Razem koszty</td>${periods.map(([, l]) => `<td class="num neg">${usd(total(l, 'costs'))}</td>`).join('')}</tr>
      <tr class="sum big"><td>Zysk netto</td>${periods.map(([, l]) => `<td class="num">${signed(total(l, 'revenue') - total(l, 'costs'))}</td>`).join('')}</tr>
      <tr><td>Marża</td>${periods.map(([, l]) => `<td class="num">${pct(margin(l))}</td>`).join('')}</tr>
      <tr><td>Pasażerowie</td>${periods.map(([, l]) => `<td class="num">${total(l, 'pax').toLocaleString('pl-PL')}</td>`).join('')}</tr>
      <tr><td>Obłożenie</td>${periods.map(([, l]) => `<td class="num">${lf(l)}</td>`).join('')}</tr>
    </table></div>
    <p class="muted">Koszty z dni sprzed tej aktualizacji nie mają podziału na kategorie, więc w sumie mogą być wyższe niż suma pozycji.</p></div>
    <div class="card"><h3>Przychody i koszty</h3>${chart()}<h3 style="margin-top:16px">Struktura kosztów (30 dni)</h3>${structure || '<p class="muted">Brak danych.</p>'}</div>
    <div class="card"><h3>Wyniki tras (ostatni dzień)</h3>
      ${routes.length ? `<div class="table-wrap"><table>
        <tr><th>Trasa</th><th class="num">Samoloty</th><th class="num">Pasażerowie</th><th class="num">Obłożenie</th><th class="num">Przychód</th><th class="num">Koszt lotów</th><th class="num">Wynik</th><th class="num">Marża</th></tr>
        ${routes.map((r) => `<tr><td>${r.origin} ⇄ ${r.dest}</td><td class="num">${r.planes}</td><td class="num">${r.last_pax.toLocaleString('pl-PL')}</td>
          <td class="num">${r.last_seats ? pct(r.last_pax / r.last_seats) : '—'}</td><td class="num">${usd(r.last_revenue)}</td><td class="num">${usd(r.last_cost)}</td>
          <td class="num">${signed(r.profit)}</td><td class="num">${r.last_revenue ? pct(r.profit / r.last_revenue) : '—'}</td></tr>`).join('')}
      </table></div><p class="muted">Koszt lotów to paliwo, obsługa i opłaty lotniskowe. Utrzymanie samolotów, leasing i odsetki liczone są dla całej linii.</p>` : '<p class="muted">Nie masz jeszcze tras.</p>'}
    </div>
    <div class="card"><h3>Kredyt</h3>
      <p>Zadłużenie: <b>${usd(airline.debt)}</b> z limitu ${usd(R.maxDebt)} (możesz pożyczyć jeszcze ${usd(R.maxDebt - airline.debt)}) · oprocentowanie ${R.loanInterestYear * 100}% rocznie, czyli ${usd(F.interestPerDay)} dziennie.</p>
      <div class="row">
        <label>Kwota (mln USD)<input id="loan" type="number" min="1" value="10" style="width:120px"></label>
        <button id="borrow">Weź kredyt</button>
        <button class="secondary" id="repay">Spłać</button>
      </div>
    </div>
    <div class="card"><h3>Bazy</h3>
      <p>Twoje bazy: ${bases.map((b) => esc(apLabel(b))).join(', ')}. Trasy możesz otwierać tylko z baz.</p>
      <div class="row">
        <label>Nowa baza<select id="base">${airportOptions({ filter: (a) => !bases.includes(a.code), label: (a) => `${esc(a.city)} (${a.code}) · ${usd(a.size * R.baseCostPerSize)}` })}</select></label>
        <button id="openbase">Otwórz bazę</button>
      </div>
    </div>
    <div class="card"><h3>Historia operacji</h3>
      ${F.entries.length ? `<div class="table-wrap"><table>
        ${F.entries.map((e) => `<tr><td class="muted">${gameDate(e.day)}</td><td>${esc(e.text)}</td><td class="num">${signed(e.amount)}</td></tr>`).join('')}
      </table></div>` : '<p class="muted">Zakupy, sprzedaże, kredyty i nowe bazy pojawią się tutaj.</p>'}
    </div>`;
  const amt = () => Math.round(Number($('#loan').value) * 1e6);
  $('#borrow').onclick = () => act(() => api('POST', '/api/loan', { amount: amt() }), 'Kredyt przyznany');
  $('#repay').onclick = () => act(() => api('POST', '/api/loan', { amount: -amt() }), 'Spłacono');
  $('#openbase').onclick = () => act(() => api('POST', '/api/bases', { airport: $('#base').value }), 'Baza otwarta');
}

async function allianceTab(el) {
  const { alliance, airline } = state.data;
  const R = state.st.rules;
  if (!alliance) {
    el.innerHTML = '<div class="card muted">Ładowanie…</div>';
    const list = await api('GET', '/api/alliances');
    el.innerHTML = `
      <div class="card"><h3>Sojusze linii lotniczych</h3>
        <p class="muted">Członkowie sojuszu mają wspólny czat, a na trasach do baz partnerów pasażerowie chętniej wybierają ich linie (codeshare: +${Math.round((R.codeshareBonus - 1) * 100)}% atrakcyjności). Sojusz może mieć do ${R.allianceMaxMembers} linii.</p>
        ${list.length ? `<div class="table-wrap"><table>
          <tr><th>Sojusz</th><th>Lider</th><th>Członkowie</th><th>Łączna wartość</th><th></th></tr>
          ${list.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.leader)}</td><td>${a.members.map((m) => esc(m.code)).join(', ')} <span class="muted">(${a.members.length}/${R.allianceMaxMembers})</span></td>
            <td>${usd(a.value)}</td><td><button data-join="${a.id}" ${a.members.length >= R.allianceMaxMembers ? 'disabled' : ''}>Dołącz</button></td></tr>`).join('')}
        </table></div>` : '<p class="muted">Nie ma jeszcze żadnego sojuszu. Załóż pierwszy!</p>'}
      </div>
      <div class="card"><h3>Załóż sojusz</h3>
        <div class="row"><label>Nazwa<input id="al-name" maxlength="30"></label><button id="al-create">Załóż</button></div>
      </div>`;
    el.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => act(() => api('POST', `/api/alliances/${b.dataset.join}/join`), 'Witamy w sojuszu!')));
    $('#al-create').onclick = () => act(() => api('POST', '/api/alliances', { name: $('#al-name').value }), 'Sojusz założony');
    return;
  }
  const leader = alliance.leader_id === airline.id;
  el.innerHTML = `
    <div class="card"><h3>Sojusz „${esc(alliance.name)}”</h3>
      <div class="table-wrap"><table>
        <tr><th>Linia</th><th>Bazy</th><th></th></tr>
        ${alliance.members.map((m) => `<tr class="${m.id === airline.id ? 'me' : ''}"><td><b>${esc(m.name)}</b> (${esc(m.code)}) ${m.id === alliance.leader_id ? '<span class="muted">· lider</span>' : ''}</td>
          <td>${m.bases.map((b) => esc(apLabel(b))).join(', ')}</td>
          <td>${leader && m.id !== airline.id ? `<button class="danger" data-kick="${m.id}">Usuń</button>` : ''}</td></tr>`).join('')}
      </table></div>
      <p class="muted">Twoje trasy do baz partnerów dostają premię codeshare: +${Math.round((R.codeshareBonus - 1) * 100)}% atrakcyjności.</p>
      <button class="danger" id="al-leave">Opuść sojusz</button>
    </div>
    <div class="card"><h3>Czat sojuszu</h3>
      <div id="chat" class="chat"><p class="muted">Ładowanie…</p></div>
      <form id="chat-form" class="row"><input id="chat-text" maxlength="500" placeholder="Napisz wiadomość…" style="flex:1"><button>Wyślij</button></form>
    </div>`;
  el.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => confirm('Usunąć tę linię z sojuszu?') && act(() => api('POST', '/api/alliance/kick', { airlineId: Number(b.dataset.kick) }), 'Linia usunięta')));
  $('#al-leave').onclick = () => confirm('Na pewno opuścić sojusz?') && act(() => api('POST', '/api/alliance/leave'), 'Opuszczono sojusz');
  const loadChat = async () => {
    const box = $('#chat');
    if (!box) return;
    const msgs = await api('GET', '/api/alliance/chat').catch(() => null);
    if (!msgs || !$('#chat')) return;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.innerHTML = msgs.map((m) => `<div class="msg"><b>${esc(m.code)}</b> <span class="muted">${new Date(m.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span><div>${esc(m.text)}</div></div>`).join('') || '<p class="muted">Jeszcze nikt nic nie napisał.</p>';
    if (atBottom || !loadChat.done) box.scrollTop = box.scrollHeight;
    loadChat.done = true;
  };
  loadChat();
  state.chatTimer = setInterval(loadChat, 4000);
  $('#chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#chat-text');
    if (!input.value.trim()) return;
    try {
      await api('POST', '/api/alliance/chat', { text: input.value });
      input.value = '';
      loadChat();
    } catch (err) { toast(err.message, true); }
  };
}

// Zakładka „Linia”: wizerunek, personel, marketing i osiągnięcia.
function airlineTab(el) {
  const { airline } = state.data;
  const R = state.st.rules;
  const sample = state.st.aircraftTypes.find((t) => t.id === 'A320');
  const wide = state.st.aircraftTypes.find((t) => t.id === 'B789');
  el.innerHTML = `
    <div class="card"><h3>Malowanie i logo</h3>
      <div class="livery-preview" id="liv-preview"></div>
      <div class="row">
        <label>Kolor statecznika<input type="color" id="liv-c1" value="${airline.color1}"></label>
        <label>Kolor pasa i logo<input type="color" id="liv-c2" value="${airline.color2}"></label>
        <label>Symbol na stateczniku<select id="liv-logo">${state.st.logos.map((l) => `<option value="${esc(l)}" ${l === airline.logo ? 'selected' : ''}>${l === 'CODE' ? `Kod linii (${esc(airline.code)})` : l}</option>`).join('')}</select></label>
        <button id="liv-save">Zapisz malowanie</button>
      </div>
      <p class="muted">Barwy widać na samolotach we „Flocie”, na mapie tras i w rankingu.</p>
    </div>
    <div class="card"><h3>Cele i osiągnięcia <span class="muted">(${state.data.achievements.length} z ${state.st.achievements.length})</span></h3>
      <div class="goals">${state.st.achievements.map((g) => {
        const done = state.data.achievements.find((x) => x.key === g.key);
        const [cur, need] = state.data.goals.find((x) => x.key === g.key).progress;
        const p = Math.max(0, Math.min(1, cur / need));
        const fmt = (v) => (/^(value|profit)/.test(g.key) ? usd(v) : Math.round(v).toLocaleString('pl-PL'));
        return `<div class="goal ${done ? 'done' : ''}"><b>${done ? '🏆' : '🎯'} ${esc(g.name)}</b><div class="muted">${esc(g.desc)}</div>
          ${done ? `<div class="pos">Zdobyte ${gameDate(done.day)} · +${usd(g.reward)}</div>`
            : `<div class="bar"><span style="width:${(p * 100).toFixed(0)}%"></span></div><div class="muted">${need > 1 ? `${fmt(Math.max(0, Math.min(cur, need)))} / ${fmt(need)} · ` : ''}nagroda ${usd(g.reward)}</div>`}</div>`;
      }).join('')}</div>
    </div>
    <div class="card"><h3>Personel i obsługa pokładowa</h3>
      <div class="row">
        <label>Pensje personelu: <b id="wage-val">${airline.wage}%</b> normy
          <input type="range" id="wage" min="${R.wageMin}" max="${R.wageMax}" step="5" value="${airline.wage}" style="width:260px"></label>
        <label>Poziom obsługi<select id="service">${R.serviceLevels.map((l, i) => `<option value="${i + 1}" ${airline.service === i + 1 ? 'selected' : ''}>${l.name} · $${l.costPerPax}/pasażera</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="loyalty" ${airline.loyalty ? 'checked' : ''}> Program lojalnościowy (${R.loyaltyCostShare * 100}% przychodów)</label>
        <button id="staff-save">Zapisz</button>
      </div>
      <p class="muted">Pensje poniżej 95% grożą strajkiem (połowa lotów odwołana), poniżej 90% psują obsługę.
        Od 115% personel jest zadowolony i reputacja rośnie. Lepsza obsługa (catering, rozrywka) kosztuje więcej na każdego pasażera
        (w klasie biznes i pierwszej trzy razy więcej), ale przyciąga klientów i buduje reputację. Program lojalnościowy dodaje ${Math.round((R.loyaltyAppeal - 1) * 100)}% atrakcyjności na wszystkich trasach.</p>
    </div>
    <div class="card"><h3>Kampanie reklamowe</h3>
      <div class="row">
        <label>Kraj<select id="ad-country">${[...new Set(state.st.airports.map((a) => a.country))].sort((a, b) => a.localeCompare(b, 'pl')).map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Rozmiar<select id="ad-level">${R.campaignLevels.map((l, i) => `<option value="${i}">${l.name} · ${usd(l.costPerDay)}/dzień · +${Math.round((l.appeal - 1) * 100)}%</option>`).join('')}</select></label>
        <button id="ad-start">Uruchom kampanię (${R.campaignDays} dni)</button>
      </div>
      <p class="muted">Reklama w kraju zwiększa atrakcyjność Twoich tras do i z tego kraju oraz ogólny popyt na nich. Najwyżej ${R.maxCampaigns} kampanii naraz.</p>
      <div id="ad-list" class="muted">Ładowanie…</div>
    </div>`;
  const current = () => ({ color1: $('#liv-c1').value, color2: $('#liv-c2').value, logo: $('#liv-logo').value, code: airline.code });
  const preview = () => { $('#liv-preview').innerHTML = planeSvg(sample, current()) + planeSvg(wide, current()); };
  for (const id of ['#liv-c1', '#liv-c2', '#liv-logo']) $(id).oninput = preview;
  preview();
  $('#liv-save').onclick = () => act(() => api('POST', '/api/airline/livery', current()), 'Nowe malowanie zapisane');

  $('#wage').oninput = (e) => { $('#wage-val').textContent = `${e.target.value}%`; };
  $('#staff-save').onclick = () => act(() => api('POST', '/api/airline/staff', {
    wage: Number($('#wage').value), service: Number($('#service').value), loyalty: $('#loyalty').checked,
  }), 'Ustawienia personelu zapisane');
  $('#ad-country').value = airport(airline.hub).country;
  $('#ad-start').onclick = () => act(() => api('POST', '/api/campaigns', { country: $('#ad-country').value, level: Number($('#ad-level').value) }), 'Kampania rusza od jutra');
  api('GET', '/api/campaigns').then((list) => {
    const box = $('#ad-list');
    if (!box) return;
    box.innerHTML = list.length ? `<table>${list.map((c) => `<tr><td>${esc(c.country)}</td><td>${R.campaignLevels[c.level].name}</td>
      <td>${usd(R.campaignLevels[c.level].costPerDay)}/dzień</td><td>do ${gameDate(c.end_day)}</td>
      <td><button class="danger" data-adstop="${c.id}">Zakończ</button></td></tr>`).join('')}</table>` : 'Brak aktywnych kampanii.';
    box.querySelectorAll('[data-adstop]').forEach((b) => (b.onclick = () => act(() => api('DELETE', `/api/campaigns/${b.dataset.adstop}`), 'Kampania zakończona')));
  });
}

async function ranking(el) {
  if (!el.innerHTML) el.innerHTML = '<div class="card muted">Ładowanie…</div>';
  const [rows, alliances, season, takeovers] = await Promise.all([api('GET', '/api/leaderboard'), api('GET', '/api/alliances'), api('GET', '/api/season'), api('GET', '/api/takeovers')]);
  if (!el.isConnected || state.tab !== 'ranking') return;
  const mine = state.data.airline.code;
  const realLeft = (sec) => {
    if (sec == null) return '';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d} dni ${h} godz.` : h ? `${h} godz. ${m} min` : m ? `${m} min` : 'mniej niż minuta';
  };
  const seasons = [...new Set(season.hall.map((h) => h.season))];
  const medal = ['🥇', '🥈', '🥉'];
  el.innerHTML = `<div class="card"><h3>Sezon ${season.season}</h3>
    <p>${season.daysLeft == null ? 'Sezon właśnie się zaczął.' : `Do końca sezonu: <b>${realLeft(season.secondsLeft)}</b> (${season.daysLeft.toLocaleString('pl-PL')} dni gry, koniec ${gameDate(season.endDay)}).`}
      Wygrywa linia z najwyższą wartością firmy. Trzy najlepsze trafiają do galerii sław, a potem świat zaczyna się od nowa i każdy zakłada nową linię.</p>
    ${seasons.length ? `<h3 style="margin-top:14px">Galeria sław</h3><div class="table-wrap"><table>
      <tr><th>Sezon</th><th>Miejsce</th><th>Linia</th><th>Gracz</th><th class="num">Wartość firmy</th></tr>
      ${season.hall.map((h) => `<tr><td>${h.season}</td><td>${medal[h.place - 1]} ${h.place}.</td><td>${esc(h.airline)} (${esc(h.code)})</td>
        <td>${h.bot ? '<span class="muted">🤖 komputer</span>' : esc(h.owner)}</td><td class="num">${usd(h.value)}</td></tr>`).join('')}
    </table></div>` : ''}
  </div>
  <div class="card"><h3>Ranking linii lotniczych</h3><div class="table-wrap"><table>
    <tr><th>#</th><th>Linia</th><th>Gracz</th><th>Sojusz</th><th>Hub</th><th>Wartość firmy</th><th>Flota</th><th>Trasy</th><th>Pasażerowie/dzień</th><th>Reputacja</th></tr>
    ${rows.map((r, i) => `<tr class="${r.code === mine ? 'me' : ''}"><td>${i + 1}</td><td>${badge(r)} ${esc(r.name)} (${esc(r.code)})</td><td>${r.bot ? '<span class="muted">🤖 komputer</span>' : esc(r.owner)}</td><td>${esc(r.alliance || '—')}</td><td>${r.hub}</td>
      <td><b>${usd(r.value)}</b></td><td>${r.fleet}</td><td>${r.routes}</td><td>${r.pax.toLocaleString('pl-PL')}</td><td>${r.reputation.toFixed(1)}</td></tr>`).join('')}
  </table></div></div>
  ${alliances.length ? `<div class="card"><h3>Ranking sojuszy</h3><div class="table-wrap"><table>
    <tr><th>#</th><th>Sojusz</th><th>Członkowie</th><th>Łączna wartość</th></tr>
    ${alliances.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.name)}</td><td>${a.members.map((m) => esc(m.code)).join(', ')}</td><td><b>${usd(a.value)}</b></td></tr>`).join('')}
  </table></div></div>` : ''}
  <div class="card" id="takeovers"></div>`;
  takeoversCard($('#takeovers'), takeovers);
}

// Oferty przejęcia, które dostała moja linia.
function takeoverIncoming(box, list) {
  box.innerHTML = `<h3>Oferty przejęcia Twojej linii</h3>
    <p class="muted">Gdy przyjmiesz ofertę, kupujący przejmie całą linię (flotę, trasy, bazy, sloty, gotówkę i długi).
      Cena trafi do Ciebie jako kapitał na start nowej linii w tym sezonie (zamiast standardowych ${usd(state.st.rules.startingCash)}).
      Jeśli wartość Twojej linii spadnie o ponad 10% od złożenia oferty, oferta wygaśnie.</p>
    ${list.length ? `<div class="table-wrap"><table><tr><th>Kupujący</th><th class="num">Cena</th><th>Ważna do</th><th></th></tr>
      ${list.map((o) => `<tr><td>${esc(o.name)} (${esc(o.code)})</td><td class="num"><b>${usd(o.price)}</b></td><td>${gameDate(o.expires)}</td>
        <td class="nowrap"><button data-accept="${o.id}">Sprzedaj linię</button> <button class="secondary" data-reject="${o.id}">Odrzuć</button></td></tr>`).join('')}
    </table></div>` : '<p class="muted">Brak ofert.</p>'}`;
  box.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = () => confirm('Na pewno sprzedać całą linię? Tego nie da się cofnąć.')
    && act(() => api('POST', `/api/takeovers/${b.dataset.accept}/accept`), 'Linia sprzedana. Możesz założyć nową.')));
  box.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = () => act(() => api('POST', `/api/takeovers/${b.dataset.reject}/reject`), 'Oferta odrzucona')));
}

function takeoversCard(box, t) {
  const cash = state.data.airline.cash;
  box.innerHTML = `<h3>Fuzje i przejęcia</h3>
    <p class="muted">Możesz odkupić inną linię razem z jej flotą, trasami, bazami i slotami. Przejmujesz też jej gotówkę i długi,
      dlatego cena to ${Math.round((state.st.rules.takeoverPremium - 1) * 100)}% ponad wartość firmy plus ${usd(state.st.rules.takeoverPerRoute)} za każdą trasę
      (co najmniej ${usd(state.st.rules.takeoverMin)}). Linię komputerową kupujesz od razu, a gracz musi zaakceptować ofertę
      w ciągu ${state.st.rules.takeoverOfferDays} dni gry. Trasy, na których już latasz, łączą się z Twoimi.</p>
    <div class="table-wrap"><table>
      <tr><th>Linia</th><th>Właściciel</th><th>Hub</th><th class="num">Flota</th><th class="num">Trasy</th><th class="num">Wartość firmy</th><th class="num">Cena przejęcia</th><th></th></tr>
      ${t.targets.map((a) => `<tr><td>${badge(a)} ${esc(a.name)} (${esc(a.code)})</td><td>${a.bot ? '<span class="muted">🤖 komputer</span>' : esc(a.owner)}</td><td>${a.hub}</td>
        <td class="num">${a.fleet}</td><td class="num">${a.routes}</td><td class="num">${usd(a.value)}</td><td class="num"><b>${usd(a.price)}</b></td>
        <td class="nowrap">${a.offered ? '<span class="muted">oferta złożona</span>'
          : `<button data-buy="${a.id}" data-bot="${a.bot ? 1 : ''}" data-name="${esc(a.name)}" data-price="${a.price}" ${cash >= a.price ? '' : `disabled title="Brakuje ${usd(a.price - cash)}"`}>${a.bot ? 'Przejmij' : 'Złóż ofertę'}</button>`}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">Nie ma innych linii.</td></tr>'}
    </table></div>
    ${t.outgoing.length ? `<h3 style="margin-top:14px">Twoje oferty</h3><div class="table-wrap"><table><tr><th>Linia</th><th class="num">Cena</th><th>Ważna do</th><th></th></tr>
      ${t.outgoing.map((o) => `<tr><td>${esc(o.name)} (${esc(o.code)})</td><td class="num">${usd(o.price)}</td><td>${gameDate(o.expires)}</td>
        <td class="nowrap"><button class="secondary" data-cancel="${o.id}">Wycofaj</button></td></tr>`).join('')}</table></div>` : ''}
    <div id="to-incoming" style="margin-top:14px"></div>`;
  if (t.incoming.length) takeoverIncoming($('#to-incoming'), t.incoming);
  box.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
    const bot = !!b.dataset.bot;
    if (!confirm(`${bot ? 'Przejąć' : 'Złożyć ofertę przejęcia linii'} ${b.dataset.name} za ${usd(Number(b.dataset.price))}?`)) return;
    act(() => api('POST', '/api/takeovers', { airlineId: Number(b.dataset.buy) }), bot ? `${b.dataset.name} jest Twoja!` : 'Oferta wysłana. Właściciel ma 7 dni na odpowiedź.');
  }));
  box.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => act(() => api('DELETE', `/api/takeovers/${b.dataset.cancel}`), 'Oferta wycofana')));
}

async function mapTab(el) {
  el.innerHTML = `<div class="card"><div id="map"></div><p class="muted">Każda linia ma trasy w swoim kolorze, Twoje są grubsze. Zielone punkty: Twoje bazy.
    <b>Kliknij lotnisko</b>, żeby zobaczyć jego popyt, konkurencję i Twoje połączenia.</p></div>
    <div class="card" id="ap-stats" hidden></div>`;
  // Kontury lądów są w repozytorium, więc mapa nie zależy od zewnętrznych serwerów kafelków.
  const map = (state.map = L.map('map', { minZoom: 2, maxZoom: 7 }).setView([45, 15], 3));
  map.attributionControl.setPrefix('').addAttribution('Natural Earth');
  const [land, all] = await Promise.all([
    state.land || fetch('/vendor/land.geojson').then((r) => r.json()),
    api('GET', '/api/routes/all'),
  ]);
  state.land = land;
  if (state.map !== map) return; // gracz zdążył zmienić zakładkę
  L.geoJSON(land, { style: { color: '#3a4a6b', weight: 1, fillColor: '#1c2a45', fillOpacity: 1 }, interactive: false }).addTo(map);
  const mine = state.data.airline.code;
  for (const r of all) {
    const a = airport(r.origin), b = airport(r.dest);
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: r.color1 || '#6b7a99', weight: r.code === mine ? 3.5 : 1.5, opacity: r.code === mine ? 0.95 : 0.6 })
      .bindTooltip(`${r.code}: ${r.origin}–${r.dest}`).addTo(map);
  }
  // Bazy rysujemy na końcu, żeby były na wierzchu i łatwo było je kliknąć.
  const isBase = (ap) => state.data.bases.includes(ap.code);
  for (const ap of [...state.st.airports].sort((x, y) => isBase(x) - isBase(y) || x.size - y.size)) {
    const base = isBase(ap);
    L.circleMarker([ap.lat, ap.lon], { radius: base ? 6 : 1.5 + ap.size / 3, weight: 1, color: base ? '#3ecf8e' : '#93a3bf', fillOpacity: 0.8 })
      .bindTooltip(`${ap.city} (${ap.code}) · rynek ${ap.size}/10`).on('click', () => airportStats(ap.code)).addTo(map);
  }
}

async function airportStats(code) {
  const box = $('#ap-stats');
  box.hidden = false;
  box.innerHTML = '<p class="muted">Ładowanie…</p>';
  const req = (airportStats.req = (airportStats.req || 0) + 1);
  let s;
  try { s = await api('GET', `/api/airport/${code}`); } catch (e) { s = { error: e.message }; }
  // Gracz zdążył kliknąć inne lotnisko albo zmienić zakładkę: ta odpowiedź jest już nieaktualna.
  if (req !== airportStats.req || !box.isConnected) return;
  if (s.error) { box.innerHTML = `<p class="neg">${esc(s.error)}</p>`; return; }
  const a = s.airport, n = (x) => x.toLocaleString('pl-PL');
  const lf = (pax, seats) => (seats ? pct(pax / seats) : '—');
  const city = (c) => `${esc(airport(c).city)} (${c})`;
  const mkt = (rows, withOpen) => `<div class="table-wrap"><table>
    <tr><th>Kierunek</th><th class="num">Dystans</th><th class="num">Popyt/dzień</th><th class="num">Bilet ekon.</th><th class="num">Linie na trasie</th><th></th></tr>
    ${rows.map((m) => `<tr class="${m.mine ? 'me' : ''}"><td>${city(m.code)}</td><td class="num">${n(m.distance)} km</td><td class="num">${n(m.demand)}</td>
      <td class="num">$${m.fare}</td><td class="num">${m.rivals}</td>
      <td>${m.mine ? '<span class="muted">latasz</span>' : withOpen(m) ? `<button class="secondary" data-open="${withOpen(m)}" data-to="${m.code === code ? '' : m.code}">Otwórz trasę</button>` : ''}</td></tr>`).join('')}
  </table></div>`;
  const bases = state.data.bases;
  box.innerHTML = `<h3>${esc(a.city)} (${a.code}) <span class="muted">· ${esc(a.country)} · rynek ${a.size}/10${s.isBase ? ' · Twoja baza' : ''}</span></h3>
    <div class="grid">
      <div class="stat"><div class="k">Trasy (wszystkie linie)</div><div class="v">${s.totals.routes}</div></div>
      <div class="stat"><div class="k">Pasażerowie/dzień</div><div class="v">${n(s.totals.pax)}</div></div>
      <div class="stat"><div class="k">Obłożenie</div><div class="v">${lf(s.totals.pax, s.totals.seats)}</div></div>
      <div class="stat"><div class="k">Linie</div><div class="v">${s.airlines.length}</div></div>
      ${s.slot ? `<div class="stat"><div class="k">Sloty (zajęte / pula)</div><div class="v">${s.slot.used} / ${s.slot.capacity}</div></div>
        <div class="stat"><div class="k">Twoje sloty · cena kolejnego</div><div class="v">${s.slot.mine} · ${s.slot.used < s.slot.capacity ? usd(s.slot.price) : 'brak'}</div></div>` : ''}
    </div>
    ${s.airlines.length ? `<h3 style="margin-top:14px">Konkurencja na lotnisku</h3><div class="table-wrap"><table>
      <tr><th>Linia</th><th class="num">Trasy</th><th class="num">Pasażerowie/dzień</th><th class="num">Obłożenie</th><th class="num">Udział</th></tr>
      ${s.airlines.map((x) => `<tr class="${x.mine ? 'me' : ''}"><td>${badge(x)} ${esc(x.name)} (${esc(x.code)})</td><td class="num">${x.routes}</td><td class="num">${n(x.pax)}</td>
        <td class="num">${lf(x.pax, x.seats)}</td><td class="num">${s.totals.pax ? pct(x.pax / s.totals.pax) : '—'}</td></tr>`).join('')}
    </table></div>
    <h3 style="margin-top:14px">Trasy z tego lotniska</h3><div class="table-wrap"><table>
      <tr><th>Linia</th><th>Dokąd</th><th class="num">Dystans</th><th class="num">Ceny (E / B / P)</th><th class="num">Pasażerowie/dzień</th><th class="num">Obłożenie</th></tr>
      ${s.routes.map((r) => `<tr class="${r.mine ? 'me' : ''}"><td>${badge(r)} ${esc(r.code)}</td><td>${city(r.other)}</td><td class="num">${n(r.distance)} km</td>
        <td class="num">$${r.prices.y} / $${r.prices.j} / $${r.prices.f}</td><td class="num">${n(r.pax)}</td><td class="num">${lf(r.pax, r.seats)}</td></tr>`).join('')}
    </table></div>` : '<p class="muted">Żadna linia jeszcze tu nie lata.</p>'}
    ${s.fromBases.length ? `<h3 style="margin-top:14px">Popyt z Twoich baz</h3>${mkt(s.fromBases, (m) => m.code)}` : ''}
    <h3 style="margin-top:14px">Kierunki z największym popytem</h3>
    ${mkt(s.top, (m) => (s.isBase ? code : bases.includes(m.code) ? m.code : ''))}`;
  // „Otwórz trasę” przenosi do formularza w zakładce Trasy z wybranym kierunkiem.
  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
    const origin = b.dataset.open, dest = origin === code ? b.dataset.to : code;
    const d = airport(dest);
    Object.assign(state, { routeOrigin: origin, routeDest: dest, routeContinent: continentOf(d), routeCountry: d.country, tab: 'routes' });
    renderMain();
    window.scrollTo(0, 0);
  }));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

boot().catch((e) => toast(e.message, true));
