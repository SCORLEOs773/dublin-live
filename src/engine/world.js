import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import * as SunCalcModule from "suncalc";
import { paletteFor } from "./palette.js";
import { LANDMARKS } from "./landmarks.js";
import { createTrains } from "./trains.js";
import { createBikes } from "./bikes.js";
import { BOUNDS } from "./config.js";

const SunCalc = SunCalcModule.default ?? SunCalcModule;

setWorkerUrl(workerUrl);

console.info(
  "%cDublin Live, built by Sukhad Sharma",
  "color:#ffd98a;font-weight:bold",
);

const DUBLIN = { lat: 53.3498, lng: -6.2603 };
const BAY_VIEW = { center: [-6.13, 53.33], zoom: 10.6, pitch: 60, bearing: 40 };
const CITY_VIEW = {
  center: [-6.2603, 53.3452],
  zoom: 15.2,
  pitch: 68,
  bearing: -28,
};

const timeFormat = new Intl.DateTimeFormat("en-IE", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Dublin",
});

function phaseName(alt) {
  if (alt < -12) return "Night";
  if (alt < 0) return "Twilight";
  if (alt < 10) return "Golden hour";
  return "Daylight";
}

// Ask OpenFreeMap's public style where its map data lives, with a fallback address
async function loadSource() {
  try {
    const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
    const style = await res.json();
    const entry = Object.entries(style.sources).find(
      ([, s]) => s.type === "vector",
    );
    if (entry) return { id: entry[0], source: entry[1] };
  } catch {
    /* fall through to the fallback */
  }
  return {
    id: "openmaptiles",
    source: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  };
}

// Our own map style: no labels, no icons, just glowing shapes
function buildStyle(id, source) {
  const width = (a, b, c) => [
    "interpolate",
    ["exponential", 1.4],
    ["zoom"],
    10,
    a,
    14,
    b,
    18,
    c,
  ];
  const notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
  const major = [
    "in",
    ["get", "class"],
    ["literal", ["motorway", "trunk", "primary"]],
  ];
  const minor = [
    "in",
    ["get", "class"],
    ["literal", ["secondary", "tertiary", "minor"]],
  ];
  const rail = ["==", ["get", "class"], "rail"];

  const road = (layerId, filter, paint) => ({
    id: layerId,
    type: "line",
    source: id,
    "source-layer": "transportation",
    filter: ["all", notTunnel, filter],
    layout: { "line-cap": "round", "line-join": "round" },
    paint,
  });

  return {
    version: 8,
    name: "Dublin Live",
    sources: { [id]: source },
    light: {
      anchor: "map",
      color: "#9d8cff",
      intensity: 0.45,
      position: [1.5, 220, 35],
    },
    layers: [
      {
        id: "land",
        type: "background",
        paint: { "background-color": "#0a0c1e" },
      },
      {
        id: "landcover",
        type: "fill",
        source: id,
        "source-layer": "landcover",
        paint: { "fill-color": "#0b2629", "fill-opacity": 0.85 },
      },
      {
        id: "park",
        type: "fill",
        source: id,
        "source-layer": "park",
        paint: { "fill-color": "#0b2629", "fill-opacity": 0.9 },
      },
      {
        id: "water",
        type: "fill",
        source: id,
        "source-layer": "water",
        paint: { "fill-color": "#0b3550" },
      },
      {
        id: "waterway",
        type: "line",
        source: id,
        "source-layer": "waterway",
        paint: {
          "line-color": "#0b3550",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 4],
        },
      },

      road("rail-glow", rail, {
        "line-color": "#ffb347",
        "line-opacity": 0.3,
        "line-width": width(2, 6, 16),
        "line-blur": width(2, 5, 12),
      }),
      road("rail", rail, {
        "line-color": "#ffb347",
        "line-opacity": 0.8,
        "line-width": width(0.5, 1, 3),
      }),
      road("roads-minor-glow", minor, {
        "line-color": "#ffb347",
        "line-opacity": 0.5,
        "line-width": width(0.8, 3, 10),
        "line-blur": width(1, 3, 8),
      }),
      road("roads-minor", minor, {
        "line-color": "#ffd98a",
        "line-opacity": 0.55,
        "line-width": width(0.2, 0.6, 2.4),
      }),
      road("roads-major-glow", major, {
        "line-color": "#ffb347",
        "line-opacity": 0.5,
        "line-width": width(1.6, 5, 16),
        "line-blur": width(2, 5, 12),
      }),
      road("roads-major", major, {
        "line-color": "#ffd98a",
        "line-opacity": 0.8,
        "line-width": width(0.5, 1.4, 4.5),
      }),

      {
        id: "buildings",
        type: "fill-extrusion",
        source: id,
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "render_height"], 6],
            0,
            "#17163a",
            80,
            "#3b2f7d",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.94,
          "fill-extrusion-vertical-gradient": true,
        },
      },
    ],
  };
}

