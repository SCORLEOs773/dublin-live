const TRAINS_URL =
  "http://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML";
const CACHE_MS = 15000;

// Public, read-only data with no secrets, so any website may read it
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let cache = { at: 0, body: null };
let inflight = null;

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

// Turn Irish Rail's XML into a simple list of running trains
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
        t.status === "R" && // R = running
        Number.isFinite(t.lat) &&
        Number.isFinite(t.lng) &&
        t.lat !== 0 &&
        t.lng !== 0,
    );
}

async function getTrains() {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return cache.body;

  if (!inflight) {
    inflight = fetch(TRAINS_URL, {
      headers: { "User-Agent": "dublin-live (portfolio project)" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Upstream ${res.status}`);
        const trains = parseTrains(await res.text());
        cache = {
          at: Date.now(),
          body: JSON.stringify({ updated: new Date().toISOString(), trains }),
        };
        return cache.body;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    return await inflight;
  } catch (err) {
    if (cache.body) return cache.body; // serve slightly old data rather than nothing
    throw err;
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);
    if (pathname === "/api/trains") {
      try {
        return new Response(await getTrains(), {
          headers: {
            ...CORS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=10",
          },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: "Train data is unavailable right now" }),
          {
            status: 502,
            headers: { ...CORS, "Content-Type": "application/json" },
          },
        );
      }
    }
    return new Response("Dublin Live API", { headers: CORS });
  },
};
