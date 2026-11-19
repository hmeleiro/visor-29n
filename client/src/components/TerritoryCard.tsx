import { useEffect, useMemo, useState } from "react";
import type {
  ElectionSnapshot,
  PartyMeta,
  TerritoryInfo,
  TerritorySeries,
} from "../../../shared/types.js";
import { formatNumber, formatTimestamp } from "../format.js";
import { ScrutinyChart, type Metric } from "./ScrutinyChart.js";

interface Props {
  territory: TerritoryInfo;
  current?: TerritorySeries;
  historical?: TerritorySeries;
  parties: PartyMeta[];
  metric: Metric;
  showAll: boolean;
  loading: boolean;
}

function valueMap(snapshot: ElectionSnapshot | undefined) {
  return new Map((snapshot?.parties ?? []).map((value) => [value.partyId, value]));
}

export function TerritoryCard({
  territory,
  current,
  historical,
  parties,
  metric,
  showAll,
  loading,
}: Props) {
  const latest = current?.snapshots.at(-1);
  const final23J = historical?.snapshots.at(-1);
  const latestValues = useMemo(() => valueMap(latest), [latest]);
  const historicalValues = useMemo(() => valueMap(final23J), [final23J]);
  const partyMap = useMemo(
    () => new Map(parties.map((party) => [party.id, party])),
    [parties],
  );

  const allPartyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const snapshot of current?.snapshots ?? []) {
      snapshot.parties.forEach((party) => ids.add(party.partyId));
    }
    for (const snapshot of historical?.snapshots ?? []) {
      snapshot.parties.forEach((party) => ids.add(party.partyId));
    }
    return [...ids];
  }, [current, historical]);

  const rankedPartyIds = useMemo(
    () =>
      [...allPartyIds].sort((a, b) => {
        const voteA = Math.max(
          latestValues.get(a)?.votePct ?? 0,
          historicalValues.get(a)?.votePct ?? 0,
        );
        const voteB = Math.max(
          latestValues.get(b)?.votePct ?? 0,
          historicalValues.get(b)?.votePct ?? 0,
        );
        if (voteA !== voteB) return voteB - voteA;
        const seatsA = Math.max(
          latestValues.get(a)?.seats ?? 0,
          historicalValues.get(a)?.seats ?? 0,
        );
        const seatsB = Math.max(
          latestValues.get(b)?.seats ?? 0,
          historicalValues.get(b)?.seats ?? 0,
        );
        return seatsB - seatsA;
      }),
    [allPartyIds, historicalValues, latestValues],
  );

  const defaultPartyIds = useMemo(() => {
    const competitive = rankedPartyIds.filter((id) => {
      const maxVote = Math.max(
        latestValues.get(id)?.votePct ?? 0,
        historicalValues.get(id)?.votePct ?? 0,
      );
      const maxSeats = Math.max(
        latestValues.get(id)?.seats ?? 0,
        historicalValues.get(id)?.seats ?? 0,
      );
      return maxVote >= 3 || maxSeats > 0;
    });
    return (competitive.length > 0 ? competitive : rankedPartyIds).slice(0, 5);
  }, [historicalValues, latestValues, rankedPartyIds]);

  const [manualPartyIds, setManualPartyIds] = useState<Set<string> | null>(null);
  useEffect(() => setManualPartyIds(null), [showAll, territory.id]);

  const visiblePartyIds = useMemo(() => {
    const selected = manualPartyIds
      ? [...manualPartyIds].filter((id) => allPartyIds.includes(id))
      : showAll
        ? [...allPartyIds]
        : [...defaultPartyIds];
    return selected.sort((a, b) => {
      const valueA = latestValues.get(a)?.[metric] ?? historicalValues.get(a)?.[metric] ?? 0;
      const valueB = latestValues.get(b)?.[metric] ?? historicalValues.get(b)?.[metric] ?? 0;
      return valueB - valueA;
    });
  }, [allPartyIds, defaultPartyIds, historicalValues, latestValues, manualPartyIds, metric, showAll]);

  const toggleParty = (partyId: string) => {
    const next = new Set(visiblePartyIds);
    if (next.has(partyId)) {
      if (next.size === 1) return;
      next.delete(partyId);
    } else {
      next.add(partyId);
    }
    setManualPartyIds(next);
  };

  const ranking = useMemo(
    () =>
      [...latestValues.values()].sort((a, b) => b[metric] - a[metric]),
    [latestValues, metric],
  );

  if (loading && !latest) {
    return (
      <article className="territory-card loading-card" aria-busy="true">
        <div className="skeleton title-skeleton" />
        <div className="skeleton chart-skeleton" />
      </article>
    );
  }

  return (
    <article className="territory-card">
      <header className="card-header">
        <div>
          <p>{territory.kind === "country" ? "Total nacional" : "Provincia"}</p>
          <h2>{territory.name}</h2>
        </div>
        <div className="scrutiny-badge">
          <strong>{latest ? `${formatNumber(latest.scrutinyPct, 2)}%` : "—"}</strong>
          <span>escrutado</span>
        </div>
      </header>

      {latest ? (
        <>
          <div className="chart-context">
            <span><i className="line-key current-line" />29N</span>
            <span><i className="line-key historical-line" />23J</span>
            <small>Envío {latest.envio} · {formatTimestamp(latest.timestamp)} · Eje Y adaptado</small>
          </div>
          <ScrutinyChart
            current={current?.snapshots ?? []}
            historical={historical?.snapshots ?? []}
            parties={parties}
            visiblePartyIds={visiblePartyIds}
            metric={metric}
          />
          <div className="party-legend" aria-label="Seleccionar partidos de la gráfica">
            {rankedPartyIds.map((id) => {
              const party = partyMap.get(id);
              const active = visiblePartyIds.includes(id);
              return (
                <button
                  type="button"
                  className={active ? "active" : ""}
                  aria-pressed={active}
                  onClick={() => toggleParty(id)}
                  key={id}
                >
                  <i style={{ backgroundColor: party?.color ?? "#64748b" }} />
                  {party?.label ?? id}
                  {party?.historyLabel ? <small>23J: {party.historyLabel}</small> : null}
                </button>
              );
            })}
          </div>

          <details className="ranking-disclosure">
            <summary>
              <span>
                <strong>Último envío</strong>
                <small>{ranking.length} partidos</small>
              </span>
              <i aria-hidden="true" />
            </summary>
            <div className="ranking-table" role="table" aria-label={`Resultados actuales en ${territory.name}`}>
              {ranking.map((row, index) => {
                const party = partyMap.get(row.partyId);
                return (
                  <div className="ranking-row" role="row" key={row.partyId}>
                    <span className="rank" role="cell">{index + 1}</span>
                    <span className="party-name" role="cell">
                      <i style={{ backgroundColor: party?.color ?? "#64748b" }} />
                      {party?.label ?? row.partyId}
                    </span>
                    <span className="party-vote" role="cell">{formatNumber(row.votePct, 2)}%</span>
                    <strong role="cell">{formatNumber(row.seats)} esc.</strong>
                  </div>
                );
              })}
            </div>
          </details>
        </>
      ) : (
        <div className="empty-card">
          <strong>Esperando datos del 29N</strong>
          <p>El histórico del 23J está preparado y aparecerá junto al primer envío completo.</p>
        </div>
      )}
    </article>
  );
}

