// Pogoda na szlaku Karpacz – Szklarska Poręba (grzbiet Karkonoszy)
// Zero backendu: wszystko liczone w przeglądarce z dwóch darmowych,
// bezkluczowych API z CORS `*` — Open-Meteo (ensemble 6 modeli) i IMGW
// (oficjalne stacje synoptyczne). Patrz README.md w tym katalogu po źródła.

const CHECKPOINTS = [
  { id: "karpacz",    name: "Karpacz",             lat: 50.7773, lon: 15.7461, ele: 671,  kind: "start",  imgw: null },
  { id: "kopa",       name: "Kopa",                 lat: 50.7420, lon: 15.7560, ele: 1414, kind: "peak",   imgw: null },
  { id: "sniezka",    name: "Śnieżka",              lat: 50.7361, lon: 15.7397, ele: 1602, kind: "peak",   imgw: "12510" },
  { id: "domslaski",  name: "Dom Śląski",           lat: 50.7404, lon: 15.7280, ele: 1378, kind: "hut",    imgw: null },
  { id: "slonecznik", name: "Słonecznik",           lat: 50.7597, lon: 15.6834, ele: 1413, kind: "point",  imgw: null },
  { id: "przelecz",   name: "Przełęcz Karkonoska",  lat: 50.7626, lon: 15.6340, ele: 1197, kind: "pass",   imgw: null },
  { id: "kamienie",   name: "Śląskie Kamienie",     lat: 50.7768, lon: 15.6018, ele: 1401, kind: "point",  imgw: null },
  { id: "szrenica",   name: "Szrenica",             lat: 50.7753, lon: 15.5243, ele: 1371, kind: "peak",   imgw: null },
  { id: "szklarska",  name: "Szklarska Poręba",     lat: 50.8286, lon: 15.5222, ele: 686,  kind: "finish", imgw: null },
];

// Dwie sieci stacji IMGW: "synop" (klasyczna, godzinowa) i "meteo"
// (automatyczna, co 10 min, gęstsza, ale część stacji mierzy tylko opad —
// np. Mała Kopa i Szrenica w tej sieci NIE mają czujnika temperatury,
// dlatego nie ma ich tutaj mimo że leżą na szlaku).
const REF_STATIONS = [
  { id: "12510",     kind: "synop", name: "Śnieżka",          note: "na szlaku, 1602 m" },
  { id: "12500",     kind: "synop", name: "Jelenia Góra",     note: "dolina, ok. 9 km od Karpacza" },
  { id: "250150220", kind: "meteo", name: "Karpacz",          note: "miasto, 567 m" },
  { id: "250150150", kind: "meteo", name: "Szklarska Poręba", note: "miasto, 648 m" },
];

const MODELS = [
  "icon_seamless", "ecmwf_ifs025", "gfs_seamless",
  "meteofrance_seamless", "ukmo_seamless", "jma_seamless",
];
const HOURLY_VARS = [
  "temperature_2m", "apparent_temperature", "dew_point_2m", "precipitation",
  "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "relative_humidity_2m",
];
const DAY_HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // co godzinę, 6:00–22:00 (pora szlaku)
// Próg "mokrej" godziny na model. Poniżej tego modele czasem zwracają szum
// zaokrągleniowy (0.05 mm) mimo realnie suchej prognozy -- 0.1 mm to
// standardowy meteorologiczny próg "mierzalnego" opadu.
const WET_HOUR_MM = 0.1;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmtDate = (d) => d.toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit" });
const round = (n, p = 0) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function cloudBaseAboveGround(t, td) {
  // Wzór Espy'ego: wysokość podstawy chmur konwekcyjnych nad poziomem punktu pomiaru.
  if (t == null || td == null) return null;
  return Math.max(0, 125 * (t - td));
}

