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

const REF_STATIONS = [
  { id: "12510", name: "Śnieżka",       note: "na szlaku, 1602 m" },
  { id: "12500", name: "Jelenia Góra",  note: "dolina, ok. 9 km od Karpacza" },
];

const MODELS = [
  "icon_seamless", "ecmwf_ifs025", "gfs_seamless",
  "meteofrance_seamless", "ukmo_seamless", "jma_seamless",
];
const MODEL_LABEL = {
  icon_seamless: "ICON (DWD)", ecmwf_ifs025: "ECMWF", gfs_seamless: "GFS (NOAA)",
  meteofrance_seamless: "Météo-France", ukmo_seamless: "UKMO", jma_seamless: "JMA",
};
const HOURLY_VARS = [
  "temperature_2m", "apparent_temperature", "dew_point_2m", "precipitation",
  "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "relative_humidity_2m",
];
const DAY_HOURS = [8, 11, 14, 17, 20]; // reprezentatywne godziny szlaku (8:00–20:00)

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmtDate = (d) => d.toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit" });
const round = (n, p = 0) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function cloudBaseAboveGround(t, td) {
  // Wzór Espy'ego: wysokość podstawy chmur konwekcyjnych nad poziomem punktu pomiaru.
  if (t == null || td == null) return null;
  return Math.max(0, 125 * (t - td));
}

