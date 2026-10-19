import { useEffect, useRef, useState } from "react";
import { createWorld } from "./engine/world.js";

export default function App() {
  const mapRef = useRef(null);
  const worldRef = useRef(null);
  const [clock, setClock] = useState(null);
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState(0); // minutes away from the real time
  const [error, setError] = useState("");
  const [trainCount, setTrainCount] = useState(null);
  const [trainStatus, setTrainStatus] = useState({ ok: true });
  const [train, setTrain] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let world = null;

    createWorld(mapRef.current, {
      onClock: setClock,
      onReady: () => setReady(true),
      onTrainCount: setTrainCount,
      onTrainStatus: setTrainStatus,
      onTrainSelect: setTrain,
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

  let pillText = "Listening for trains...";
  if (!trainStatus.ok) pillText = trainStatus.message;
  else if (trainCount) {
    const { area, total } = trainCount;
    if (area > 0)
      pillText = `${area} ${area === 1 ? "train" : "trains"} in the Dublin area`;
    else if (total > 0)
      pillText = `No trains in the Dublin area right now (${total} elsewhere in Ireland)`;
    else pillText = "No trains running right now";
  }

  return (
    <div className="app">
      <div ref={mapRef} className="map" />

      <header className="brand">
        <h1>Dublin Live</h1>
        <p>the city, awake</p>
      </header>

      {ready && (
        <div className={`pill ${trainStatus.ok ? "" : "warn"}`} role="status">
          <span className="dot" />
          {pillText}
        </div>
      )}

      {train && (
        <aside className="card" aria-live="polite">
          <div className="card-head">
            <span className="card-code">Train {train.code}</span>
            <button
              className="card-x"
              onClick={() => worldRef.current?.clearTrain()}
              aria-label="Close train details"
            >
              ×
            </button>
          </div>
          <p className="card-route">{train.route}</p>
          {train.status && <p className="card-status">{train.status}</p>}
          <button
            className="live"
            onClick={() => worldRef.current?.followTrain(!train.following)}
          >
            {train.following ? "Stop following" : "Follow this train"}
          </button>
        </aside>
      )}

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