// Zamiast abstrakcyjnej etykiety (dawniej "dobre/zmienne/trudne", niejasne
// bez kontekstu) zwraca KONKRETNY powod: liczbe i jednostke, ktora
// przekroczyla prog. Poziom (0/1/2) steruje tylko kolorem, tekst zawsze
// mowi wprost co sie dzieje -- nie trzeba znac skali, zeby to zrozumiec.
function assess({ windAvg, gustMax, precipSum, fogHours }) {
  const reasons = [];
  if (gustMax >= 70) reasons.push({ level: 2, text: `porywy ${round(gustMax)} km/h` });
  else if (windAvg >= 40) reasons.push({ level: 2, text: `wiatr ${round(windAvg)} km/h` });
  else if (gustMax >= 50) reasons.push({ level: 1, text: `porywy ${round(gustMax)} km/h` });
  else if (windAvg >= 20) reasons.push({ level: 1, text: `wiatr ${round(windAvg)} km/h` });

  if (precipSum >= 6) reasons.push({ level: 2, text: `opad ${round(precipSum, 1)} mm` });
  else if (precipSum >= 1) reasons.push({ level: 1, text: `opad ${round(precipSum, 1)} mm` });

  if (fogHours >= 3) reasons.push({ level: 2, text: `mgła ${round(fogHours, 1)} h` });
  else if (fogHours >= 1) reasons.push({ level: 1, text: `mgła ${round(fogHours, 1)} h` });

  if (!reasons.length) return { level: 0, label: "Spokojnie", detail: null };
  const level = Math.max(...reasons.map((r) => r.level));
  return { level, label: level === 2 ? "Ryzyko" : "Uwaga", detail: reasons.map((r) => r.text).join(" · ") };
}

// Odznaka na karcie dnia (daytab) -- sygnał ZANIM ktoś w ogóle otworzy dany
// dzień, że warto się przygotować na deszcz. Mediana rainMajorityHours po
// wszystkich 9 checkpointach (odporna na jeden odstający punkt na grzbiecie,
// ten sam wzorzec co tempMedian). Progi skalibrowane na rzeczywistej
// prognozie z sierpnia 2026: dzień z rozrzuconym niepewnym opadem (0 godzin
// z większością modeli) nie dostaje odznaki; dzień z krótką ale intensywną
// ulewą (mediana 5h) i dzień z długim, umiarkowanym opadem (mediana 9h) --
// oba realnie warte ostrzeżenia -- dostają, w dwóch poziomach.
function dayRainBadge(perCheckpointDays, dayIndex) {
  const hours = CHECKPOINTS.map((c) => {
    const days = perCheckpointDays[c.id];
    return days[Math.min(dayIndex, days.length - 1)]?.rainMajorityHours;
  }).filter((v) => v != null);
  if (!hours.length) return null;
  const h = median(hours);
  if (h >= 8) return { level: 2, hours: Math.round(h) };
  if (h >= 4) return { level: 1, hours: Math.round(h) };
  return null;
}

async function fetchEnsemble() {
  const lat = CHECKPOINTS.map((c) => c.lat).join(",");
  const lon = CHECKPOINTS.map((c) => c.lon).join(",");
  const ele = CHECKPOINTS.map((c) => c.ele).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&elevation=${ele}&hourly=${HOURLY_VARS.join(",")}&models=${MODELS.join(",")}` +
    `&forecast_days=7&timezone=Europe%2FWarsaw`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

// Normalizuje dwa różne kształty odpowiedzi IMGW (synop vs. meteo) do
// jednego wspólnego kształtu, żeby renderStations nie musiał znać różnicy.
function normalizeStation(kind, raw) {
  if (kind === "meteo") {
    if (raw.temperatura_powietrza == null) throw new Error("stacja bez czujnika temp.");
    const [date, time] = (raw.temperatura_powietrza_data || "").split(" ");
    return {
      temp: round(Number(raw.temperatura_powietrza), 1),
      wind: raw.wiatr_srednia_predkosc != null ? round(Number(raw.wiatr_srednia_predkosc), 1) : null,
      humidity: raw.wilgotnosc_wzgledna != null ? round(Number(raw.wilgotnosc_wzgledna), 0) : null,
      time: time ? time.slice(0, 5) : "?",
      date: date || "?",
    };
  }
  return {
    temp: Number(raw.temperatura),
    wind: Number(raw.predkosc_wiatru),
    humidity: Number(raw.wilgotnosc_wzgledna),
    time: `${raw.godzina_pomiaru}:00`,
    date: raw.data_pomiaru,
  };
}

async function fetchStation(s) {
  const url = s.kind === "meteo"
    ? `https://danepubliczne.imgw.pl/api/data/meteo/id/${s.id}`
    : `https://danepubliczne.imgw.pl/api/data/synop/id/${s.id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IMGW ${s.id}: HTTP ${res.status}`);
  const json = await res.json();
  const raw = Array.isArray(json) ? json[0] : json;
  if (!raw) throw new Error("brak odpowiedzi");
  return normalizeStation(s.kind, raw);
}