function verdict({ windAvg, gustMax, precipSum, fogHours }) {
  let level = 0; // 0 dobre, 1 zmienne, 2 trudne
  if (windAvg >= 20 || gustMax >= 50) level = Math.max(level, 1);
  if (windAvg >= 40 || gustMax >= 70) level = Math.max(level, 2);
  if (precipSum >= 1) level = Math.max(level, 1);
  if (precipSum >= 6) level = Math.max(level, 2);
  if (fogHours >= 1) level = Math.max(level, 1);
  if (fogHours >= 3) level = Math.max(level, 2);
  return ["dobre", "zmienne", "trudne"][level];
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

async function fetchStation(id) {
  const res = await fetch(`https://danepubliczne.imgw.pl/api/data/synop/id/${id}`);
  if (!res.ok) throw new Error(`IMGW ${id}: HTTP ${res.status}`);
  return res.json();
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
    byDate.get(date).push(i);
  });

  const days = [];
  for (const [date, idxs] of byDate) {
    const sample = { temp: [], feels: [], wind: [], gust: [], precip: 0, fogHours: 0, cloud: [], rh: [] };
    let modelSpread = [];
    for (const i of idxs) {
      const perModelTemp = [];
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
        if (p != null) sample.precip += p / MODELS.length;
        if (cc != null) sample.cloud.push(cc);
        if (rh != null) sample.rh.push(rh);
        const base = cloudBaseAboveGround(t, td);
        if (base != null && base < 50) sample.fogHours += 1 / MODELS.length;
      }
      if (perModelTemp.length > 1) {
        modelSpread.push(Math.max(...perModelTemp) - Math.min(...perModelTemp));
      }
    }
    if (!sample.temp.length) continue;
    days.push({
      date,
      tempAvg: round(mean(sample.temp), 1),
      tempMin: round(Math.min(...sample.temp), 1),
      tempMax: round(Math.max(...sample.temp), 1),
      feelsAvg: round(mean(sample.feels), 1),
      windAvg: round(mean(sample.wind), 0),
      gustMax: round(Math.max(...sample.gust), 0),
      precipSum: round(sample.precip, 1),
      cloudAvg: round(mean(sample.cloud), 0),
      rhAvg: round(mean(sample.rh), 0),
      fogHours: round(sample.fogHours, 1),
      spread: modelSpread.length ? round(mean(modelSpread), 1) : null,
      verdict: verdict({
        windAvg: mean(sample.wind), gustMax: Math.max(...sample.gust),
        precipSum: sample.precip, fogHours: sample.fogHours,
      }),
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function spreadLabel(spread) {
  if (spread == null) return { text: "brak danych", cls: "" };
  if (spread < 3) return { text: "modele zgodne", cls: "tight" };
  if (spread < 6) return { text: "modele rozbieżne", cls: "mid" };
  return { text: "modele mocno rozbieżne", cls: "wide" };
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
        <b>${d.temperatura}°C</b>
        <span>wiatr ${d.predkosc_wiatru} m/s</span>
        <span>wilg. ${d.wilgotnosc_wzgledna}%</span>
      </span>
      <span class="station-time">${d.godzina_pomiaru}:00, ${d.data_pomiaru}</span>
    </div>`;
  }).join("");
}

function renderProfile(processed) {
  const w = 800, h = 120, pad = 24;
  const minEle = Math.min(...CHECKPOINTS.map((c) => c.ele));
  const maxEle = Math.max(...CHECKPOINTS.map((c) => c.ele));
  const x = (i) => pad + (i / (CHECKPOINTS.length - 1)) * (w - pad * 2);
  const y = (ele) => h - pad - ((ele - minEle) / (maxEle - minEle)) * (h - pad * 1.6);

  const pts = CHECKPOINTS.map((c, i) => [x(i), y(c.ele)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pad},${h} ${line} ${w - pad},${h}`;

  const dots = CHECKPOINTS.map((c, i) => {
    const [cx, cy] = pts[i];
    return `<g class="profile-pt" data-target="cp-${c.id}" tabindex="0" role="button"
              aria-label="Przewiń do ${c.name}, ${c.ele} m">
      <circle cx="${cx}" cy="${cy}" r="14" fill="transparent"/>
      <circle cx="${cx}" cy="${cy}" r="4"/>
      <text x="${cx}" y="${cy - 10}">${c.ele}</text>
    </g>`;
  }).join("");

  $("#profile").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Profil wysokościowy szlaku">
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

function renderDayTabs(dates, active, onSelect) {
  $("#dayTabs").innerHTML = dates.map((d, i) => {
    const dt = new Date(d + "T12:00:00");
    return `<button class="daytab ${i === active ? "is-active" : ""}" data-i="${i}">
      <span class="daytab-dow">${fmtDate(dt).split(" ")[0]}</span>
      <span class="daytab-date">${fmtDate(dt).split(" ")[1]}</span>
    </button>`;
  }).join("");
  $$(".daytab", $("#dayTabs")).forEach((btn) =>
    btn.addEventListener("click", () => onSelect(Number(btn.dataset.i))));
}

function setActiveDayTab(i) {
  $$(".daytab", $("#dayTabs")).forEach((b, bi) => b.classList.toggle("is-active", bi === i));
}

function kindIcon(kind) {
  return { start: "🥾", finish: "🏁", peak: "⛰️", hut: "🛖", pass: "⛓️", point: "📍" }[kind] || "📍";
}

function renderCheckpoints(perCheckpointDays, dayIndex) {
  const el = $("#checkpoints");
  el.innerHTML = CHECKPOINTS.map((c) => {
    const days = perCheckpointDays[c.id];
    const d = days[Math.min(dayIndex, days.length - 1)];
    if (!d) return "";
    const sp = spreadLabel(d.spread);
    const fog = d.fogHours >= 1 ? `<p class="cp-fog">☁️ we mgle ok. ${d.fogHours}h w ciągu dnia</p>` : "";
    return `<article class="checkpoint" id="cp-${c.id}">
      <header>
        <h3>${kindIcon(c.kind)} ${c.name}</h3>
        <span class="cp-ele">${c.ele} m n.p.m.</span>
      </header>
      <div class="cp-body">
        <div class="cp-temp">
          <b>${d.tempAvg}°C</b>
          <span>${d.tempMin}°–${d.tempMax}°</span>
          <small>odczuwalna ${d.feelsAvg}°C</small>
        </div>
        <div class="cp-verdict verdict--${d.verdict}">${d.verdict}</div>
      </div>
      <div class="cp-stats">
        <span>💨 ${d.windAvg} km/h <small>(porywy ${d.gustMax})</small></span>
        <span>🌧️ ${d.precipSum} mm</span>
        <span>☁️ zachm. ${d.cloudAvg}%</span>
      </div>
      ${fog}
      <p class="cp-spread cp-spread--${sp.cls}">${sp.text}${d.spread != null ? ` (±${d.spread}°C)` : ""}</p>
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
        try { return { ...s, data: await fetchStation(s.id) }; }
        catch (e) { return { ...s, error: e.message }; }
      })),
    ]);

    renderStations(stationResults);
    renderProfile();

    const perCheckpointDays = {};
    CHECKPOINTS.forEach((c, i) => { perCheckpointDays[c.id] = buildDays(ensemble[i].hourly); });

    const dates = perCheckpointDays[CHECKPOINTS[0].id].map((d) => d.date);
    let activeDay = 0;
    const selectDay = (i) => {
      activeDay = i;
      setActiveDayTab(activeDay);
      renderCheckpoints(perCheckpointDays, activeDay);
    };
    renderDayTabs(dates, activeDay, selectDay);
    renderCheckpoints(perCheckpointDays, activeDay);

    status.textContent = "";
    $("#updated").textContent = `Zaktualizowano ${new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (err) {
    status.innerHTML = `Nie udało się pobrać pogody. Sprawdź połączenie i odśwież.<br><small>${err.message}</small>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
