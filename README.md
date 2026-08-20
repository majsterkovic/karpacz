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
- **IMGW-PIB** — dwie sieci, oba `Access-Control-Allow-Origin: *`, bez klucza:
  - `api/data/synop/id/<id>` (klasyczna, godzinowa): **Śnieżka** (12510,
    1602 m, leży dokładnie na szlaku) i **Jelenia Góra** (12500, dolina,
    referencja dla strony Karpacza).
  - `api/data/meteo/id/<kod>` (automatyczna, co 10 min, gęstsza sieć):
    dokłada **Karpacz** (250150220, 567 m) i **Szklarska Poręba**
    (250150150, 648 m). W tej samej sieci są też stacje bliżej grzbietu
    (Mała Kopa, Szrenica), ale **nie mają czujnika temperatury** — mierzą
    tylko opad, więc świadomie ich tu nie ma.
  - Reszta 7 punktów na grzbiecie nie ma żadnej publicznej stacji z
    darmowym API — stąd ensemble modeli jako jedyne źródło dla nich.

Konsekwencja: serwer (`nginx:alpine`) serwuje wyłącznie pliki statyczne.
Żadnych kluczy, żadnego stanu, żadnego procesu aplikacyjnego do utrzymania.

## Metodologia

- **Próbka dnia**: co godzinę, 6–22 (pora, w której ktoś realnie jest na
  szlaku). Każda karta checkpointu pokazuje pasek ze wszystkimi 17
  godzinami, nie jedną uśrednioną liczbę — łatwiej zobaczyć np. "zimno
  o 8:00, ciepło o 15:00". Suma opadu, zachmurzenie i zakres min–max to
  wciąż agregaty z tego okna, nie z całej doby — zaznaczone wprost w UI.
- **Wykres profilu wysokościowego**: duża liczba nad każdym punktem to
  **mediana**, nie średnia, wszystkich odczytów temperatury (6 modeli ×
  17 godzin, 6–22) tego dnia — odporna na pojedynczą godzinę/model
  odstający od reszty. Podpisane wprost nad wykresem, żeby nie trzeba
  było najeżdżać na kropkę po tooltip.
- **Werdykt (dobre/zmienne/trudne)**: prosty próg na wietrze średnim,
  porywach, opadzie i godzinach mgły — patrz `verdict()` w `app.js`.
  Mgła = podstawa chmur (wzór Espy'ego, `125 × (T − Td)`) niżej niż
  wysokość punktu.
- **Rozrzut modeli**: różnica maks.–min. temperatury między 6 modelami w
  danym dniu. Mały rozrzut = modele się zgadzają = prognoza pewniejsza;
  duży = warto sprawdzić bliżej terminu.
- **Konsensus deszczu**: pod każdą godzinną temperaturą procent modeli,
  które przewidują tam mierzalny opad (próg 0.1 mm/h — poniżej tego
  modele czasem zwracają szum zaokrągleniowy mimo realnie suchej
  prognozy). To **zgoda między modelami co do "kiedy"**, nie suma opadu —
  ta druga wciąż jest w `cp-stats` jako agregat dzienny. Świadomie osobno:
  "4/6 modeli zgadza się, że o 14:00 będzie mokro" mówi coś innego niż
  "dziś spadnie 3 mm", zwłaszcza przy planowaniu, kiedy wyjść na szlak.
- **Odznaka deszczu na karcie dnia** (`daytab`): widoczna w pasku wyboru
  dnia, zanim jeszcze się w niego wejdzie. Liczy godziny (z 17, 6–22),
  w których **większość** modeli (≥3/6, surowszy próg niż "przynajmniej
  jeden" użyty w godzinnym pasku) zgadza się na opad — mediana po
  wszystkich 9 checkpointach. ≥4h → "Uwaga", ≥8h → "Ryzyko". Progi
  skalibrowane na realnej prognozie: dzień z rozrzuconym, niepewnym
  opadem (0 godzin z większością) nie dostaje odznaki, żeby nie
  spowszedniała.
- **Deszcz na profilu wysokościowym**: pod wysokością każdego punktu (gdy
  jest sygnał) suma opadu w mm — ta sama wielkość i jednostka co "opad X mm"
  już widoczna niżej w każdej karcie checkpointu, więc nie trzeba się uczyć
  nowego pojęcia. Pierwsza wersja pokazywała liczbę godzin z większością
  modeli zgadzającą się na opad (`5h`) zamiast mm, ale to wymagało czytania
  legendy, żeby wiedzieć, co znaczy sama liczba — mm mówi to wprost.
  Widoczność etykiety wciąż bramkowana progiem "większości modeli" (≥3/6,
  ten sam co odznaka na karcie dnia), nie samym `precipSum>0`, bo nawet
  "suche" dni mają ~0.3–0.5 mm szumu zaokrągleniowego, co pokazywałoby
  etykietę prawie zawsze i unieważniało jej sens. Wybierając kolejne dni w
  zakładkach od razu widać, gdzie na trasie i ile ma spaść, bez najeżdżania
  na kropkę. Krótki tekst (`14.9mm`) był też celowy ze względów SVG: przy
  szerokości viewBoksu skalowanej do ekranu telefonu dłuższy tekst wymuszałby
  mniejszą czcionkę, nieczytelną (ten sam problem widoczności co niżej
  opisany konsensus godzinowy, tylko w kontekście SVG zamiast HTML-owego
  tekstu).

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

DNS: `karpacz.hybiak.eu` był już pokryty istniejącym wildcardem `*.hybiak.eu`,
więc żaden ręczny krok w Cloudflare nie był finalnie potrzebny.

**Cache po stronie Cloudflare**: `app.js`/`style.css` są cache'owane na
brzegu Cloudflare (domyślna reguła dla rozszerzeń .js/.css, ~4h TTL),
podczas gdy `index.html` jest zawsze `DYNAMIC` (bez cache'a). Efekt: po
deployu origin ma już nową wersję, ale odwiedzający mogą dostać starą
z cache'a aż do wygaśnięcia TTL. Rozwiązanie: `index.html` linkuje pliki
z wersjonowanym query stringiem (`app.js?v=2`) — zmiana tej liczby przy
każdym deployu, który dotyka `app.js`/`style.css`, wymusza nowy klucz
cache'a i nową treść od razu, bez czekania i bez potrzeby ręcznego
purge'a w panelu Cloudflare.