// Repaint the whole city for the current sun position
function applyPalette(map, p, azimuth, altitude) {
  const set = (layer, prop, value) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
  };

  set("land", "background-color", p.land);
  set("landcover", "fill-color", p.park);
  set("park", "fill-color", p.park);
  set("water", "fill-color", p.water);
  set("waterway", "line-color", p.water);

  ["rail-glow", "roads-minor-glow", "roads-major-glow"].forEach((id) => {
    set(id, "line-color", p.glow);
    set(id, "line-opacity", p.glowOpacity);
  });
  ["rail", "roads-minor", "roads-major"].forEach((id) => {
    set(id, "line-color", id === "rail" ? p.glow : p.core);
    set(id, "line-opacity", 0.35 + p.glowOpacity);
  });

  set("buildings", "fill-extrusion-color", [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], 6],
    0,
    p.buildingLow,
    80,
    p.buildingHigh,
  ]);

  // Sun by day, a soft fixed moonlight at night
  const sunUp = altitude > 0;
  const lightAzimuth = sunUp ? azimuth : 220;
  const lightHeight = sunUp ? Math.max(15, Math.min(70, altitude)) : 30;
  map.setLight({
    anchor: "map",
    color: p.light,
    intensity: p.lightIntensity,
    position: [1.5, lightAzimuth, 90 - lightHeight],
  });

  if (typeof map.setSky === "function") {
    try {
      map.setSky({
        "sky-color": p.sky,
        "horizon-color": p.horizon,
        "fog-color": p.fog,
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.8,
        "fog-ground-blend": 0.3,
      });
    } catch {
      /* this MapLibre version has no sky support */
    }
  }
}

// Glowing, clickable landmark beacons
function addBeacons(map) {
  return LANDMARKS.map((place) => {
    const el = document.createElement("button");
    el.className = "beacon";
    el.setAttribute("aria-label", place.name);

    const core = document.createElement("span");
    core.className = "beacon-core";
    const label = document.createElement("span");
    label.className = "beacon-label";
    label.textContent = place.name;
    el.append(core, label);

    el.addEventListener("click", () => {
      map.flyTo({
        center: place.coords,
        zoom: 16.2,
        pitch: 68,
        bearing: place.bearing ?? -20,
        duration: 3500,
        essential: true,
      });
    });

    return new Marker({ element: el, anchor: "center" })
      .setLngLat(place.coords)
      .addTo(map);
  });
}

export async function createWorld(
  container,
  {
    onClock,
    onReady,
    onTrainCount,
    onTrainStatus,
    onTrainSelect,
    onBikeSummary,
    onBikeStatus,
    onBikeSelect,
  } = {},
) {
  const { id, source } = await loadSource();

  const map = new MapLibreMap({
    container,
    style: buildStyle(id, source),
    ...BAY_VIEW,
    minZoom: 9.5,
    maxZoom: 18,
    maxPitch: 80,
    maxBounds: BOUNDS,
    attributionControl: { compact: true },
    fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

  // Print each different warning only once
  const seenWarnings = new Set();
  map.on("error", (e) => {
    const message = String(e.error?.message ?? e.error);
    if (seenWarnings.has(message)) return;
    seenWarnings.add(message);
    console.warn("Map warning:", message);
  });

  let loaded = false;
  let offsetMin = 0;
  let frame = 0;
  let beacons = [];
  let trains = null;
  let bikes = null;
  let spin = false;
  let userTouched = false;
  let lastSpinTime = 0;
  let spinFrame = 0;

  function refresh() {
    if (!loaded) return;
    const date = new Date(Date.now() + offsetMin * 60000);
    const pos = SunCalc.getPosition(date, DUBLIN.lat, DUBLIN.lng);
    const altitude = (pos.altitude * 180) / Math.PI;
    const azimuth = ((pos.azimuth * 180) / Math.PI + 180 + 360) % 360;

    applyPalette(map, paletteFor(altitude), azimuth, altitude);
    onClock?.({
      time: timeFormat.format(date),
      phase: phaseName(altitude),
      moon: Math.round(SunCalc.getMoonIllumination(date).fraction * 100),
    });
  }

  // Coalesce rapid slider moves into one repaint per frame
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  const clockTimer = setInterval(schedule, 30000);

  // Slow idle rotation until the visitor touches the map
  const stopSpin = () => {
    userTouched = true;
    spin = false;
  };
  map.on("mousedown", stopSpin);
  map.on("touchstart", stopSpin);
  map.on("wheel", stopSpin);

  const spinLoop = (t) => {
    spinFrame = requestAnimationFrame(spinLoop);
    if (spin && lastSpinTime)
      map.setBearing(map.getBearing() + (t - lastSpinTime) * 0.0012);
    lastSpinTime = t;
  };
  spinFrame = requestAnimationFrame(spinLoop);

  map.on("load", () => {
    loaded = true;
    beacons = addBeacons(map);
    refresh();

    bikes = createBikes(map, {
      onSummary: onBikeSummary,
      onStatus: onBikeStatus,
      onSelect: (info) => {
        if (info) {
          stopSpin();
          trains?.clear();
        }
        onBikeSelect?.(info);
      },
    });

    trains = createTrains(map, {
      onCount: onTrainCount,
      onStatus: onTrainStatus,
      onSelect: (info) => {
        if (info) {
          stopSpin();
          bikes?.clear();
        }
        onTrainSelect?.(info);
      },
    });

    onReady?.();

    // Cinematic arrival: from the bay down into the city centre
    setTimeout(() => {
      if (userTouched) return;
      map.flyTo({ ...CITY_VIEW, duration: 9000, essential: true });
      map.once("moveend", () => {
        if (!userTouched) spin = true;
      });
    }, 800);
  });

  return {
    setOffset(minutes) {
      offsetMin = minutes;
      schedule();
    },
    followTrain(on) {
      trains?.setFollowing(on);
    },
    clearTrain() {
      trains?.clear();
    },
    clearBike() {
      bikes?.clear();
    },
    destroy() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(spinFrame);
      clearInterval(clockTimer);
      trains?.destroy();
      beacons.forEach((b) => b.remove());
      map.remove();
    },
  };
}
