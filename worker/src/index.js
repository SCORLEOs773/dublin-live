const TRAINS_URL =
  "http://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML";
const BIKE_INFO_URL =
  "https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json";
const BIKE_STATUS_URL =
  "https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json";

const TRAINS_CACHE_MS = 15000;
const BIKES_CACHE_MS = 30000;
const BIKE_INFO_CACHE_MS = 10 * 60 * 1000;
const BUSES_URL =
  "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";
const BUSES_CACHE_MS = 60000; // the NTA has a fair usage policy, so at most about one request a minute
const AREA = { west: -7.0, south: 52.95, east: -5.85, north: 53.8 };
const USER_AGENT = "dublin-live (portfolio project)";

// Public, read-only data with no secrets, so any website may read it
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---------- Trains ----------
let trainsCache = { at: 0, body: null };
let trainsInflight = null;

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function tag(chunk, name) {
  const m = chunk.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
}

function parseTrains(xml) {
  return xml
    .split("<TrainStatus>")
    .slice(1)
    .map((chunk) => ({
      status: chunk.split("<")[0].trim(),
      code: tag(chunk, "TrainCode"),
      lat: Number(tag(chunk, "TrainLatitude")),
      lng: Number(tag(chunk, "TrainLongitude")),
      direction: tag(chunk, "Direction"),
      message: tag(chunk, "PublicMessage").replace(/\\n/g, "\n"),
    }))
    .filter(
      (t) =>
        t.code &&
        t.status === "R" &&
        Number.isFinite(t.lat) &&
        Number.isFinite(t.lng) &&
        t.lat !== 0 &&
        t.lng !== 0,
    );
}

async function getTrains() {
  if (trainsCache.body && Date.now() - trainsCache.at < TRAINS_CACHE_MS)
    return trainsCache.body;

  if (!trainsInflight) {
    trainsInflight = fetch(TRAINS_URL, {
      headers: { "User-Agent": USER_AGENT },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Upstream ${res.status}`);
        const trains = parseTrains(await res.text());
        trainsCache = {
          at: Date.now(),
          body: JSON.stringify({ updated: new Date().toISOString(), trains }),
        };
        return trainsCache.body;
      })
      .finally(() => {
        trainsInflight = null;
      });
  }

  try {
    return await trainsInflight;
  } catch (err) {
    if (trainsCache.body) return trainsCache.body;
    throw err;
  }
}

// ---------- Bikes ----------
let bikesCache = { at: 0, body: null };
let infoCache = { at: 0, stations: null };
let bikesInflight = null;

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

// "CLARENDON ROW" -> "Clarendon Row"
const titleCase = (name) =>
  name
    .toLowerCase()
    .replace(
      /(^|[\s/(.-]|'(?=[a-z]{2,}))([a-z])/g,
      (m, p, c) => p + c.toUpperCase(),
    );

async function getStationInfo() {
  if (infoCache.stations && Date.now() - infoCache.at < BIKE_INFO_CACHE_MS) {
    return infoCache.stations;
  }
  const data = await getJson(BIKE_INFO_URL);
  infoCache = { at: Date.now(), stations: data.data.stations };
  return infoCache.stations;
}

async function getBikes() {
  if (bikesCache.body && Date.now() - bikesCache.at < BIKES_CACHE_MS)
    return bikesCache.body;

  if (!bikesInflight) {
    bikesInflight = Promise.all([getStationInfo(), getJson(BIKE_STATUS_URL)])
      .then(([info, status]) => {
        const byId = new Map(
          status.data.stations.map((s) => [s.station_id, s]),
        );
        const stations = info
          .map((i) => {
            const s = byId.get(i.station_id);
            if (!s) return null;
            const electric =
              s.vehicle_types_available?.find(
                (v) => v.vehicle_type_id === "electrical",
              )?.count ?? 0;
            return {
              id: i.station_id,
              name: titleCase(i.name),
              lat: i.lat,
              lng: i.lon,
              capacity: i.capacity,
              bikes: s.num_bikes_available,
              ebikes: electric,
              docks: s.num_docks_available,
              active: Boolean(s.is_installed && s.is_renting),
            };
          })
          .filter((s) => s && s.active && s.capacity > 0);

        bikesCache = {
          at: Date.now(),
          body: JSON.stringify({ updated: new Date().toISOString(), stations }),
        };
        return bikesCache.body;
      })
      .finally(() => {
        bikesInflight = null;
      });
  }

  try {
    return await bikesInflight;
  } catch (err) {
    if (bikesCache.body) return bikesCache.body;
    throw err;
  }
}

// ---------- Buses ----------
let busesCache = { at: 0, body: null };
let busesInflight = null;

const round5 = (n) => Math.round(n * 1e5) / 1e5;

async function getBuses(env) {
  if (!env.NTA_API_KEY) throw new Error("NTA_API_KEY is not set");
  if (busesCache.body && Date.now() - busesCache.at < BUSES_CACHE_MS)
    return busesCache.body;

  if (!busesInflight) {
    busesInflight = fetch(BUSES_URL, {
      headers: { "x-api-key": env.NTA_API_KEY, "User-Agent": USER_AGENT },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Upstream ${res.status}`);
        const data = await res.json();
        const now =
          Number(data.header?.timestamp) || Math.floor(Date.now() / 1000);

        const buses = [];
        for (const entity of data.entity ?? []) {
          const v = entity.vehicle;
          const p = v?.position;
          if (!p) continue;

          const lat = Number(p.latitude);
          const lng = Number(p.longitude);
          if (
            !(
              lat > AREA.south &&
              lat < AREA.north &&
              lng > AREA.west &&
              lng < AREA.east
            )
          )
            continue;

          const ts = Number(v.timestamp) || 0;
          if (ts && now - ts > 600) continue; // skip buses that stopped reporting

          const tripId = v.trip?.trip_id ?? "";
          buses.push({
            id: tripId || String(v.vehicle?.id ?? entity.id),
            route: v.trip?.route_id ?? "",
            start: v.trip?.start_time ?? "",
            lat: round5(lat),
            lng: round5(lng),
          });
        }

        busesCache = {
          at: Date.now(),
          body: JSON.stringify({ updated: new Date().toISOString(), buses }),
        };
        return busesCache.body;
      })
      .finally(() => {
        busesInflight = null;
      });
  }

  try {
    return await busesInflight;
  } catch (err) {
    if (busesCache.body) return busesCache.body;
    throw err;
  }
}

// ---------- Routing ----------
async function respond(load, what) {
  try {
    return new Response(await load(), {
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: `${what} data is unavailable right now` }),
      {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);
    if (pathname === "/api/trains") return respond(getTrains, "Train");
    if (pathname === "/api/bikes") return respond(getBikes, "Bike");
    if (pathname === "/api/buses") return respond(() => getBuses(env), "Bus");
    return new Response("Dublin Live API", { headers: CORS });
  },
};
