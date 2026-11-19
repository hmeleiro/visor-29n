import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HistoryResponse,
  LastSeatResponse,
  LatestState,
  MetaResponse,
  SeriesResponse,
  TerritorySeries,
} from "../../shared/types.js";
import { fetchHistory, fetchLastSeat, fetchMeta, fetchSeries } from "./api.js";
import { LastSeatSection } from "./components/LastSeatSection.js";
import { TerritoryCard } from "./components/TerritoryCard.js";
import { TerritorySelector } from "./components/TerritorySelector.js";
import type { Metric } from "./components/ScrutinyChart.js";
import { formatTimestamp } from "./format.js";

type ConnectionState = "connecting" | "live" | "retrying";

function selectedFromUrl(allowed: ReadonlySet<string>): string[] {
  const raw = new URLSearchParams(window.location.search).get("territorios");
  if (!raw) return ["ES"];
  const ids = [...new Set(raw.split(","))].filter((id) => allowed.has(id));
  return ids.length > 0 ? ids.slice(0, 6) : ["ES"];
}

function mergeSeries(
  current: TerritorySeries[],
  delta: TerritorySeries[],
): TerritorySeries[] {
  const merged = new Map(current.map((series) => [series.territory.id, series]));
  for (const incoming of delta) {
    const existing = merged.get(incoming.territory.id);
    if (!existing) {
      merged.set(incoming.territory.id, incoming);
      continue;
    }
    const snapshots = new Map(
      existing.snapshots.map((snapshot) => [snapshot.envio, snapshot]),
    );
    incoming.snapshots.forEach((snapshot) => snapshots.set(snapshot.envio, snapshot));
    merged.set(incoming.territory.id, {
      territory: incoming.territory,
      snapshots: [...snapshots.values()].sort((a, b) => a.envio - b.envio),
    });
  }
  return [...merged.values()];
}

function connectionLabel(state: ConnectionState): string {
  if (state === "live") return "En directo";
  if (state === "retrying") return "Reconectando";
  return "Conectando";
}

