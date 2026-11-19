import { useMemo } from "react";
import type {
  LastSeatResponse,
  PartyMeta,
} from "../../../shared/types.js";
import { formatNumber, formatTimestamp } from "../format.js";

interface Props {
  data: LastSeatResponse | null;
  parties: PartyMeta[];
  loading: boolean;
  onEnvioChange: (envio?: number) => void;
}

export function LastSeatSection({
  data,
  parties,
  loading,
  onEnvioChange,
}: Props) {
  const partyMap = useMemo(
    () => new Map(parties.map((party) => [party.id, party])),
    [parties],
  );
  const battles = data?.battles ?? [];
  const availableEnvios = data?.availableEnvios ?? [];
  const selectedIndex = Math.max(
    0,
    availableEnvios.findIndex((item) => item.envio === data?.envio),
  );
  const liveIndex = Math.max(0, availableEnvios.length - 1);
  const isLive = availableEnvios.length > 0 && selectedIndex === liveIndex;
  const multiPartyBattles = battles.filter(
    (battle) => battle.contenders.length >= 2,
  ).length;

  return (
    <section className="last-seat-section" id="ultimo-escano">
      <header className="section-heading">
        <div>
          <p className="section-kicker">Reparto provincial</p>
          <h2>La batalla por el último escaño</h2>
          <p>
            Hasta tres aspirantes situados a menos de cuatro puntos sobre el
            censo. Las provincias se ordenan por la amenaza más cercana.
          </p>
        </div>
        <div className="battle-summary">
          <strong>{battles.length}</strong>
          <span>provincias en el umbral</span>
          <small>{multiPartyBattles} con varios aspirantes</small>
        </div>
      </header>

      {loading && !data ? (
        <div className="battle-card battle-loading" aria-busy="true">
          <div className="skeleton chart-skeleton" />
        </div>
      ) : battles.length > 0 ? (
        <div className="battle-card">
          <div className="battle-timeline" aria-busy={loading}>
            <div className="timeline-heading">
              <div>
                <span>Línea temporal</span>
                <strong>
                  Envío {data?.envio ?? "—"} · {formatTimestamp(data?.timestamp ?? null)}
                </strong>
              </div>
              <div className="timeline-actions">
                <button
                  type="button"
                  disabled={selectedIndex <= 0 || loading}
                  onClick={() => onEnvioChange(availableEnvios[selectedIndex - 1]?.envio)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={selectedIndex >= liveIndex || loading}
                  onClick={() => onEnvioChange(availableEnvios[selectedIndex + 1]?.envio)}
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  className={isLive ? "live-button active" : "live-button"}
                  disabled={isLive || loading}
                  onClick={() => onEnvioChange()}
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
              onChange={(event) => {
                const item = availableEnvios[Number(event.target.value)];
                if (item) onEnvioChange(item.envio);
              }}
            />
            <div className="timeline-scale">
              <span>Envío {availableEnvios[0]?.envio ?? "—"}</span>
              <span>{availableEnvios.length} envíos completos</span>
              <span>Envío {availableEnvios.at(-1)?.envio ?? "—"}</span>
            </div>
          </div>
          <div className="battle-meta">
            <span>Envío {data?.envio ?? "—"}</span>
            <span>{formatTimestamp(data?.timestamp ?? null)}</span>
            <span>Distancia en puntos sobre el censo</span>
          </div>
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
                <span>Tiene el escaño</span>
              </div>

              {battles.map((battle) => {
                const holder = partyMap.get(battle.holderPartyId);
                const rowHeight = Math.max(58, battle.contenders.length * 25 + 14);
                return (
                  <div
                    className="battle-row"
                    key={battle.territory.id}
                    style={{ minHeight: `${rowHeight}px` }}
                  >
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
                        const left =
                          100 -
                          (100 * contender.censusPoints) /
                            (data?.thresholdCensusPoints ?? 4);
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
                            title={`${contender.votesNeeded.toLocaleString("es-ES")} votos para disputar el último escaño`}
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
                      <i style={{ backgroundColor: holder?.color ?? "#64748b" }} />
                      <strong>{holder?.label ?? battle.holderPartyId}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="battle-card empty-battle">
          <strong>No hay provincias dentro del umbral de cuatro puntos.</strong>
        </div>
      )}
    </section>
  );
}