// Przetwarza surową odpowiedź jednej lokalizacji na dni z uśrednionym ensemble.
function buildDays(hourly) {
  const times = hourly.time;
  const byDate = new Map();
  times.forEach((t, i) => {
    const [date, time] = t.split("T");
    const hour = Number(time.slice(0, 2));
    if (!DAY_HOURS.includes(hour)) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ i, hour });
  });

  const days = [];
  for (const [date, idxs] of byDate) {
    const sample = { temp: [], feels: [], wind: [], gust: [], precip: 0, fogHours: 0, cloud: [], rh: [] };
    let modelSpread = [];
    const hourRows = [];
    for (const { i, hour } of idxs) {
      const perModelTemp = [];
      const perModelPrecip = [];
      for (const m of MODELS) {
        const t = hourly[`temperature_2m_${m}`]?.[i];
        const at = hourly[`apparent_temperature_${m}`]?.[i];
        const td = hourly[`dew_point_2m_${m}`]?.[i];
        const w = hourly[`wind_speed_10m_${m}`]?.[i];
        const g = hourly[`wind_gusts_10m_${m}`]?.[i];
        const p = hourly[`precipitation_${m}`]?.[i];
        const cc = hourly[`cloud_cover_${m}`]?.[i];
        const rh = hourly[`relative_humidity_2m_${m}`]?.[i];
        if (t != null) { sample.temp.push(t); perModelTemp.push(t); }
        if (at != null) sample.feels.push(at);
        if (w != null) sample.wind.push(w);
        if (g != null) sample.gust.push(g);
        if (p != null) { sample.precip += p / MODELS.length; perModelPrecip.push(p); }
        if (cc != null) sample.cloud.push(cc);
        if (rh != null) sample.rh.push(rh);
        const base = cloudBaseAboveGround(t, td);
        if (base != null && base < 50) sample.fogHours += 1 / MODELS.length;
      }
      if (perModelTemp.length > 1) {
        modelSpread.push(Math.max(...perModelTemp) - Math.min(...perModelTemp));
      }
      // Konsensus deszczu = ile z 6 modeli zgadza się, że ta godzina będzie
      // mokra (nie ile spadnie -- to już jest w opadzie dziennym w cp-stats).
      // Ważne przy szlaku: jedna godzina "4/6 modeli" mówi więcej niż suma
      // opadu z całego dnia, bo "kiedy" jest równie ważne co "ile".
      let wetModels = 0;
      if (perModelPrecip.length) {
        wetModels = perModelPrecip.filter((v) => v > WET_HOUR_MM).length;
      }
      if (perModelTemp.length) {
        hourRows.push({
          hour,
          temp: round(mean(perModelTemp), 1),
          wetModels,
          modelCount: perModelPrecip.length,
          precipProb: perModelPrecip.length ? round(wetModels / perModelPrecip.length, 2) : null,
          // 2 miejsca po przecinku, nie 1 -- przy niskiej zgodności (np. 1/6
          // modeli) średnia po wszystkich 6 bywa < 0.05mm i przy zaokrągleniu
          // do 1 miejsca pokazywałaby mylące "0 mm" tuż obok "1/6 modeli".
          precipMean: perModelPrecip.length ? round(mean(perModelPrecip), 2) : null,
        });
      }
    }
    if (!sample.temp.length) continue;
    // Godziny, w których WIĘKSZOŚĆ modeli (≥3/6) zgadza się na opad -- surowszy
    // próg niż "przynajmniej jeden model" (wetModels>0) użyty w .hr-chip, bo
    // to zasila odznakę dnia na daytabie: ma znaczyć "naprawdę będzie padać",
    // nie "jeden model coś tam podejrzewa". Użyte w dayRainBadge() niżej.
    const rainMajorityHours = hourRows.filter((h) => h.modelCount && h.wetModels / h.modelCount >= 0.5).length;
    days.push({
      date,
      rainMajorityHours,
      // Mediana zamiast średniej dla nagłówkowej liczby na wykresie profilu:
      // odporna na pojedynczą godzinę/model odstający od reszty (np. jeden
      // model przewidujący nagły upał o 14:00), lepiej oddaje "typową"
      // temperaturę dnia niż średnia. Liczona z tej samej populacji co
      // tempMin/tempMax (wszystkie odczyty model×godzina), więc min ≤
      // mediana ≤ max pozostaje spójne.
      tempMedian: round(median(sample.temp), 1),
      tempMin: round(Math.min(...sample.temp), 1),
      tempMax: round(Math.max(...sample.temp), 1),
      hourly: hourRows.sort((a, b) => a.hour - b.hour),
      feelsAvg: round(mean(sample.feels), 1),
      windAvg: round(mean(sample.wind), 0),
      gustMax: round(Math.max(...sample.gust), 0),
      precipSum: round(sample.precip, 1),
      cloudAvg: round(mean(sample.cloud), 0),
      rhAvg: round(mean(sample.rh), 0),
      fogHours: round(sample.fogHours, 1),
      spread: modelSpread.length ? round(mean(modelSpread), 1) : null,
      assess: assess({
        windAvg: mean(sample.wind), gustMax: Math.max(...sample.gust),
        precipSum: sample.precip, fogHours: sample.fogHours,
      }),
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// Widoczne tylko gdy modele faktycznie się kłócą (>=3°C) — przy zgodnych
// modelach to nieinformacyjny szum powtórzony na każdej z 9 kart.
function spreadNote(spread) {
  if (spread == null || spread < 3) return null;
  const wide = spread >= 6;
  return { text: `${wide ? "modele mocno się różnią" : "modele się różnią"} (±${spread}°C)`, cls: wide ? "wide" : "mid" };
}

function tempColor(t) {
  if (t == null) return "var(--muted)";
  return t <= 6 ? "var(--cold)" : "var(--ink)";
}

const LEVEL_VAR = ["var(--good)", "var(--warn)", "var(--bad)"];

const ICONS = {
  start: '<path d="M4 15V3"/><path d="M4 4h7l-2 2.5L11 9H4"/>',
  finish: '<path d="M4 15V3"/><path d="M4 4h8v6H4z"/><path d="M4 7h8M7 4v6M10 4v6" stroke-width="1"/>',
  peak: '<path d="M2 14L7 5l2 3.2L11.5 5.5 16 14z"/>',
  hut: '<path d="M3 9l6-5.5L15 9"/><path d="M4.5 8v6.5h9V8"/>',
  pass: '<path d="M1.5 12L5 6l2 3 2-4.5 2 4.5 2-3 3.5 6"/>',
  point: '<circle cx="9" cy="9" r="2.6" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="6.2" stroke-dasharray="2 2.4"/>',
};
function kindIcon(kind) {
  return `<svg class="cp-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind] || ICONS.point}</svg>`;
}

function renderStations(stations) {
  const el = $("#stations");
  el.innerHTML = stations.map((s) => {
    if (s.error) {
      return `<div class="station station--err"><span class="station-name">${s.name}</span><span class="station-err">brak danych (${s.error})</span></div>`;
    }
    const d = s.data;
    return `<div class="station">
      <span class="station-name">${s.name}<small>${s.note}</small></span>
      <span class="station-read">
        <b>${d.temp}°C</b>
        <span>wiatr ${d.wind} m/s</span>
        <span>wilg. ${d.humidity}%</span>
      </span>
      <span class="station-time">${d.time}, ${d.date}</span>
    </div>`;
  }).join("");
}

// Profil grzbietu jako WYKRES, nie tylko mapa nawigacji: kolor kropki =
// poziom ryzyka danego dnia, duza liczba nad kropka = temperatura (nie
// wysokosc), wysokosc zostaje jako mala, druga linia podpisu.
function renderProfile(perCheckpointDays, dayIndex) {
  // h podniesione z 168 na 182 -- druga linia podpisu (godziny deszczu pod
  // wysokością) potrzebuje własnego miejsca, nie mieści się bez zderzenia
  // z etykietą wysokości. Strona jest mobile-first bez hovera (telefon), więc
  // to MUSI być zawsze widoczny tekst, nie tylko <title>/tooltip.
  const w = 800, h = 182, pad = 26;
  const minEle = Math.min(...CHECKPOINTS.map((c) => c.ele));
  const maxEle = Math.max(...CHECKPOINTS.map((c) => c.ele));
  const x = (i) => pad + (i / (CHECKPOINTS.length - 1)) * (w - pad * 2);
  const y = (ele) => h - 52 - ((ele - minEle) / (maxEle - minEle)) * (h - 52 - pad);

  const pts = CHECKPOINTS.map((c, i) => [x(i), y(c.ele)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pad},${h - 52} ${line} ${w - pad},${h - 52}`;

  const dots = CHECKPOINTS.map((c, i) => {
    const days = perCheckpointDays[c.id];
    const d = days[Math.min(dayIndex, days.length - 1)];
    const [cx, cy] = pts[i];
    const dotColor = d ? LEVEL_VAR[d.assess.level] : "var(--muted)";
    const tColor = d ? tempColor(d.tempMedian) : "var(--muted)";
    // Godziny (z 17, 6–22) z większością modeli (≥3/6) zgadzającą się na
    // opad -- ta sama metryka co odznaka na daytabie, ale tu lokalnie dla
    // TEGO punktu na grzbiecie, nie mediana po wszystkich 9. Pokazane tylko
    // gdy >0, żeby suche punkty nie dostawały pustej niebieskiej liczby.
    const rainH = d?.rainMajorityHours;
    // Sam tekst "Xh", bez slowa "deszcz" -- SVG skaluje sie do 100% szerokosci
    // kontenera (preserveAspectRatio="none"), wiec na waskim telefonie
    // (~390px vs viewBox 800) kazda jednostka viewBox to ok. 0.46px realnego
    // ekranu. Krotszy tekst = mozna podbic font-size bez ryzyka zderzenia
    // z sasiednim punktem (9 punktow na 800 jednostek = ~93 jedn. odstepu).
    const rainLabel = rainH > 0
      ? `<text x="${cx}" y="${h - 16}" class="profile-rain">${rainH}h</text>`
      : "";
    const rainAria = rainH > 0 ? `, deszcz ${rainH} z 17 godz.` : "";
    return `<g class="profile-pt" data-target="cp-${c.id}" tabindex="0" role="button"
              aria-label="Przewiń do ${c.name}, ${c.ele} m, ${d ? d.tempMedian + '°C, mediana z godz. 6–22' + rainAria : 'brak danych'}">
      <title>${c.name}: ${d ? d.tempMedian + '°C (mediana z godz. 6–22, 6 modeli)' + rainAria : 'brak danych'}</title>
      <circle cx="${cx}" cy="${cy}" r="16" fill="transparent"/>
      <text x="${cx}" y="${cy - 12}" class="profile-temp" fill="${tColor}">${d ? d.tempMedian + "°" : "—"}</text>
      <circle cx="${cx}" cy="${cy}" r="5" fill="${dotColor}" stroke="var(--bg)" stroke-width="1.5"/>
      <text x="${cx}" y="${h - 30}" class="profile-ele">${c.ele} m</text>
      ${rainLabel}
    </g>`;
  }).join("");

  $("#profile").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Profil wysokościowy szlaku z medianą temperatury i konsensusem deszczu">
      <polygon class="profile-area" points="${area}"/>
      <polyline class="profile-line" points="${line}"/>
      ${dots}
    </svg>`;

  $$(".profile-pt", $("#profile")).forEach((g) => {
    const jump = () => document.getElementById(g.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "center" });
    g.addEventListener("click", jump);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); } });
  });
}