export function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [selected, setSelected] = useState<string[]>(["ES"]);
  const [current, setCurrent] = useState<TerritorySeries[]>([]);
  const [historical, setHistorical] = useState<TerritorySeries[]>([]);
  const [lastSeat, setLastSeat] = useState<LastSeatResponse | null>(null);
  const [metric, setMetric] = useState<Metric>("votePct");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastSeatLoading, setLastSeatLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  const selectedRef = useRef(selected);
  const latestEnvioRef = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  const lastSeatRef = useRef(lastSeat);
  const lastSeatRequestRef = useRef<AbortController | null>(null);
  selectedRef.current = selected;
  lastSeatRef.current = lastSeat;

  const loadLastSeat = useCallback(async (envio?: number) => {
    lastSeatRequestRef.current?.abort();
    const controller = new AbortController();
    lastSeatRequestRef.current = controller;
    setLastSeatLoading(true);
    try {
      const response = await fetchLastSeat(envio, controller.signal);
      if (!controller.signal.aborted) {
        setLastSeat(response);
        setError(null);
      }
      return response;
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No se pudo cargar la batalla por el último escaño",
        );
      }
      throw caught;
    } finally {
      if (!controller.signal.aborted) setLastSeatLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMeta(controller.signal)
      .then((response) => {
        setMeta(response);
        const allowed = new Set(response.territories.map((territory) => territory.id));
        setSelected(selectedFromUrl(allowed));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "No se pudo cargar el visor");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      fetchSeries(selected, undefined, controller.signal),
      fetchHistory(selected, controller.signal),
    ])
      .then(([liveResponse, historyResponse]: [SeriesResponse, HistoryResponse]) => {
        setCurrent(liveResponse.territories);
        setHistorical(historyResponse.territories);
        latestEnvioRef.current = liveResponse.latest.envio;
        setMeta((previous) =>
          previous ? { ...previous, latest: liveResponse.latest } : previous,
        );
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "No se pudieron cargar los datos");
          setLoading(false);
        }
      });

    const params = new URLSearchParams(window.location.search);
    params.set("territorios", selected.join(","));
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    return () => controller.abort();
  }, [meta?.territories, selected]);

  useEffect(() => {
    if (!meta) return;
    void loadLastSeat().catch(() => undefined);
    return () => lastSeatRequestRef.current?.abort();
  }, [loadLastSeat, meta?.territories]);

  const refreshDelta = useCallback(async () => {
    if (refreshingRef.current || latestEnvioRef.current === null) return;
    refreshingRef.current = true;
    try {
      const timeline = lastSeatRef.current;
      const timelineLatest = timeline?.availableEnvios.at(-1)?.envio;
      const selectedHistoricalEnvio =
        timeline?.envio !== null && timeline?.envio !== timelineLatest
          ? timeline?.envio
          : undefined;
      const [response] = await Promise.all([
        fetchSeries(selectedRef.current, latestEnvioRef.current),
        loadLastSeat(selectedHistoricalEnvio ?? undefined),
      ]);
      setCurrent((previous) => mergeSeries(previous, response.territories));
      latestEnvioRef.current = response.latest.envio;
      setMeta((previous) =>
        previous ? { ...previous, latest: response.latest } : previous,
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Datos conservados. ${caught.message}`
          : "Datos conservados mientras se recupera la conexión",
      );
    } finally {
      refreshingRef.current = false;
    }
  }, [loadLastSeat]);

  useEffect(() => {
    if (!meta) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("retrying");
    source.addEventListener("envio", () => void refreshDelta());

    const fallback = window.setInterval(() => {
      fetchMeta()
        .then((response) => {
          setMeta((previous) =>
            previous
              ? { ...response, territories: previous.territories }
              : response,
          );
          if (
            response.latest.envio !== null &&
            (latestEnvioRef.current === null ||
              response.latest.envio > latestEnvioRef.current)
          ) {
            void refreshDelta();
          }
        })
        .catch(() => setConnection("retrying"));
    }, 15_000);

    return () => {
      window.clearInterval(fallback);
      source.close();
    };
  }, [meta?.territories, refreshDelta]);

  const currentMap = useMemo(
    () => new Map(current.map((series) => [series.territory.id, series])),
    [current],
  );
  const historicalMap = useMemo(
    () => new Map(historical.map((series) => [series.territory.id, series])),
    [historical],
  );
  const selectedTerritories = useMemo(
    () =>
      selected
        .map((id) => meta?.territories.find((territory) => territory.id === id))
        .filter((territory): territory is NonNullable<typeof territory> => Boolean(territory)),
    [meta?.territories, selected],
  );

  const latest: LatestState | null = meta?.latest ?? null;

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Elecciones generales · 29N</p>
            <h1>Evolución del escrutinio</h1>
            <p className="hero-description">
              Seguimiento territorial en directo y comparación punto a punto con el 23J.
            </p>
          </div>
          <div className="live-panel" aria-live="polite">
            <div className={`connection-status ${connection}`}>
              <i />
              {connectionLabel(connection)}
            </div>
            <strong>{latest?.envio === null || latest?.envio === undefined ? "Sin envíos" : `Envío ${latest.envio}`}</strong>
            <span>{formatTimestamp(latest?.timestamp ?? null)}</span>
          </div>
        </div>
      </header>

      <main>
        <section className="controls-panel" aria-label="Controles del visor">
          {meta ? (
            <TerritorySelector
              territories={meta.territories}
              selected={selected}
              onChange={setSelected}
            />
          ) : (
            <div className="territory-control"><div className="skeleton control-skeleton" /></div>
          )}

          <fieldset className="metric-control">
            <legend>Indicador</legend>
            <div className="segmented-control">
              <button
                type="button"
                className={metric === "votePct" ? "active" : ""}
                aria-pressed={metric === "votePct"}
                onClick={() => setMetric("votePct")}
              >
                Voto %
              </button>
              <button
                type="button"
                className={metric === "seats" ? "active" : ""}
                aria-pressed={metric === "seats"}
                onClick={() => setMetric("seats")}
              >
                Escaños
              </button>
            </div>
          </fieldset>

          <div className="visibility-control">
            <span>Series</span>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              <i aria-hidden="true" />
              <b>{showAll ? "Todos los partidos" : "Partidos relevantes"}</b>
            </label>
          </div>
        </section>

        {error ? (
          <div className="error-banner" role="alert">
            <strong>Conexión interrumpida</strong>
            <span>{error}</span>
            <button type="button" onClick={() => window.location.reload()}>Reintentar</button>
          </div>
        ) : null}

        <nav className="section-nav" aria-label="Secciones del dashboard">
          <a href="#evolucion">Evolución del escrutinio</a>
          <a href="#ultimo-escano">Batalla por el último escaño</a>
        </nav>

        <div className="dashboard-intro" id="evolucion">
          <div>
            <h2>Territorios monitorizados</h2>
            <p>La línea continua muestra el 29N; la discontinua reproduce la evolución del 23J.</p>
          </div>
          <span>{selectedTerritories.length} de 6</span>
        </div>

        <section className="territory-grid" aria-label="Resultados por territorio">
          {selectedTerritories.map((territory) => (
            <TerritoryCard
              key={territory.id}
              territory={territory}
              current={currentMap.get(territory.id)}
              historical={historicalMap.get(territory.id)}
              parties={meta?.parties ?? []}
              metric={metric}
              showAll={showAll}
              loading={loading}
            />
          ))}
          {!meta && loading ? (
            <TerritoryCard
              territory={{ id: "ES", name: "España", kind: "country" }}
              parties={[]}
              metric={metric}
              showAll={showAll}
              loading
            />
          ) : null}
        </section>

        <LastSeatSection
          data={lastSeat}
          parties={meta?.parties ?? []}
          loading={lastSeatLoading}
          onEnvioChange={(envio) => void loadLastSeat(envio).catch(() => undefined)}
        />
      </main>

      <footer>
        <span>Fuente 29N: resultados_totales · Fuente 23J: escrutinio acumulado</span>
        <span>FA se compara con Sumar (23J)</span>
      </footer>
    </div>
  );
}

