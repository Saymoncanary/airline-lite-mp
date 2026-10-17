'use strict';

const state = { me: null, st: null, data: null, tab: 'dashboard', map: null };
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
function maxRoundTrips(t, dist) {
  const R = state.st.rules;
  const rt = 2 * (dist / t.speed + R.turnaroundHours);
  const n = Math.floor(R.operatingHours / rt);
  return n >= 1 ? n : rt <= 2 * R.operatingHours ? 0.5 : 0;
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
}

async function route() {
  state.me = await api('GET', '/api/me');
  if (!state.me.user) return renderAuth();
  if (!state.me.airline) return renderFound();
  await refresh();
}

async function refresh(auto = false) {
  try {
    state.data = await api('GET', '/api/airline');
  } catch (e) {
    if (!auto) toast(e.message, true);
    return;
  }
  renderTop();
  // Przy automatycznym odświeżaniu nie przerysowujemy formularzy, w których gracz coś wpisuje.
  if (!auto || ['dashboard', 'ranking'].includes(state.tab)) renderMain();
}

function renderTop() {
  const { airline, day } = state.data || {};
  $('#topinfo').innerHTML = airline
    ? `<span>📅 <b>${gameDate(day)}</b></span>
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
      <p class="muted">Na start dostajesz ${usd(state.st.rules.startingCash)}. Wybierz port macierzysty: duże lotnisko to duży popyt, ale i silna konkurencja.</p>
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
  ['dashboard', 'Pulpit'], ['routes', 'Trasy'], ['fleet', 'Flota'], ['shop', 'Kup samoloty'],
  ['map', 'Mapa'], ['finance', 'Finanse'], ['ranking', 'Ranking'],
];

function renderMain() {
  if (state.map) { state.map.remove(); state.map = null; }
  view().innerHTML = `<nav class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div id="tab"></div>`;
  view().querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderMain(); }));
  ({ dashboard, routes: routesTab, fleet, shop, map: mapTab, finance, ranking })[state.tab]($('#tab'));
}

function dashboard(el) {
  const { airline, fleet, routes, stats } = state.data;
  const last = stats[stats.length - 1];
  const profit = last ? last.revenue - last.costs : 0;
  const maxAbs = Math.max(1, ...stats.map((s) => Math.abs(s.revenue - s.costs)));
  el.innerHTML = `
    <div class="card"><div class="grid">
      <div class="stat"><div class="k">Gotówka</div><div class="v">${usd(airline.cash)}</div></div>
      <div class="stat"><div class="k">Wartość firmy</div><div class="v">${usd(airline.value)}</div></div>
      <div class="stat"><div class="k">Zysk wczoraj</div><div class="v">${signed(profit)}</div></div>
      <div class="stat"><div class="k">Pasażerowie wczoraj</div><div class="v">${(last?.pax || 0).toLocaleString('pl-PL')}</div></div>
      <div class="stat"><div class="k">Flota / trasy</div><div class="v">${fleet.length} / ${routes.length}</div></div>
      <div class="stat"><div class="k">Reputacja</div><div class="v">${airline.reputation.toFixed(1)}</div></div>
    </div></div>
    <div class="card"><h3>Dzienny zysk (ostatnie 30 dni)</h3>
      ${stats.length ? `<div class="chart">${stats.map((s) => {
        const p = s.revenue - s.costs, h = Math.max(1, (Math.abs(p) / maxAbs) * 50);
        return `<div title="Dzień ${s.day}: ${usd(p)}"><span class="${p >= 0 ? 'up' : 'down'}" style="height:${h}%"></span></div>`;
      }).join('')}</div>` : '<p class="muted">Brak danych. Wyniki pojawią się po pierwszym dniu gry.</p>'}
    </div>
    ${fleet.length === 0 ? '<div class="card"><b>Pierwsze kroki:</b> 1) kup lub wyleasinguj samolot w zakładce „Kup samoloty”, 2) otwórz trasę ze swojej bazy w zakładce „Trasy”, 3) przypisz samolot do trasy we „Flocie”.</div>' : ''}
    <div class="card"><h3>Wiadomości ze świata lotnictwa</h3><ul class="news" id="news"><li class="muted">Ładowanie…</li></ul></div>`;
  api('GET', '/api/news').then((rows) => {
    const n = $('#news');
    if (n) n.innerHTML = rows.map((r) => `<li><span class="muted">${gameDate(r.day)}:</span> ${esc(r.text)}</li>`).join('') || '<li class="muted">Cisza w eterze.</li>';
  });
}

function routesTab(el) {
  const { routes, fleet, bases } = state.data;
  const assigned = (rid) => fleet.filter((a) => a.route_id === rid);
  el.innerHTML = `
    <div class="card"><h3>Otwórz nową trasę</h3>
      <div class="row">
        <label>Skąd (baza)<select id="r-origin">${bases.map((b) => `<option value="${b}">${esc(apLabel(b))}</option>`).join('')}</select></label>
        <label>Dokąd<select id="r-dest">${airportOptions({ label: (a) => `${esc(a.city)} (${a.code}) · ${a.size}/10` })}</select></label>
        <label>Cena biletu (USD)<input id="r-price" type="number" min="10" style="width:120px"></label>
        <button id="r-open">Otwórz trasę</button>
      </div>
      <div id="r-market" class="muted"></div>
    </div>
    <div class="card"><h3>Twoje trasy</h3>
      ${routes.length ? `<div class="table-wrap"><table>
        <tr><th>Trasa</th><th>Dystans</th><th>Cena</th><th>Samoloty</th><th>Pasażerowie/dzień</th><th>Obłożenie</th><th>Przychód</th><th>Koszt lotów</th><th></th></tr>
        ${routes.map((r) => `<tr>
          <td>${r.origin} ⇄ ${r.dest}<div class="muted">${esc(airport(r.origin).city)} – ${esc(airport(r.dest).city)}</div></td>
          <td>${r.distance.toLocaleString('pl-PL')} km</td>
          <td><input type="number" value="${r.price}" min="10" data-price="${r.id}" style="width:90px"> <span class="muted">ref. $${r.baseFare}</span></td>
          <td>${assigned(r.id).length}</td>
          <td>${r.last_pax.toLocaleString('pl-PL')}</td>
          <td>${r.last_seats ? pct(r.last_pax / r.last_seats) : '—'}</td>
          <td>${usd(r.last_revenue)}</td>
          <td>${usd(r.last_cost)}</td>
          <td><button class="danger" data-close="${r.id}">Zamknij</button></td>
        </tr>`).join('')}
      </table></div>` : '<p class="muted">Nie masz jeszcze tras.</p>'}
    </div>`;

  const showMarket = async () => {
    const o = $('#r-origin').value, d = $('#r-dest').value;
    if (!o || o === d) { $('#r-market').textContent = ''; return; }
    try {
      const m = await api('GET', `/api/market?origin=${o}&dest=${d}`);
      $('#r-price').placeholder = m.baseFare;
      $('#r-market').innerHTML = `Dystans ${m.distance.toLocaleString('pl-PL')} km · popyt ok. ${m.dailyDemand} pasażerów dziennie w każdą stronę przy cenie $${m.baseFare}.
        ${m.competitors.length ? `<br>Konkurencja: ${m.competitors.map((c) => `${esc(c.name)} ($${c.price}, ${c.seats} miejsc/dzień)`).join(', ')}` : '<br>Brak konkurencji na tej trasie.'}`;
    } catch (e) { $('#r-market').textContent = e.message; }
  };
  $('#r-origin').onchange = showMarket;
  $('#r-dest').onchange = showMarket;
  showMarket();
  $('#r-open').onclick = () => act(() => api('POST', '/api/routes', { origin: $('#r-origin').value, dest: $('#r-dest').value, price: Number($('#r-price').value) || undefined }), 'Trasa otwarta. Przypisz do niej samolot we Flocie.');
  el.querySelectorAll('[data-price]').forEach((i) => (i.onchange = () => act(() => api('PATCH', `/api/routes/${i.dataset.price}`, { price: Number(i.value) }), 'Cena zmieniona')));
  el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => confirm('Zamknąć trasę? Samoloty wrócą do hangaru.') && act(() => api('DELETE', `/api/routes/${b.dataset.close}`), 'Trasa zamknięta')));
}

function fleet(el) {
  const { fleet: planes, routes, day } = state.data;
  el.innerHTML = `<div class="card"><h3>Twoja flota</h3>
    ${planes.length ? `<div class="table-wrap"><table>
      <tr><th>#</th><th>Typ</th><th>Własność</th><th>Wiek</th><th>Trasa</th><th>Rotacje/dzień</th><th></th></tr>
      ${planes.map((a) => {
        const t = type(a.type_id);
        const opts = routes.map((r) => {
          const dist = distanceKm(r.origin, r.dest), max = maxRoundTrips(t, dist), ok = dist <= t.rangeKm && max > 0;
          return `<option value="${r.id}" data-max="${max}" ${a.route_id === r.id ? 'selected' : ''} ${ok ? '' : 'disabled'}>${r.origin}–${r.dest}${ok ? ` (max ${max})` : ' (za daleko)'}</option>`;
        }).join('');
        return `<tr>
          <td>${a.id}</td>
          <td>${esc(t.name)}<div class="muted">${t.seats} miejsc · ${t.rangeKm.toLocaleString('pl-PL')} km</div></td>
          <td>${a.leased ? `Leasing (${usd(a.leaseDaily)}/dzień)` : `Własny (${usd(a.value)})`}</td>
          <td>${day - a.acquired_day} dni</td>
          <td><select data-route="${a.id}"><option value="">— w hangarze —</option>${opts}</select></td>
          <td><input type="number" data-rt="${a.id}" value="${a.round_trips || ''}" min="0.5" step="0.5" style="width:70px"></td>
          <td><button class="danger" data-sell="${a.id}">${a.leased ? 'Zwróć' : 'Sprzedaj'}</button></td>
        </tr>`;
      }).join('')}
    </table></div>
    <p class="muted">Rotacja = lot tam i z powrotem. Samolot może latać ok. ${state.st.rules.operatingHours} h na dobę; 0,5 oznacza rejs co drugi dzień (bardzo długie trasy).</p>` : '<p class="muted">Nie masz jeszcze samolotów. Zajrzyj do zakładki „Kup samoloty”.</p>'}
  </div>`;

  const assign = (id) => {
    const sel = el.querySelector(`[data-route="${id}"]`), rt = el.querySelector(`[data-rt="${id}"]`);
    if (!sel.value) return act(() => api('POST', `/api/aircraft/${id}/assign`, { routeId: null }), 'Samolot w hangarze');
    const max = Number(sel.selectedOptions[0].dataset.max);
    const n = Math.min(max, Number(rt.value) || max);
    act(() => api('POST', `/api/aircraft/${id}/assign`, { routeId: Number(sel.value), roundTrips: n }), 'Samolot przypisany');
  };
  el.querySelectorAll('[data-route]').forEach((s) => (s.onchange = () => { el.querySelector(`[data-rt="${s.dataset.route}"]`).value = ''; assign(s.dataset.route); }));
  el.querySelectorAll('[data-rt]').forEach((i) => (i.onchange = () => assign(i.dataset.rt)));
  el.querySelectorAll('[data-sell]').forEach((b) => (b.onclick = () => {
    const a = planes.find((p) => p.id === Number(b.dataset.sell));
    const msg = a.leased
      ? `Zwrócić samolot? Kara: ${usd(a.leaseDaily * state.st.rules.earlyReturnLeaseDays)}.`
      : `Sprzedać samolot za ${usd(a.value)}?`;
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
    <td><b>${esc(t.name)}</b><div class="muted">${esc(t.maker)}</div></td><td>${t.seats}</td><td>${t.rangeKm.toLocaleString('pl-PL')} km</td><td>${t.speed} km/h</td>
    <td>$${t.costPerKm}</td><td>${usd(t.dailyFixed)}</td><td>${usd(t.price)}</td>
    <td>${usd(t.price * R.leaseDepositPct)} na start<br><span class="muted">+ ${usd(t.price * R.leaseDailyPct)}/dzień</span></td>
    <td><button data-buy="${t.id}" ${cash < t.price ? 'disabled title="Za mało gotówki"' : ''}>Kup</button> <button class="secondary" data-lease="${t.id}">Leasing</button></td>
  </tr>`;
  el.innerHTML = `<div class="card"><h3>Producenci samolotów</h3>
    <nav class="tabs makers">
      ${makers.map((m) => `<button data-maker="${esc(m)}" class="${f.maker === m ? 'active' : ''}">${esc(m)} <span class="muted">${count(m)}</span></button>`).join('')}
      <button data-maker="" class="${f.maker ? '' : 'active'}">Wszyscy <span class="muted">${state.st.aircraftTypes.length}</span></button>
    </nav>
    <div class="row">
      <label>Kategoria<select id="f-cat" style="min-width:240px"><option value="">Wszystkie</option>${CATEGORIES.map(([id, n]) => `<option value="${id}" ${f.cat === id ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="muted">${list.length} z ${state.st.aircraftTypes.length} typów</p>
    </div>
    <div class="table-wrap"><table>
      <tr><th>Model</th><th>Miejsca</th><th>Zasięg</th><th>Prędkość</th><th>Koszt/km</th><th>Koszt stały/dzień</th><th>Cena</th><th>Leasing</th><th></th></tr>
      ${CATEGORIES.map(([id, name]) => {
        const group = list.filter((t) => t.cat === id);
        return group.length ? `<tr><th colspan="9" class="group">${name}</th></tr>${group.map(row).join('')}` : '';
      }).join('') || '<tr><td colspan="9" class="muted">Ten producent nie ma samolotów w tej kategorii.</td></tr>'}
    </table></div></div>`;
  $('#f-cat').onchange = (e) => { f.cat = e.target.value; shop(el); };
  el.querySelectorAll('[data-maker]').forEach((b) => (b.onclick = () => { f.maker = b.dataset.maker; shop(el); }));
  el.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => act(() => api('POST', '/api/aircraft', { typeId: b.dataset.buy, mode: 'buy' }), 'Samolot kupiony!')));
  el.querySelectorAll('[data-lease]').forEach((b) => (b.onclick = () => act(() => api('POST', '/api/aircraft', { typeId: b.dataset.lease, mode: 'lease' }), 'Samolot wyleasingowany!')));
}

function finance(el) {
  const { airline, bases, stats } = state.data;
  const R = state.st.rules;
  const sum = (k) => stats.reduce((s, x) => s + x[k], 0);
  el.innerHTML = `
    <div class="card"><h3>Kredyt</h3>
      <p>Zadłużenie: <b>${usd(airline.debt)}</b> z limitu ${usd(R.maxDebt)} · oprocentowanie ${R.loanInterestYear * 100}% rocznie (naliczane codziennie).</p>
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
    <div class="card"><h3>Wyniki z ostatnich ${stats.length} dni</h3>
      <p>Przychody: <b>${usd(sum('revenue'))}</b> · Koszty: <b>${usd(sum('costs'))}</b> · Zysk: <b>${signed(sum('revenue') - sum('costs'))}</b> · Pasażerowie: <b>${sum('pax').toLocaleString('pl-PL')}</b></p>
    </div>`;
  const amt = () => Math.round(Number($('#loan').value) * 1e6);
  $('#borrow').onclick = () => act(() => api('POST', '/api/loan', { amount: amt() }), 'Kredyt przyznany');
  $('#repay').onclick = () => act(() => api('POST', '/api/loan', { amount: -amt() }), 'Spłacono');
  $('#openbase').onclick = () => act(() => api('POST', '/api/bases', { airport: $('#base').value }), 'Baza otwarta');
}

async function ranking(el) {
  el.innerHTML = '<div class="card muted">Ładowanie…</div>';
  const rows = await api('GET', '/api/leaderboard');
  const mine = state.data.airline.code;
  el.innerHTML = `<div class="card"><h3>Ranking linii lotniczych</h3><div class="table-wrap"><table>
    <tr><th>#</th><th>Linia</th><th>Gracz</th><th>Hub</th><th>Wartość firmy</th><th>Flota</th><th>Trasy</th><th>Pasażerowie/dzień</th><th>Reputacja</th></tr>
    ${rows.map((r, i) => `<tr class="${r.code === mine ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)} (${esc(r.code)})</td><td>${esc(r.owner)}</td><td>${r.hub}</td>
      <td><b>${usd(r.value)}</b></td><td>${r.fleet}</td><td>${r.routes}</td><td>${r.pax.toLocaleString('pl-PL')}</td><td>${r.reputation.toFixed(1)}</td></tr>`).join('')}
  </table></div></div>`;
}

async function mapTab(el) {
  el.innerHTML = `<div class="card"><div id="map"></div><p class="muted">Niebieskie linie: Twoje trasy. Szare: trasy konkurencji. Zielone punkty: Twoje bazy.</p></div>`;
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
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: r.code === mine ? '#3fa9f5' : '#6b7a99', weight: r.code === mine ? 3 : 1.5, opacity: 0.8 })
      .bindTooltip(`${r.code}: ${r.origin}–${r.dest}`).addTo(map);
  }
  for (const ap of state.st.airports) {
    const base = state.data.bases.includes(ap.code);
    L.circleMarker([ap.lat, ap.lon], { radius: base ? 6 : 1.5 + ap.size / 3, weight: 1, color: base ? '#3ecf8e' : '#93a3bf', fillOpacity: 0.8 })
      .bindTooltip(`${ap.city} (${ap.code}) · rynek ${ap.size}/10`).addTo(map);
  }
}

boot().catch((e) => toast(e.message, true));
