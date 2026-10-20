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
  const [bikeSummary, setBikeSummary] = useState(null);
  const [bikeStatus, setBikeStatus] = useState({ ok: true });
  const [station, setStation] = useState(null);
  const [busCount, setBusCount] = useState(null);
  const [busStatus, setBusStatus] = useState({ ok: true });
  const [bus, setBus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let world = null;

    createWorld(mapRef.current, {
      onClock: setClock,
      onReady: () => setReady(true),
      onTrainCount: setTrainCount,
      onTrainStatus: setTrainStatus,
      onTrainSelect: setTrain,
      onBikeSummary: setBikeSummary,
      onBikeStatus: setBikeStatus,
      onBikeSelect: setStation,
      onBusCount: setBusCount,
      onBusStatus: setBusStatus,
      onBusSelect: setBus,
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

  let trainText = "Listening for trains...";
  if (!trainStatus.ok) trainText = trainStatus.message;
  else if (trainCount) {
    const { area, total } = trainCount;
    if (area > 0)
      trainText = `${area} ${area === 1 ? "train" : "trains"} in the Dublin area`;
    else if (total > 0)
      trainText = `No trains in the Dublin area right now (${total} elsewhere in Ireland)`;
    else trainText = "No trains running right now";
  }

  let bikeText = "Counting bikes...";
  if (!bikeStatus.ok) bikeText = bikeStatus.message;
  else if (bikeSummary) {
    bikeText = `${bikeSummary.bikes.toLocaleString("en-IE")} bikes at ${bikeSummary.stations} stations`;
  }

  let busText = "Looking for buses...";
  if (!busStatus.ok) busText = busStatus.message;
  else if (busCount !== null) {
    busText =
      busCount === 0
        ? "No buses on the move right now"
        : `${busCount.toLocaleString("en-IE")} ${busCount === 1 ? "bus" : "buses"} on the move`;
  }

  return (
    <div className="app">
      <div ref={mapRef} className="map" />

      <header className="brand">
        <h1>Dublin Live</h1>
        <p>the city, awake</p>
      </header>

      {ready && (
        <div className="pills">
          <div className={`pill ${trainStatus.ok ? "" : "warn"}`} role="status">
            <span className="dot" />
            {trainText}
          </div>
          <div
            className={`pill bus ${busStatus.ok ? "" : "warn"}`}
            role="status"
          >
            <span className="dot" />
            {busText}
          </div>
          <div
            className={`pill bike ${bikeStatus.ok ? "" : "warn"}`}
            role="status"
          >
            <span className="dot" />
            {bikeText}
          </div>
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

      {bus && (
        <aside className="card" aria-live="polite">
          <div className="card-head">
            <span className="card-code">
              {bus.route ? `Bus ${bus.route}` : "Bus"}
            </span>
            <button
              className="card-x"
              onClick={() => worldRef.current?.clearBus()}
              aria-label="Close bus details"
            >
              ×
            </button>
          </div>
          <p className="card-route">
            {bus.long ||
              (bus.rawRoute
                ? `Route ${bus.rawRoute}`
                : "Service in the Dublin area")}
          </p>
          {bus.start && (
            <p className="card-status">
              Trip scheduled to start at {bus.start.slice(0, 5)}
            </p>
          )}
          <button
            className="live"
            onClick={() => worldRef.current?.followBus(!bus.following)}
          >
            {bus.following ? "Stop following" : "Follow this bus"}
          </button>
        </aside>
      )}

      {station && (
        <aside className="card" aria-live="polite">
          <div className="card-head">
            <span className="card-code">{station.name}</span>
            <button
              className="card-x"
              onClick={() => worldRef.current?.clearBike()}
              aria-label="Close station details"
            >
              ×
            </button>
          </div>
          <p className="card-route">Dublinbikes station</p>
          <p className="card-status">
            {station.bikes} {station.bikes === 1 ? "bike" : "bikes"} ready (
            {station.classic} classic, {station.ebikes} electric) ·{" "}
            {station.docks} free {station.docks === 1 ? "dock" : "docks"}
          </p>
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

      <p className="sources">
        Data: Iarnród Éireann, National Transport Authority, Dublin City Council
        (CC BY 4.0), OpenStreetMap contributors
      </p>
      <p className="credit">Made by Sukhad Sharma</p>
    </div>
  );
}
