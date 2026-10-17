// Dane statyczne gry: lotniska i typy samolotów.

import { readFileSync } from 'node:fs';

// Lotniska: [kod IATA, miasto, kraj, szerokość, długość, wielkość rynku 1-10, region].
// Współrzędne pochodzą z bazy OpenFlights, wielkość rynku jest ustawiona ręcznie.
const RAW_AIRPORTS = JSON.parse(readFileSync(new URL('./airports.json', import.meta.url), 'utf8'));

export const AIRPORTS = Object.fromEntries(
  RAW_AIRPORTS.map(([code, city, country, lat, lon, size, region]) => [code, { code, city, country, lat, lon, size, region }])
);

// cat: turbo (turbośmigłowe), regional (regionalne odrzutowe), narrow (wąskokadłubowe), wide (szerokokadłubowe).
// price: cena zakupu (USD); costPerKm: paliwo i obsługa na km lotu;
// dailyFixed: załoga, serwis, ubezpieczenie za dzień niezależnie od lotów.
// Starsze konstrukcje są tańsze w zakupie, ale palą więcej paliwa na miejsce.
const t = (id, maker, cat, name, seats, rangeKm, speed, priceM, costPerKm, dailyFixed) =>
  ({ id, maker, cat, name, seats, rangeKm, speed, price: priceM * 1e6, costPerKm, dailyFixed });

export const AIRCRAFT_TYPES = Object.fromEntries([
  // Turbośmigłowe
  t('ATR42', 'ATR', 'turbo', 'ATR 42-600', 48, 1300, 500, 19, 2.3, 2800),
  t('ATR72', 'ATR', 'turbo', 'ATR 72-600', 70, 1500, 510, 26, 3.0, 3500),
  t('DH8D', 'De Havilland', 'turbo', 'Dash 8-400', 78, 2000, 660, 32, 3.3, 3700),
  // Regionalne odrzutowe
  t('CRJ7', 'Bombardier', 'regional', 'CRJ700', 70, 2600, 830, 38, 4.0, 4200),
  t('CRJ9', 'Bombardier', 'regional', 'CRJ900', 90, 2900, 830, 46, 4.6, 4800),
  t('E175', 'Embraer', 'regional', 'Embraer E175', 76, 3700, 830, 50, 3.9, 4500),
  t('E190', 'Embraer', 'regional', 'Embraer E190', 100, 4500, 830, 48, 4.6, 5000),
  t('E290', 'Embraer', 'regional', 'Embraer E190-E2', 106, 5300, 830, 56, 4.0, 5000),
  t('E195', 'Embraer', 'regional', 'Embraer E195-E2', 120, 4800, 830, 60, 4.5, 5500),
  t('SU95', 'Sukhoi', 'regional', 'Superjet 100', 98, 3000, 830, 35, 4.8, 5200),
  // Wąskokadłubowe
  t('BCS1', 'Airbus', 'narrow', 'Airbus A220-100', 120, 6300, 830, 81, 4.3, 5500),
  t('BCS3', 'Airbus', 'narrow', 'Airbus A220-300', 145, 6200, 830, 91, 4.9, 6000),
  t('A319', 'Airbus', 'narrow', 'Airbus A319neo', 140, 6900, 830, 101, 5.2, 7000),
  t('A320C', 'Airbus', 'narrow', 'Airbus A320ceo', 180, 6100, 830, 75, 6.8, 7000),
  t('A320', 'Airbus', 'narrow', 'Airbus A320neo', 180, 6300, 840, 110, 5.9, 7500),
  t('A321', 'Airbus', 'narrow', 'Airbus A321neo', 220, 7400, 840, 130, 6.9, 8500),
  t('A21X', 'Airbus', 'narrow', 'Airbus A321XLR', 200, 8700, 840, 142, 6.6, 8500),
  t('B737', 'Boeing', 'narrow', 'Boeing 737-700', 140, 6300, 830, 70, 5.8, 6500),
  t('B738', 'Boeing', 'narrow', 'Boeing 737-800', 189, 5400, 840, 95, 6.6, 7500),
  t('B38M', 'Boeing', 'narrow', 'Boeing 737 MAX 8', 189, 6500, 840, 121, 5.8, 7500),
  t('B3XM', 'Boeing', 'narrow', 'Boeing 737 MAX 10', 230, 5700, 840, 135, 6.9, 8500),
  t('B752', 'Boeing', 'narrow', 'Boeing 757-200', 200, 7200, 850, 60, 9.8, 9000),
  t('C919', 'COMAC', 'narrow', 'COMAC C919', 168, 4100, 830, 99, 6.2, 7500),
  // Szerokokadłubowe
  t('B763', 'Boeing', 'wide', 'Boeing 767-300ER', 218, 11000, 850, 120, 11.5, 14000),
  t('A333', 'Airbus', 'wide', 'Airbus A330-300', 290, 11700, 870, 200, 13.5, 16000),
  t('A339', 'Airbus', 'wide', 'Airbus A330-900neo', 287, 13300, 870, 290, 11.5, 17000),
  t('B788', 'Boeing', 'wide', 'Boeing 787-8', 248, 13500, 900, 250, 10.5, 15000),
  t('B789', 'Boeing', 'wide', 'Boeing 787-9', 296, 14000, 900, 290, 11.8, 17500),
  t('B78X', 'Boeing', 'wide', 'Boeing 787-10', 336, 11900, 900, 330, 12.8, 19500),
  t('A359', 'Airbus', 'wide', 'Airbus A350-900', 315, 15000, 900, 320, 12.5, 19000),
  t('A35K', 'Airbus', 'wide', 'Airbus A350-1000', 369, 16100, 900, 365, 14.8, 22000),
  t('B772', 'Boeing', 'wide', 'Boeing 777-200ER', 313, 13000, 900, 230, 16.5, 20000),
  t('B77W', 'Boeing', 'wide', 'Boeing 777-300ER', 396, 13600, 900, 375, 16, 23000),
  t('B779', 'Boeing', 'wide', 'Boeing 777-9', 426, 13500, 900, 440, 16.5, 25000),
  t('B748', 'Boeing', 'wide', 'Boeing 747-8', 410, 14300, 910, 400, 21, 30000),
  t('A388', 'Airbus', 'wide', 'Airbus A380-800', 555, 15000, 900, 445, 25, 35000),
].map((a) => [a.id, a]));
