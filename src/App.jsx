import { useEffect, useRef, useState } from "react";
import { createWorld } from "./engine/world.js";

export default function App() {
  const mapRef = useRef(null);
  const worldRef = useRef(null);
  const [clock, setClock] = useState(null);
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState(0); // minutes away from the real time
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let world = null;

    createWorld(mapRef.current, {
      onClock: setClock,
      onReady: () => setReady(true),
    })
      .then((w) => {
        if (cancelled) {
          w.destroy();
          return;
        }
        world = w;
        worldRef.current = w;
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled)
          setError(
            "Couldn't start the map. Check your connection and refresh.",
          );
      });

    return () => {
      cancelled = true;
      worldRef.current = null;
      world?.destroy();
    };
  }, []);

  useEffect(() => {
    worldRef.current?.setOffset(offset);
  }, [offset]);

  const live = offset === 0;

  return (
    <div className="app">
      <div ref={mapRef} className="map" />

      <header className="brand">
        <h1>Dublin Live</h1>
        <p>the city, awake</p>
      </header>

      {clock && (
        <section className="clock" aria-label="Time of day">
          <div className="clock-top">
            <span className="clock-time">{clock.time}</span>
            <span className="clock-phase">
              Dublin · {clock.phase} · moon {clock.moon}%
            </span>
          </div>
          <input
            type="range"
            min={-720}
            max={720}
            step={15}
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            aria-label="Shift the time of day"
          />
          <button className="live" onClick={() => setOffset(0)} disabled={live}>
            {live ? "Live now" : "Back to live"}
          </button>
        </section>
      )}

      <div className={`loader ${ready || error ? "hide" : ""}`} role="status">
        Waking the city...
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <p className="credit">Made by Sukhad Sharma</p>
    </div>
  );
}
