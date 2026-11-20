import { memo, useEffect, useMemo, useState } from "react";
import type {
  LastSeatBattle,
  LastSeatResponse,
  LatestState,
  PartyMeta,
} from "../../../shared/types.js";
import { formatNumber, formatTimestamp } from "../format.js";
import {
  provinceBattleThreshold,
  useLastSeatTimeline,
} from "../useLastSeatTimeline.js";

interface Props {
  latest?: LatestState;
  parties: PartyMeta[];
  initialLive?: LastSeatResponse | null;
}

export function LastSeatSection({ latest, parties, initialLive }: Props) {
  const {
    live, liveError, availableEnvios, liveIndex, selectedIndex,
    selected, displayed, battles, frameError, loadingFrame, selectEnvio, retry,
  } = useLastSeatTimeline(latest, initialLive);
  const partyMap = useMemo(
    () => new Map(parties.map((party) => [party.id, party])),
    [parties],
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const isLive = availableEnvios.length > 0 && selectedIndex === liveIndex;

  function selectManually(envio?: number) {
    setIsPlaying(false);
    selectEnvio(envio);
  }

  useEffect(() => {
    function handleGlobalTimelineKey(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        availableEnvios.length <= 1 ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input:not([type="range"]), textarea, select, [contenteditable="true"]',
        )
      ) {
        return;
      }

      event.preventDefault();
      setIsPlaying(false);
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex = Math.max(
        0,
        Math.min(liveIndex, selectedIndex + direction),
      );
      if (nextIndex !== selectedIndex) {
        selectEnvio(availableEnvios[nextIndex]?.envio);
      }
    }

    window.addEventListener("keydown", handleGlobalTimelineKey);
    return () => window.removeEventListener("keydown", handleGlobalTimelineKey);
  }, [availableEnvios, liveIndex, selectedIndex, selectEnvio]);

  useEffect(() => {
    if (!isPlaying || !selected) return;
    if (frameError || selectedIndex >= liveIndex) {
      setIsPlaying(false);
      return;
    }
    if (loadingFrame || displayed?.envio !== selected.envio) return;

    const timer = window.setTimeout(() => {
      selectEnvio(availableEnvios[selectedIndex + 1]?.envio);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    availableEnvios,
    displayed?.envio,
    frameError,
    isPlaying,
    liveIndex,
    loadingFrame,
    selected,
    selectedIndex,
    selectEnvio,
  ]);

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const firstEnvio = availableEnvios[0]?.envio;
    if (firstEnvio === undefined) return;
    selectEnvio(firstEnvio);
    setIsPlaying(true);
  }

  const multiPartyBattles = battles.filter(
    (battle) => battle.contenders.length >= 2,
  ).length;
  const penultimateBattles = battles.filter(
    (battle) => battle.penultimate,
  ).length;

  return (
    <section
      className="last-seat-section"
      id="ultimo-escano"
      aria-keyshortcuts="ArrowLeft ArrowRight"
    >
      <header className="section-heading">
        <div>
          <p className="section-kicker">Reparto provincial</p>
          <h2>La batalla por el último escaño</h2>
          <p>
            Se muestran hasta tres aspirantes situados a menos de 4 puntos sobre el
            censo en las provincias donde existe al menos un aspirante a menos de 2,5 puntos.
          </p>
        </div>
        <div className="battle-summary">
          <strong>{battles.length}</strong>
          <span>provincias con aspirantes</span>
          <small>
            A menos de {formatNumber(provinceBattleThreshold, 1)} pp del último
            escaño · {multiPartyBattles} con varios aspirantes · {penultimateBattles + " "}
            con disputa del penúltimo
          </small>
        </div>
      </header>

      {!live && !liveError ? (
        <div className="battle-card battle-loading" aria-busy="true">
          <div className="skeleton chart-skeleton" />
        </div>
      ) : selected ? (
        <div className="battle-card">
          <div className="battle-timeline">
            <div className="timeline-heading">
              <div>
                <span>Línea temporal</span>
                <strong>
                  Envío {selected.envio} · {formatTimestamp(selected.timestamp)}
                </strong>
              </div>
              <div className="timeline-actions">
                <button
                  type="button"
                  className={isPlaying ? "playback-button playing" : "playback-button"}
                  disabled={availableEnvios.length <= 1}
                  aria-pressed={isPlaying}
                  onClick={togglePlayback}
                >
                  <i aria-hidden="true" />
                  {isPlaying ? "Pausar" : "Reproducir"}
                </button>
                <button
                  type="button"
                  disabled={selectedIndex === 0}
                  onClick={() => selectManually(availableEnvios[selectedIndex - 1]?.envio)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={isLive}
                  onClick={() => selectManually(availableEnvios[selectedIndex + 1]?.envio)}
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  className={isLive ? "live-button active" : "live-button"}
                  disabled={isLive}
                  onClick={() => selectManually()}
                >
                  {isLive ? "En directo" : "Volver al directo"}
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={liveIndex}
              step={1}
              value={selectedIndex}
              disabled={availableEnvios.length <= 1}
              aria-label="Seleccionar envío del escrutinio"
              aria-valuetext={`Envío ${selected.envio}`}
              onChange={(event) => {
                selectManually(availableEnvios[Number(event.target.value)]?.envio);
              }}
            />
            <div className="timeline-scale">
              <span>Envío {availableEnvios[0]?.envio ?? "—"}</span>
              <span>{availableEnvios.length} envíos completos · ← → para navegar</span>
              <span>Envío {availableEnvios.at(-1)?.envio ?? "—"}</span>
            </div>
          </div>
          <div className="battle-meta">
            <span>Mostrando envío {displayed?.envio ?? "—"}</span>
            {frameError || liveError ? (
              <button type="button" onClick={retry}>Reintentar carga</button>
            ) : loadingFrame ? (
              <span role="status">Cargando envío {selected.envio}…</span>
            ) : (
              <span>{formatTimestamp(displayed?.timestamp ?? null)}</span>
            )}
            <span>Distancia en puntos sobre el censo</span>
          </div>
          <BattleTable
            battles={battles}
            partyMap={partyMap}
            threshold={live?.thresholdCensusPoints ?? 4}
          />
        </div>
      ) : (
        <div className="battle-card empty-battle">
          {liveError ? (
            <button type="button" onClick={retry}>Reintentar carga de envíos</button>
          ) : (
            <strong>Todavía no hay envíos provinciales completos.</strong>
          )}
        </div>
      )}
    </section>
  );
}

const BattleTable = memo(function BattleTable({
  battles,
  partyMap,
  threshold,
}: {
  battles: LastSeatBattle[];
  partyMap: ReadonlyMap<string, PartyMeta>;
  threshold: number;
}) {
  if (battles.length === 0) {
    return (
      <div className="empty-battle">
        <strong>
          No hay provincias con aspirantes a menos de {formatNumber(provinceBattleThreshold, 1)} pp.
        </strong>
      </div>
    );
  }

  return (
    <div className="battle-scroll">
      <div className="battle-table">
        <div className="battle-axis-row">
          <span>Provincia</span>
          <div className="battle-axis">
            {[4, 3, 2, 1, 0].map((tick, index) => (
              <span key={tick} style={{ left: `${index * 25}%` }}>
                {tick === 0 ? "último escaño" : `a ${tick} pp`}
              </span>
            ))}
          </div>
          <span>Escaños actuales</span>
        </div>

        {battles.map((battle) => {
          const holder = partyMap.get(battle.holderPartyId);
          return (
            <div className="battle-row" key={battle.territory.id}>
              <div className="battle-province">
                <strong>{battle.territory.name}</strong>
                <span>{formatNumber(battle.scrutinyPct, 2)}% escrutado</span>
              </div>
              <div className="battle-plot">
                {[0, 25, 50, 75, 100].map((left) => (
                  <i className="battle-gridline" key={left} style={{ left: `${left}%` }} />
                ))}
                {battle.contenders.map((contender, index) => {
                  const party = partyMap.get(contender.partyId);
                  const left = 100 - (100 * contender.censusPoints) / threshold;
                  const labelOnRight = left < 22;
                  return (
                    <div
                      className={`battle-contender${labelOnRight ? " label-right" : ""}`}
                      key={contender.candidatureCode}
                      style={{
                        left: `${Math.max(0, Math.min(100, left))}%`,
                        top: `${8 + index * 25}px`,
                        color: party?.colorDark ?? party?.color ?? "#64748b",
                      }}
                      title={`${formatNumber(contender.votesNeeded)} votos para disputar el último escaño`}
                    >
                      <span>
                        {party?.label ?? contender.partyId} a {formatNumber(contender.censusPoints, 2)} pp
                      </span>
                      <i style={{ backgroundColor: party?.color ?? "#64748b" }} />
                    </div>
                  );
                })}
              </div>
              <div className="battle-holder">
                <div className="battle-holder-main">
                  <i style={{ backgroundColor: holder?.color ?? "#64748b" }} />
                  <strong>{holder?.label ?? battle.holderPartyId}</strong>
                </div>
                {battle.penultimate ? (
                  <div
                    className="battle-penultimate"
                    title={`${holder?.label ?? battle.holderPartyId} necesita ${formatNumber(battle.penultimate.contender.votesNeeded)} votos para alcanzar el penúltimo escaño`}
                  >
                    <span>
                      a {formatNumber(battle.penultimate.contender.censusPoints, 2)} pp del penúltimo ({partyMap.get(battle.penultimate.holderPartyId)?.label ?? battle.penultimate.holderPartyId})
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