function renderDayTabs(dates, active, onSelect, rainBadges = []) {
  $("#dayTabs").innerHTML = dates.map((d, i) => {
    const dt = new Date(d + "T12:00:00");
    const b = rainBadges[i];
    // Widoczne od razu w pasku dni, zanim ktoś kliknie -- nie trzeba wchodzić
    // w każdy dzień z osobna, żeby zauważyć "tu będzie lało". Konkretna
    // liczba godzin, nie samo słowo "deszcz" -- ten sam wzorzec co assess().
    const badge = b
      ? `<span class="daytab-rain daytab-rain--${b.level}" title="Mediana ${b.hours} z 17 godz. (6:00–22:00) z większością modeli (≥3/6) zgadzającą się na opad">deszcz ${b.hours}h</span>`
      : "";
    return `<button class="daytab ${i === active ? "is-active" : ""}" data-i="${i}">
      <span class="daytab-dow">${fmtDate(dt).split(" ")[0]}</span>
      <span class="daytab-date">${fmtDate(dt).split(" ")[1]}</span>
      ${badge}
    </button>`;
  }).join("");
  $$(".daytab", $("#dayTabs")).forEach((btn) =>
    btn.addEventListener("click", () => onSelect(Number(btn.dataset.i))));
}

function setActiveDayTab(i) {
  $$(".daytab", $("#dayTabs")).forEach((b, bi) => b.classList.toggle("is-active", bi === i));
}

