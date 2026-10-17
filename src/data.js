// Dane statyczne gry: lotniska i typy samolotów.

// [kod IATA, miasto, kraj, szerokość, długość, wielkość rynku 1-10]
const RAW_AIRPORTS = [
  ['WAW', 'Warszawa', 'PL', 52.1657, 20.9671, 7],
  ['KRK', 'Kraków', 'PL', 50.0777, 19.7848, 5],
  ['GDN', 'Gdańsk', 'PL', 54.3776, 18.4662, 4],
  ['WRO', 'Wrocław', 'PL', 51.1027, 16.8858, 4],
  ['KTW', 'Katowice', 'PL', 50.4743, 19.08, 4],
  ['POZ', 'Poznań', 'PL', 52.421, 16.8263, 3],
  ['LHR', 'Londyn', 'GB', 51.47, -0.4543, 10],
  ['CDG', 'Paryż', 'FR', 49.0097, 2.5479, 10],
  ['FRA', 'Frankfurt', 'DE', 50.0379, 8.5622, 9],
  ['AMS', 'Amsterdam', 'NL', 52.3105, 4.7683, 9],
  ['MAD', 'Madryt', 'ES', 40.4983, -3.5676, 8],
  ['BCN', 'Barcelona', 'ES', 41.2974, 2.0833, 8],
  ['FCO', 'Rzym', 'IT', 41.8003, 12.2389, 8],
  ['MXP', 'Mediolan', 'IT', 45.6306, 8.7281, 7],
  ['MUC', 'Monachium', 'DE', 48.3537, 11.775, 8],
  ['BER', 'Berlin', 'DE', 52.3667, 13.5033, 8],
  ['VIE', 'Wiedeń', 'AT', 48.1103, 16.5697, 6],
  ['ZRH', 'Zurych', 'CH', 47.4582, 8.5555, 6],
  ['CPH', 'Kopenhaga', 'DK', 55.618, 12.656, 6],
  ['OSL', 'Oslo', 'NO', 60.1976, 11.1004, 5],
  ['ARN', 'Sztokholm', 'SE', 59.6498, 17.9238, 6],
  ['HEL', 'Helsinki', 'FI', 60.3172, 24.9633, 5],
  ['PRG', 'Praga', 'CZ', 50.1008, 14.26, 5],
  ['BUD', 'Budapeszt', 'HU', 47.4298, 19.2611, 5],
  ['ATH', 'Ateny', 'GR', 37.9364, 23.9445, 6],
  ['IST', 'Stambuł', 'TR', 41.2753, 28.7519, 9],
  ['LIS', 'Lizbona', 'PT', 38.7742, -9.1342, 6],
  ['DUB', 'Dublin', 'IE', 53.4213, -6.2701, 6],
  ['BRU', 'Bruksela', 'BE', 50.901, 4.4844, 6],
  ['KBP', 'Kijów', 'UA', 50.345, 30.8947, 5],
  ['VNO', 'Wilno', 'LT', 54.6341, 25.2858, 3],
  ['RIX', 'Ryga', 'LV', 56.9236, 23.9711, 3],
  ['TLV', 'Tel Awiw', 'IL', 32.0114, 34.8867, 6],
  ['JFK', 'Nowy Jork', 'US', 40.6413, -73.7781, 10],
  ['ORD', 'Chicago', 'US', 41.9742, -87.9073, 9],
  ['LAX', 'Los Angeles', 'US', 33.9416, -118.4085, 9],
  ['ATL', 'Atlanta', 'US', 33.6407, -84.4277, 9],
  ['MIA', 'Miami', 'US', 25.7959, -80.287, 7],
  ['SFO', 'San Francisco', 'US', 37.6213, -122.379, 8],
  ['YYZ', 'Toronto', 'CA', 43.6777, -79.6248, 8],
  ['MEX', 'Meksyk', 'MX', 19.4361, -99.0719, 8],
  ['GRU', 'São Paulo', 'BR', -23.4356, -46.4731, 9],
  ['EZE', 'Buenos Aires', 'AR', -34.8222, -58.5358, 7],
  ['DXB', 'Dubaj', 'AE', 25.2532, 55.3657, 9],
  ['DOH', 'Doha', 'QA', 25.2731, 51.6081, 7],
  ['CAI', 'Kair', 'EG', 30.1219, 31.4056, 8],
  ['JNB', 'Johannesburg', 'ZA', -26.1367, 28.2411, 7],
  ['NBO', 'Nairobi', 'KE', -1.3192, 36.9278, 5],
  ['DEL', 'Delhi', 'IN', 28.5562, 77.1, 9],
  ['BOM', 'Mumbaj', 'IN', 19.0896, 72.8656, 9],
  ['BKK', 'Bangkok', 'TH', 13.69, 100.7501, 8],
  ['SIN', 'Singapur', 'SG', 1.3644, 103.9915, 9],
  ['HKG', 'Hongkong', 'HK', 22.308, 113.9185, 9],
  ['PEK', 'Pekin', 'CN', 40.0799, 116.6031, 10],
  ['PVG', 'Szanghaj', 'CN', 31.1443, 121.8083, 10],
  ['NRT', 'Tokio', 'JP', 35.772, 140.3929, 10],
  ['ICN', 'Seul', 'KR', 37.4602, 126.4407, 9],
  ['SYD', 'Sydney', 'AU', -33.9399, 151.1753, 8],
];

export const AIRPORTS = Object.fromEntries(
  RAW_AIRPORTS.map(([code, city, country, lat, lon, size]) => [code, { code, city, country, lat, lon, size }])
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
