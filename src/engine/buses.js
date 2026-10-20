const API_URL = import.meta.env.VITE_API_URL;

const POLL_MS = 60000; // the feed updates about once a minute
const DATA_MS = 100; // redraw about 10 times a second
const EMPTY = { type: "FeatureCollection", features: [] };

export function createBuses(map, { onCount, onStatus, onSelect } = {}) {
  const buses = new Map(); // trip id -> state
  let routes = {};
  let selected = null;
  let following = false;
  let destroyed = false;
  let pollTimer = 0;
  let retryTimer = 0;
  let raf = 0;
  let lastData = 0;
  let loggedMatch = false;

  // Route numbers (39A, 46A...) from the timetable file shipped with the site
  fetch(`${import.meta.env.BASE_URL}routes.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .then((json) => {
      routes = json && typeof json === "object" ? json : {};
    })
    .catch(() => {});

  map.addSource("buses", { type: "geojson", data: EMPTY });

  const byZoom = (a, b) => ["interpolate", ["linear"], ["zoom"], 10, a, 16, b];

  map.addLayer({
    id: "bus-glow",
    type: "circle",
    source: "buses",
    paint: {
      "circle-radius": byZoom(3, 11),
      "circle-color": "#8f7bff",
      "circle-blur": 1,
      "circle-opacity": 0.5,
    },
  });
  map.addLayer({
    id: "bus-core",
    type: "circle",
    source: "buses",
    paint: { "circle-radius": byZoom(1.1, 3.4), "circle-color": "#e4dcff" },
  });
  map.addLayer({
    id: "bus-selected",
    type: "circle",
    source: "buses",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": byZoom(8, 20),
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // A larger, almost invisible circle so buses are easy to click or tap
  map.addLayer({
    id: "bus-hit",
    type: "circle",
    source: "buses",
    paint: {
      "circle-radius": 14,
      "circle-color": "#000000",
      "circle-opacity": 0.01,
    },
  });

  function describe(s) {
    const r = routes[s.route];
    return {
      id: s.id,
      route: r?.n ?? "",
      long: r?.l ?? "",
      rawRoute: s.route,
      start: s.start,
    };
  }

  function emitSelection() {
    const s = selected && buses.get(selected);
    onSelect?.(s ? { ...describe(s), following } : null);
  }

  function select(id) {
    const s = buses.get(id);
    if (!s) return;
    selected = id;
    following = false;
    map.setFilter("bus-selected", ["==", ["get", "id"], id]);
    map.flyTo({
      center: [s.lng, s.lat],
      zoom: Math.max(map.getZoom(), 16),
      pitch: 70,
      duration: 2500,
      essential: true,
    });
    map.once("moveend", () => {
      if (selected === id) {
        following = true;
        emitSelection();
      }
    });
    emitSelection();
  }

  function clear() {
    selected = null;
    following = false;
    map.setFilter("bus-selected", ["==", ["get", "id"], ""]);
    onSelect?.(null);
  }

  map.on("click", "bus-hit", (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id != null) select(String(id));
  });
  map.on(
    "mouseenter",
    "bus-hit",
    () => (map.getCanvas().style.cursor = "pointer"),
  );
  map.on("mouseleave", "bus-hit", () => (map.getCanvas().style.cursor = ""));
  map.on("dragstart", () => {
    if (following) {
      following = false;
      emitSelection();
    }
  });

  // New positions arrived: each bus glides from where it is now to the new spot
  function apply(list) {
    const now = performance.now();
    const seen = new Set();

    list.forEach((b) => {
      seen.add(b.id);
      let s = buses.get(b.id);
      if (!s) {
        s = {
          id: b.id,
          lng: b.lng,
          lat: b.lat,
          fromLng: b.lng,
          fromLat: b.lat,
          toLng: b.lng,
          toLat: b.lat,
          t0: now,
        };
        buses.set(b.id, s);
      } else {
        s.fromLng = s.lng;
        s.fromLat = s.lat;
        s.toLng = b.lng;
        s.toLat = b.lat;
        s.t0 = now;
      }
      s.route = b.route;
      s.start = b.start;
    });

    for (const id of [...buses.keys()]) {
      if (!seen.has(id)) buses.delete(id);
    }
    if (selected && !buses.has(selected)) clear();

    onCount?.(buses.size);
    if (selected) emitSelection();

    // One-time check of how many buses we can give a route number to
    if (!loggedMatch && Object.keys(routes).length) {
      loggedMatch = true;
      const matched = list.filter((b) => routes[b.route]).length;
      console.info(`Bus route names matched: ${matched} of ${list.length}`);
    }
  }

  function frame(time) {
    raf = requestAnimationFrame(frame);

    buses.forEach((s) => {
      const k = Math.min(1, (time - s.t0) / POLL_MS);
      s.lng = s.fromLng + (s.toLng - s.fromLng) * k;
      s.lat = s.fromLat + (s.toLat - s.fromLat) * k;
    });

    if (following && selected) {
      const s = buses.get(selected);
      if (s) {
        const c = map.getCenter();
        map.setCenter([
          c.lng + (s.lng - c.lng) * 0.08,
          c.lat + (s.lat - c.lat) * 0.08,
        ]);
      }
    }

    if (time - lastData >= DATA_MS && !document.hidden) {
      lastData = time;
      const features = [];
      buses.forEach((s) => {
        features.push({
          type: "Feature",
          properties: { id: s.id },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        });
      });
      map.getSource("buses")?.setData({ type: "FeatureCollection", features });
    }
  }

  async function poll() {
    if (destroyed || document.hidden) return;
    if (!API_URL) {
      onStatus?.({ ok: false, message: "The bus service address is missing." });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/buses`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.buses))
        throw new Error("unexpected answer from the bus service");
      apply(data.buses);
      onStatus?.({ ok: true, updated: data.updated });
    } catch (err) {
      console.warn("Bus feed:", err.message);
      onStatus?.({ ok: false, message: "Bus feed unavailable, retrying..." });
      clearTimeout(retryTimer);
      retryTimer = setTimeout(poll, 8000);
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
      clearTimeout(retryTimer);
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