// Jedno zdanie na górze — odpowiedź bez scrollowania przez 9 kart.
function renderSummary(perCheckpointDays, dayIndex) {
  const rows = CHECKPOINTS.map((c) => {
    const days = perCheckpointDays[c.id];
    return { c, d: days[Math.min(dayIndex, days.length - 1)] };
  }).filter((r) => r.d);
  if (!rows.length) return;

  const tMin = Math.min(...rows.map((r) => r.d.tempMin));
  const tMax = Math.max(...rows.map((r) => r.d.tempMax));
  const gustMax = Math.max(...rows.map((r) => r.d.gustMax));
  const worst = rows.reduce((a, b) => (b.d.assess.level > a.d.assess.level ? b : a));

  const tail = worst.d.assess.level === 0
    ? "Na całym grzbiecie spokojnie."
    : `${worst.d.assess.label} przy ${worst.c.name}: ${worst.d.assess.detail}.`;

  $("#daySummary").textContent = `Grzbiet: ${tMin}–${tMax}°C, porywy do ${gustMax} km/h. ${tail}`;
}

function renderCheckpoints(perCheckpointDays, dayIndex) {
  const el = $("#checkpoints");
  el.innerHTML = CHECKPOINTS.map((c) => {
    const days = perCheckpointDays[c.id];
    const d = days[Math.min(dayIndex, days.length - 1)];
    if (!d) return "";
    const sn = spreadNote(d.spread);
    const badgeText = d.assess.level === 0 ? d.assess.label : `${d.assess.label}: ${d.assess.detail}`;
    return `<article class="checkpoint" id="cp-${c.id}">
      <header>
        <h3>${kindIcon(c.kind)} ${c.name}</h3>
        <span class="cp-ele">${c.ele} m n.p.m.</span>
      </header>
      <div class="cp-body">
        <div class="cp-temp">
          <div class="cp-hourly-wrap">
            <div class="cp-hourly">
              ${d.hourly.map((h) => {
                const rainPct = h.precipProb != null ? Math.round(h.precipProb * 100) : null;
                // Floor podniesiony z 0.35 na 0.6 -- pierwsza wersja (0.35, w
                // 10px szaroniebieskim tekscie) okazala sie w praniu praktycznie
                // niewidoczna nawet przy realnym sygnale (zgloszenie: "nie widze
                // godzinowych informacji o deszczu"). 6/6 modeli nadal wybija sie
                // pelna kryjacoscia, ale roznica miedzy "slabym" a "silnym"
                // sygnalem juz nie schodzi ponizej progu czytelnosci.
                // Suche godziny (0%) nie rezerwuja miejsca -- reszta chipa
                // zostaje wyrownana do gornej krawedzi (align-items:center w .hr-chip).
                const rainOpacity = rainPct ? Math.max(0.6, h.precipProb) : 0;
                const rainTitle = rainPct
                  ? `deszcz: ${h.wetModels}/${h.modelCount} modeli, śr. ${h.precipMean} mm`
                  : "deszcz: brak sygnału w modelach";
                return `<div class="hr-chip" title="${h.hour}:00 · ${h.temp}°C · ${rainTitle}">
                <b style="color:${tempColor(h.temp)}">${h.temp}°</b>
                <span class="hr-rain" style="opacity:${rainOpacity}">${rainPct ? rainPct + "%" : ""}</span>
                <small>${h.hour}</small>
              </div>`;
              }).join("")}
            </div>
          </div>
          <div class="cp-temp-meta">
            <span>${d.tempMin}°–${d.tempMax}° w ciągu dnia</span>
            <small>odczuwalna śr. ${d.feelsAvg}°C</small>
          </div>
        </div>
        <div class="cp-badge cp-badge--${d.assess.level}">${badgeText}</div>
      </div>
      <div class="cp-stats">
        <span>wiatr ${d.windAvg} km/h <small>(porywy ${d.gustMax})</small></span>
        <span>opad ${d.precipSum} mm</span>
        <span>zachm. ${d.cloudAvg}%</span>
      </div>
      ${sn ? `<p class="cp-spread cp-spread--${sn.cls}">${sn.text}</p>` : ""}
    </article>`;
  }).join("");
}

