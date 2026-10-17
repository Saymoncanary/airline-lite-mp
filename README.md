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
- **Lotniska**: 416 lotnisk z całego świata, pogrupowanych według regionów. Wielkość rynku (1-10) decyduje o popycie.
- **Samoloty**: 36 typów od 9 producentów. Nowe samoloty się **zamawia** i przylatują po kilku dniach gry
  (turbośmigłowe 3, regionalne 4, wąskokadłubowe 5, szerokokadłubowe 8). Zakup = pełna cena, leasing = 5% na start i dzienna rata.
- **Rynek wtórny**: broker wystawia używane samoloty (tańsze, od ręki, ale starsze i zużyte), a gracze sprzedają tam
  swoje maszyny innym graczom za własną cenę.
- **Klasy podróży**: ekonomiczna, biznes i pierwsza. Każdy samolot ma własny układ foteli (fotel biznes zajmuje 2 miejsca
  ekonomiczne, pierwszej klasy 3), a każda trasa ma trzy ceny biletów. Na długich trasach popyt na klasy premium jest większy.
- **Stan techniczny**: samoloty zużywają się podczas lotów. Zużyte kosztują więcej, mogą się zepsuć i obniżają reputację.
  Przegląd przywraca 100% i trwa 2 dni; można włączyć automatyczne przeglądy poniżej wybranego progu.
- **Świat**: cena paliwa zmienia się codziennie, popyt zależy od sezonu (wakacje i grudzień to szczyt), a losowe
  wydarzenia (strajki, targi, kryzysy, boomy turystyczne, skoki cen ropy) zmieniają sytuację na rynku.
- **Konkurencja**: gdy kilka linii lata na tej samej trasie, pasażerowie każdej klasy wybierają według ceny,
  liczby miejsc i reputacji linii. Zbyt wysoka cena zmniejsza popyt.
- **Sojusze**: do 8 linii, wspólny czat i premia codeshare (+15% atrakcyjności tras do baz partnerów).
- **Kredyt** do $300 mln (6% rocznie). Nowe **bazy** kosztują 2 mln × wielkość lotniska.
- **Ranking** linii według wartości firmy (gotówka + wartość własnych samolotów − dług) oraz ranking sojuszy.

## Budowa

```
server.js        start serwera i zegar gry
src/app.js       API (JSON) i serwowanie plików
src/auth.js      hasła (scrypt), sesje, limit prób logowania
src/game.js      ekonomia i symulacja dnia
src/data.js      typy samolotów i wczytanie lotnisk
src/airports.json lotniska (współrzędne: OpenFlights)
src/db.js        schemat bazy SQLite
public/          interfejs (HTML, CSS, JS; mapa: Leaflet i kontury Natural Earth w public/vendor)
test/            testy (node:test)
```

Bezpieczeństwo: hasła hashowane scryptem z solą, sesje w ciasteczku HttpOnly/SameSite,
API przyjmuje tylko JSON (ochrona przed CSRF), limit nieudanych logowań, zapytania SQL
wyłącznie z parametrami, dane graczy escapowane w interfejsie.

## Hosting

Gra to jeden proces Node z plikiem bazy, więc działa na każdym serwerze z Node 22
(VPS, Railway, Render, Fly.io). Plik `DB_FILE` musi leżeć na trwałym dysku, a przed
serwerem warto postawić HTTPS i ustawić `COOKIE_SECURE=1`.
