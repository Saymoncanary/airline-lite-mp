# Imperium Lotnicze

Przeglądarkowa gra multiplayer o zarządzaniu linią lotniczą (w stylu Airline Empires).
Gracze zakładają konto, tworzą własną linię, kupują lub leasingują samoloty, otwierają
trasy między prawdziwymi lotniskami i konkurują o pasażerów. Ranking pokazuje, kto
zbudował najcenniejszą firmę.

## Uruchomienie

Wymagany jest tylko **Node.js 22.13 lub nowszy**. Projekt nie ma zewnętrznych zależności,
a baza danych (SQLite) jest wbudowana w Node.

```bash
npm start          # http://localhost:3000, 1 dzień gry = 60 s
npm run dev        # szybszy zegar: 1 dzień gry = 5 s
npm test           # testy automatyczne
```

Zmienne środowiskowe:

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `PORT` | `3000` | port serwera |
| `TICK_SECONDS` | `60` | ile sekund trwa jeden dzień gry |
| `DB_FILE` | `./data/game.db` | plik bazy danych |
| `COOKIE_SECURE` | – | ustaw `1`, gdy gra działa za HTTPS |

## Zasady gry

- Na start linia dostaje **$200 mln** i jedną bazę (hub).
- **Samoloty**: 8 typów (od ATR 72 po Boeinga 777). Zakup = pełna cena, leasing = 5% na start
  i dzienna rata. Samolot własny można sprzedać (traci na wartości z wiekiem), leasingowany zwrócić z karą.
- **Trasy** otwiera się tylko z własnych baz. Każda para miast ma dzienny popyt zależny od
  wielkości lotnisk i dystansu. Gracz ustala cenę biletu.
- **Konkurencja**: gdy kilka linii lata na tej samej trasie, pasażerowie wybierają według ceny,
  liczby miejsc i reputacji linii. Zbyt wysoka cena zmniejsza popyt.
- **Koszty**: paliwo i obsługa za km, opłaty lotniskowe za każdy lot, koszty stałe samolotu,
  raty leasingu i odsetki od kredytu.
- **Kredyt** do $300 mln (6% rocznie). Nowe **bazy** kosztują 2 mln × wielkość lotniska.
- **Ranking** według wartości firmy: gotówka + wartość własnych samolotów − dług.

## Budowa

```
server.js        start serwera i zegar gry
src/app.js       API (JSON) i serwowanie plików
src/auth.js      hasła (scrypt), sesje, limit prób logowania
src/game.js      ekonomia i symulacja dnia
src/data.js      lotniska i typy samolotów
src/db.js        schemat bazy SQLite
public/          interfejs (HTML, CSS, JS; mapa przez Leaflet)
test/            testy (node:test)
```

Bezpieczeństwo: hasła hashowane scryptem z solą, sesje w ciasteczku HttpOnly/SameSite,
API przyjmuje tylko JSON (ochrona przed CSRF), limit nieudanych logowań, zapytania SQL
wyłącznie z parametrami, dane graczy escapowane w interfejsie.

## Hosting

Gra to jeden proces Node z plikiem bazy, więc działa na każdym serwerze z Node 22
(VPS, Railway, Render, Fly.io). Plik `DB_FILE` musi leżeć na trwałym dysku, a przed
serwerem warto postawić HTTPS i ustawić `COOKIE_SECURE=1`.
