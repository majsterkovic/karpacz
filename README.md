# karpacz — pogoda na szlaku Karpacz ↔ Szklarska Poręba

Statyczna strona (bez backendu) pokazująca pogodę dla 9 punktów na
grzbietowym, czerwonym szlaku Karkonoszy. Wdrożona pod `karpacz.hybiak.eu`.

## Dlaczego bez backendu

Obie API użyte tutaj mają `Access-Control-Allow-Origin: *` i nie wymagają
klucza, więc przeglądarka pyta je bezpośrednio:

- **Open-Meteo** (`api.open-meteo.com/v1/forecast`) — prognoza z 6
  niezależnych modeli (ICON/DWD, ECMWF, GFS/NOAA, Météo-France, UKMO, JMA)
  w jednym zapytaniu dla wszystkich 9 punktów naraz (~450 KB, <1 s).
  Parametr `elevation` jest **wymagany** dla każdego punktu — bez niego API
  liczy pogodę dla uśrednionej wysokości komórki siatki (~90 m rozdzielczość
  terenu), co dla stromego grzbietu zaniża wiatr i zawyża temperaturę o kilka
  stopni. Wysokości w `CHECKPOINTS` w `app.js` są zweryfikowane przez
  `api.open-meteo.com/v1/elevation` (model terenu Copernicus DEM).
- **IMGW-PIB** (`danepubliczne.imgw.pl/api/data/synop/id/<id>`) — oficjalne
  odczyty ze stacji synoptycznych. W Karkonoszach są tylko dwie:
  **Śnieżka** (12510, 1602 m, leży dokładnie na szlaku) i **Jelenia Góra**
  (12500, dolina, referencja dla strony Karpacza). Reszta grzbietu nie ma
  żadnej publicznej stacji z darmowym API — stąd ensemble modeli jako
  jedyne źródło dla pozostałych 7 punktów.

Konsekwencja: serwer (`nginx:alpine`) serwuje wyłącznie pliki statyczne.
Żadnych kluczy, żadnego stanu, żadnego procesu aplikacyjnego do utrzymania.

## Metodologia

- **Próbka dnia**: godziny 8–20 (pora, w której ktoś realnie jest na
  szlaku). Suma opadu i zachmurzenie to średnie/sumy z tych godzin, nie
  z całej doby — zaznaczone wprost w UI.
- **Werdykt (dobre/zmienne/trudne)**: prosty próg na wietrze średnim,
  porywach, opadzie i godzinach mgły — patrz `verdict()` w `app.js`.
  Mgła = podstawa chmur (wzór Espy'ego, `125 × (T − Td)`) niżej niż
  wysokość punktu.
- **Rozrzut modeli**: różnica maks.–min. temperatury między 6 modelami w
  danym dniu. Mały rozrzut = modele się zgadzają = prognoza pewniejsza;
  duży = warto sprawdzić bliżej terminu.

## Punkty kontrolne

Współrzędne zweryfikowane przez Nominatim (OSM) i skorygowane pod
najbliższe lokalne maksimum wysokości siatką punktów, bo nazwy szczytów w
OSM czasem wskazują punkt kilkaset metrów od faktycznego wierzchołka
(dotyczyło to Kopy i Szrenicy w pierwszej wersji).

## Wdrożenie

To repo **buduje i publikuje tylko obraz** (`ghcr.io/majsterkovic/karpacz`,
publiczny — zero sekretów w środku, więc nie ma czego chronić) przy
każdym pushu na `master`. Nie ma tu żadnego dostępu do VPS-a.

Faktyczny deploy (kontener, sieć, routing) żyje w osobnym, prywatnym repo
`infra`:
- `docker-compose.yml` → serwis `karpacz`, `image: ghcr.io/majsterkovic/karpacz:latest`,
  sieć `edge`, zero publikowanych portów.
- `cloudflared/config.yml` → `karpacz.hybiak.eu` → `http://karpacz:80`.

Kolejność publikacji zmiany: push tutaj (buduje `:latest`) → uruchom deploy
w `infra` (pull + recreate na VPS-ie).

**Wymaga jednorazowego ręcznego kroku** (nie do zautomatyzowania stąd):
rekord DNS w Cloudflare dla `karpacz.hybiak.eu` — CNAME na tunel z `infra`.
