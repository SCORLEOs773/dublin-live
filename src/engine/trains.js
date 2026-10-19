import { BOUNDS } from "./config.js";
const API_URL = import.meta.env.VITE_API_URL;

const POLL_MS = 20000; // how often we ask for new positions
const TRAIL_POINTS = 30;
const DATA_MS = 50; // redraw the map data about 20 times a second
const EMPTY = { type: "FeatureCollection", features: [] };

const inRegion = (lng, lat) =>
  lng > BOUNDS[0][0] &&
  lng < BOUNDS[1][0] &&
  lat > BOUNDS[0][1] &&
  lat < BOUNDS[1][1];
// The feed's message looks like: "A509\n11:00 - Waterford to Dublin Heuston (0 mins late)\nDeparted..."
function describe(s) {
  const lines = s.message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const [, route = s.direction, status = ""] = lines;
  return { code: s.code, direction: s.direction, route, status };
}

export function createTrains(map, { onCount, onStatus, onSelect } = {}) {
  const trains = new Map(); // train code -> state
  let selected = null;
  let following = false;
  let destroyed = false;
  let pollTimer = 0;
  let raf = 0;
  let lastData = 0;

  map.addSource("trains", { type: "geojson", data: EMPTY });
  map.addSource("train-trails", {
    type: "geojson",
    data: EMPTY,
    lineMetrics: true,
  });

  const byZoom = (a, b) => ["interpolate", ["linear"], ["zoom"], 10, a, 16, b];

  map.addLayer({
    id: "train-trails",
    type: "line",
    source: "train-trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": byZoom(1.5, 5),
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        "rgba(255,179,71,0)",
        1,
        "rgba(255,236,170,0.95)",
      ],
    },
  });
  map.addLayer({
    id: "train-glow",
    type: "circle",
    source: "trains",
    paint: {
      "circle-radius": byZoom(7, 20),
      "circle-color": "#ffb347",
      "circle-blur": 1,
      "circle-opacity": 0.5,
    },
  });
  map.addLayer({
    id: "train-core",
    type: "circle",
    source: "trains",
    paint: { "circle-radius": byZoom(2.5, 6), "circle-color": "#fff1c2" },
  });
  map.addLayer({
    id: "train-selected",
    type: "circle",
    source: "trains",
    filter: ["==", ["get", "code"], ""],
    paint: {
      "circle-radius": byZoom(9, 24),
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // A large, almost invisible circle so trains are easy to click or tap
  map.addLayer({
    id: "train-hit",
    type: "circle",
    source: "trains",
    paint: {
      "circle-radius": 20,
      "circle-color": "#000000",
      "circle-opacity": 0.01,
    },
  });

  function emitSelection() {
    const s = selected && trains.get(selected);
    onSelect?.(s ? { ...describe(s), following } : null);
  }

  function select(code) {
    const s = trains.get(code);
    if (!s) return;
    selected = code;
    following = false;
    map.setFilter("train-selected", ["==", ["get", "code"], code]);
    map.flyTo({
      center: [s.lng, s.lat],
      zoom: Math.max(map.getZoom(), 15.8),
      pitch: 70,
      duration: 2500,
      essential: true,
    });
    // Start following once the camera has arrived
    map.once("moveend", () => {
      if (selected === code) {
        following = true;
        emitSelection();
      }
    });
    emitSelection();
  }

  function clear() {
    selected = null;
    following = false;
    map.setFilter("train-selected", ["==", ["get", "code"], ""]);
    onSelect?.(null);
  }

  map.on("click", "train-hit", (e) => {
    const code = e.features?.[0]?.properties?.code;
    if (code) select(code);
  });
  map.on(
    "mouseenter",
    "train-hit",
    () => (map.getCanvas().style.cursor = "pointer"),
  );
  map.on("mouseleave", "train-hit", () => (map.getCanvas().style.cursor = ""));
  map.on("dragstart", () => {
    if (following) {
      following = false;
      emitSelection();
    }
  });

  // New positions arrived: each train will glide from where it is now to the new spot
  function apply(list) {
    const now = performance.now();
    const seen = new Set();

    list.forEach((t) => {
      if (!inRegion(t.lng, t.lat)) return;
      seen.add(t.code);

      let s = trains.get(t.code);
      if (!s) {
        s = {
          code: t.code,
          lng: t.lng,
          lat: t.lat,
          fromLng: t.lng,
          fromLat: t.lat,
          toLng: t.lng,
          toLat: t.lat,
          t0: now,
          trail: [[t.lng, t.lat]],
        };
        trains.set(t.code, s);
      } else {
        s.fromLng = s.lng;
        s.fromLat = s.lat;
        s.toLng = t.lng;
        s.toLat = t.lat;
        s.t0 = now;
      }
      s.direction = t.direction;
      s.message = t.message;
    });

    for (const code of [...trains.keys()]) {
      if (!seen.has(code)) trains.delete(code);
    }
    if (selected && !trains.has(selected)) clear();

    onCount?.({ area: trains.size, total: list.length });
  }

  function frame(time) {
    raf = requestAnimationFrame(frame);

    trains.forEach((s) => {
      const k = Math.min(1, (time - s.t0) / POLL_MS);
      s.lng = s.fromLng + (s.toLng - s.fromLng) * k;
      s.lat = s.fromLat + (s.toLat - s.fromLat) * k;

      const last = s.trail[s.trail.length - 1];
      if (Math.abs(s.lng - last[0]) + Math.abs(s.lat - last[1]) > 0.0001) {
        s.trail.push([s.lng, s.lat]);
        if (s.trail.length > TRAIL_POINTS) s.trail.shift();
      }
    });

    // Camera glides after the followed train
    if (following && selected) {
      const s = trains.get(selected);
      if (s) {
        const c = map.getCenter();
        map.setCenter([
          c.lng + (s.lng - c.lng) * 0.08,
          c.lat + (s.lat - c.lat) * 0.08,
        ]);
      }
    }

    if (time - lastData >= DATA_MS) {
      lastData = time;
      const points = [];
      const lines = [];
      trains.forEach((s) => {
        points.push({
          type: "Feature",
          properties: { code: s.code },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        });
        if (s.trail.length > 1) {
          lines.push({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: s.trail },
          });
        }
      });
      map
        .getSource("trains")
        ?.setData({ type: "FeatureCollection", features: points });
      map
        .getSource("train-trails")
        ?.setData({ type: "FeatureCollection", features: lines });
    }
  }

  async function poll() {
    if (destroyed || document.hidden) return;
    if (!API_URL) {
      onStatus?.({
        ok: false,
        message: "The train service address is missing.",
      });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/trains`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      apply(data.trains ?? []);
      onStatus?.({ ok: true, updated: data.updated });
    } catch (err) {
      console.warn("Train feed:", err.message);
      onStatus?.({ ok: false, message: "Train feed unavailable, retrying..." });
    }
  }

  const onVisible = () => {
    if (!document.hidden) poll();
  };
  document.addEventListener("visibilitychange", onVisible);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  raf = requestAnimationFrame(frame);

  return {
    clear,
    setFollowing(on) {
      following = Boolean(on && selected);
      emitSelection();
    },
    destroy() {
      destroyed = true;
      clearInterval(pollTimer);
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
