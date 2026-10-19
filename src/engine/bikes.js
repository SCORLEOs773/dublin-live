const API_URL = import.meta.env.VITE_API_URL;

const POLL_MS = 60000;
const PULSE_MS = 100; // how often the twinkle is redrawn
const EMPTY = { type: "FeatureCollection", features: [] };

// Colour shows how many bikes are left
const COLOR = [
  "case",
  ["==", ["get", "bikes"], 0],
  "#7a5cc4",
  ["<", ["get", "bikes"], 6],
  "#6fb7ff",
  "#7dffd1",
];

export function createBikes(map, { onSummary, onStatus, onSelect } = {}) {
  let stations = [];
  let selectedId = null;
  let destroyed = false;
  let pollTimer = 0;
  let pulseTimer = 0;

  map.addSource("bikes", { type: "geojson", data: EMPTY });

  const byZoom = (a, b) => [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    ["*", ["get", "size"], a],
    16,
    ["*", ["get", "size"], b],
  ];

  map.addLayer({
    id: "bike-glow",
    type: "circle",
    source: "bikes",
    paint: {
      "circle-radius": byZoom(4, 16),
      "circle-color": COLOR,
      "circle-blur": 1,
      "circle-opacity": ["case", ["==", ["get", "bikes"], 0], 0.18, 0.5],
    },
  });
  map.addLayer({
    id: "bike-core",
    type: "circle",
    source: "bikes",
    paint: {
      "circle-radius": byZoom(1.2, 3.5),
      "circle-color": COLOR,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "bike-selected",
    type: "circle",
    source: "bikes",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": 14,
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // A larger, almost invisible circle so stations are easy to click or tap
  map.addLayer({
    id: "bike-hit",
    type: "circle",
    source: "bikes",
    paint: {
      "circle-radius": 16,
      "circle-color": "#000000",
      "circle-opacity": 0.01,
    },
  });

  function describe(s) {
    return {
      id: s.id,
      name: s.name,
      bikes: s.bikes,
      ebikes: s.ebikes,
      classic: Math.max(0, s.bikes - s.ebikes),
      docks: s.docks,
      capacity: s.capacity,
    };
  }

  function emitSelection() {
    const s = selectedId && stations.find((x) => x.id === selectedId);
    onSelect?.(s ? describe(s) : null);
  }

  function select(id) {
    const s = stations.find((x) => x.id === id);
    if (!s) return;
    selectedId = id;
    map.setFilter("bike-selected", ["==", ["get", "id"], id]);
    map.flyTo({
      center: [s.lng, s.lat],
      zoom: Math.max(map.getZoom(), 16.2),
      pitch: 68,
      duration: 2200,
      essential: true,
    });
    emitSelection();
  }

  function clear() {
    selectedId = null;
    map.setFilter("bike-selected", ["==", ["get", "id"], ""]);
    onSelect?.(null);
  }

  map.on("click", "bike-hit", (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id != null) select(String(id));
  });
  map.on(
    "mouseenter",
    "bike-hit",
    () => (map.getCanvas().style.cursor = "pointer"),
  );
  map.on("mouseleave", "bike-hit", () => (map.getCanvas().style.cursor = ""));

  // Gentle twinkling: each station pulses on its own rhythm
  function draw() {
    if (document.hidden) return;
    const t = performance.now();
    map.getSource("bikes")?.setData({
      type: "FeatureCollection",
      features: stations.map((s) => ({
        type: "Feature",
        properties: {
          id: s.id,
          bikes: s.bikes,
          size: s.base * (0.9 + 0.1 * Math.sin(t / 600 + s.phase)),
        },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    });
  }

  function apply(list) {
    const previous = new Map(stations.map((s) => [s.id, s]));
    stations = list.map((s) => {
      const fill = Math.min(1, s.bikes / s.capacity);
      return {
        ...s,
        base: 0.45 + 0.55 * Math.sqrt(fill),
        phase: previous.get(s.id)?.phase ?? Math.random() * Math.PI * 2,
      };
    });
    onSummary?.({
      stations: stations.length,
      bikes: stations.reduce((sum, s) => sum + s.bikes, 0),
    });
    if (selectedId) {
      if (stations.some((s) => s.id === selectedId)) emitSelection();
      else clear();
    }
    draw();
  }

  async function poll() {
    if (destroyed || document.hidden) return;
    if (!API_URL) {
      onStatus?.({
        ok: false,
        message: "The bike service address is missing.",
      });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/bikes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      apply(data.stations ?? []);
      onStatus?.({ ok: true, updated: data.updated });
    } catch (err) {
      console.warn("Bike feed:", err.message);
      onStatus?.({ ok: false, message: "Bike feed unavailable, retrying..." });
    }
  }

  const onVisible = () => {
    if (!document.hidden) poll();
  };
  document.addEventListener("visibilitychange", onVisible);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  pulseTimer = setInterval(draw, PULSE_MS);

  return {
    clear,
    destroy() {
      destroyed = true;
      clearInterval(pollTimer);
      clearInterval(pulseTimer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