async function init() {
  const status = $("#status");
  try {
    status.textContent = "Pobieram dane pogodowe…";
    const [ensemble, stationResults] = await Promise.all([
      fetchEnsemble(),
      Promise.all(REF_STATIONS.map(async (s) => {
        try { return { ...s, data: await fetchStation(s) }; }
        catch (e) { return { ...s, error: e.message }; }
      })),
    ]);

    renderStations(stationResults);

    const perCheckpointDays = {};
    CHECKPOINTS.forEach((c, i) => { perCheckpointDays[c.id] = buildDays(ensemble[i].hourly); });

    const dates = perCheckpointDays[CHECKPOINTS[0].id].map((d) => d.date);
    const rainBadges = dates.map((_, i) => dayRainBadge(perCheckpointDays, i));
    let activeDay = 0;
    const selectDay = (i) => {
      activeDay = i;
      setActiveDayTab(activeDay);
      renderProfile(perCheckpointDays, activeDay);
      renderSummary(perCheckpointDays, activeDay);
      renderCheckpoints(perCheckpointDays, activeDay);
    };
    renderDayTabs(dates, activeDay, selectDay, rainBadges);
    selectDay(activeDay);

    status.textContent = "";
    $("#updated").textContent = `Zaktualizowano ${new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (err) {
    status.innerHTML = `Nie udało się pobrać pogody. Sprawdź połączenie i odśwież.<br><small>${err.message}</small>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
