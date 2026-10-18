// The city's colours change with the sun's height above the horizon (in degrees).
// Each keyframe is a look; we blend smoothly between neighbours.

const KEYFRAMES = [
  {
    alt: -18, // deep night
    sky: "#05061a",
    horizon: "#1b1248",
    fog: "#120b2c",
    land: "#0a0c1e",
    water: "#0b3550",
    park: "#0b2629",
    buildingLow: "#17163a",
    buildingHigh: "#3b2f7d",
    glow: "#ffb347",
    core: "#ffd98a",
    glowOpacity: 0.5,
    light: "#9d8cff",
    lightIntensity: 0.45,
  },
  {
    alt: -6, // twilight
    sky: "#16134a",
    horizon: "#7b3a8e",
    fog: "#43256b",
    land: "#12112a",
    water: "#124d68",
    park: "#102f2e",
    buildingLow: "#241f4e",
    buildingHigh: "#5b3f93",
    glow: "#ffb347",
    core: "#ffd98a",
    glowOpacity: 0.45,
    light: "#c0a0ff",
    lightIntensity: 0.5,
  },
  {
    alt: 0, // sunrise / sunset
    sky: "#2c2570",
    horizon: "#ff8a5c",
    fog: "#b85a7c",
    land: "#1b1838",
    water: "#1d6579",
    park: "#18392f",
    buildingLow: "#31295a",
    buildingHigh: "#8a5a9c",
    glow: "#ffc36b",
    core: "#ffe3a3",
    glowOpacity: 0.35,
    light: "#ffb48a",
    lightIntensity: 0.55,
  },
  {
    alt: 8, // golden hour
    sky: "#5877cc",
    horizon: "#ffd3a1",
    fog: "#e8b5a2",
    land: "#272646",
    water: "#277a8c",
    park: "#244636",
    buildingLow: "#47396a",
    buildingHigh: "#b78aa9",
    glow: "#ffcf8a",
    core: "#fff0c2",
    glowOpacity: 0.25,
    light: "#ffe1b9",
    lightIntensity: 0.6,
  },
  {
    alt: 25, // daylight
    sky: "#7fb0e6",
    horizon: "#e6eff6",
    fog: "#d3e2ee",
    land: "#39435f",
    water: "#3d97ae",
    park: "#3b6850",
    buildingLow: "#535e89",
    buildingHigh: "#a2aad0",
    glow: "#fff1cc",
    core: "#ffffff",
    glowOpacity: 0.12,
    light: "#ffffff",
    lightIntensity: 0.7,
  },
];

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function mix(a, b, t) {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

export function paletteFor(altitudeDeg) {
  const first = KEYFRAMES[0];
  const last = KEYFRAMES[KEYFRAMES.length - 1];
  if (altitudeDeg <= first.alt) return first;
  if (altitudeDeg >= last.alt) return last;

  let i = 0;
  while (altitudeDeg > KEYFRAMES[i + 1].alt) i++;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[i + 1];
  const t = (altitudeDeg - a.alt) / (b.alt - a.alt);

  const out = {};
  for (const key of Object.keys(a)) {
    out[key] =
      typeof a[key] === "string"
        ? mix(a[key], b[key], t)
        : a[key] + (b[key] - a[key]) * t;
  }
  return out;
}
