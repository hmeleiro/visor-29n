import type { RowDataPacket } from "mysql2";
import type {
  ElectionSnapshot,
  LastSeatBattle,
  PartyMeta,
  PartyValue,
  TerritoryInfo,
  TerritorySeries,
} from "../shared/types.js";

export interface CandidateRecord {
  code: string;
  recode: string;
  color: string;
  colorPastel: string;
  colorDark: string;
}

export type CandidateMap = ReadonlyMap<string, CandidateRecord>;

export interface WideResultRow extends RowDataPacket {
  n_envio: number;
  timestamp: string;
  ccaa_prov: "PR" | "TO";
  codigo_provincia: string;
  provincia: string;
  censo_escrutado_pct: number | string | null;
  censo: number | string | null;
  ultimo_codigo_candidatura: string | null;
  [key: string]: unknown;
}

export function buildLastSeatBattles(
  rows: WideResultRow[],
  candidates: CandidateMap,
  thresholdCensusPoints = 4,
  maximumContenders = 3,
  includeOutsideThreshold = false,
): LastSeatBattle[] {
  const battles: LastSeatBattle[] = [];

  for (const row of rows) {
    if (row.ccaa_prov !== "PR") continue;
    const census = numeric(row.censo);
    const holderCode = String(row.ultimo_codigo_candidatura ?? "").trim();
    if (!holderCode || holderCode === "0000" || census <= 0) continue;

    let holderSlot: number | null = null;
    for (let slot = 1; slot <= 80; slot += 1) {
      if (String(row[`codigo_candidatura_${slot}`] ?? "").trim() === holderCode) {
        holderSlot = slot;
        break;
      }
    }
    if (holderSlot === null) continue;

    const holderVotes = numeric(row[`votos_${holderSlot}`]);
    const holderSeats = numeric(row[`diputados_${holderSlot}`]);
    if (holderVotes <= 0 || holderSeats <= 0) continue;
    const lastSeatQuotient = holderVotes / holderSeats;

    // Reconstruct the awarded D'Hondt quotients to identify the seat just
    // before the last one. This lets the UI show the second contest (for
    // example, the last-seat holder trying to take the penultimate seat).
    const awardedSeats: Array<{
      quotient: number;
      partyId: string;
      candidatureCode: string;
      seatNumber: number;
    }> = [];
    for (let slot = 1; slot <= 80; slot += 1) {
      const code = String(row[`codigo_candidatura_${slot}`] ?? "").trim();
      if (!code || code === "0000") continue;
      const votes = numeric(row[`votos_${slot}`]);
      const seats = numeric(row[`diputados_${slot}`]);
      const partyId = candidates.get(code)?.recode || "Sin recodificar";
      for (let seatNumber = 1; seatNumber <= seats; seatNumber += 1) {
        awardedSeats.push({
          quotient: votes / seatNumber,
          partyId,
          candidatureCode: code,
          seatNumber,
        });
      }
    }
    awardedSeats.sort((a, b) => b.quotient - a.quotient);
    const lastAward = awardedSeats.find(
      (seat) =>
        seat.candidatureCode === holderCode && seat.seatNumber === holderSeats,
    );
    const penultimateAward = lastAward
      ? awardedSeats.filter((seat) => seat !== lastAward).at(-1)
      : undefined;

    const contendersByParty = new Map<string, LastSeatBattle["contenders"][number]>();
    for (let slot = 1; slot <= 80; slot += 1) {
      const code = String(row[`codigo_candidatura_${slot}`] ?? "").trim();
      if (!code || code === "0000" || code === holderCode) continue;

      const seats = numeric(row[`diputados_${slot}`]);
      const votePct = numeric(row[`votos_pct_${slot}`]);
      // El reparto al Congreso exige superar el umbral provincial. Una
      // candidatura que todavía no es elegible no se presenta como contendiente.
      if (seats <= 0 && votePct < 3) continue;

      const votes = numeric(row[`votos_${slot}`]);
      const votesNeeded = Math.max(
        0,
        Math.ceil(lastSeatQuotient * (seats + 1) - votes),
      );
      const censusPoints = (100 * votesNeeded) / census;
      if (!Number.isFinite(censusPoints) || censusPoints > thresholdCensusPoints) {
        continue;
      }

      const partyId = candidates.get(code)?.recode || "Sin recodificar";
      const contender = { partyId, candidatureCode: code, votesNeeded, censusPoints };
      const previous = contendersByParty.get(partyId);
      if (!previous || contender.censusPoints < previous.censusPoints) {
        contendersByParty.set(partyId, contender);
      }
    }

    const contenders = [...contendersByParty.values()]
      .sort((a, b) => a.censusPoints - b.censusPoints)
      .slice(0, maximumContenders);
    if (contenders.length === 0 && !includeOutsideThreshold) continue;

    let penultimateContender: LastSeatBattle["penultimate"];
    const holderPartyId = candidates.get(holderCode)?.recode || "Sin recodificar";
    if (penultimateAward && penultimateAward.partyId !== holderPartyId) {
      // Esta segunda distancia responde a una pregunta concreta: cuánto le
      // falta al partido que ya posee el último escaño para ganar otro y
      // alcanzar el penúltimo. No se sustituye por un tercer partido más cercano.
      const votesNeeded = Math.max(
        0,
        Math.ceil(penultimateAward.quotient * (holderSeats + 1) - holderVotes),
      );
      const censusPoints = (100 * votesNeeded) / census;
      if (
        Number.isFinite(censusPoints) &&
        censusPoints <= thresholdCensusPoints
      ) {
        penultimateContender = {
          holderPartyId: penultimateAward.partyId,
          holderCandidatureCode: penultimateAward.candidatureCode,
          contender: {
            partyId: holderPartyId,
            candidatureCode: holderCode,
            votesNeeded,
            censusPoints,
          },
        };
      }
    }

    const battle: LastSeatBattle = {
      territory: territoryFromRow(row),
      scrutinyPct: numeric(row.censo_escrutado_pct),
      holderPartyId,
      holderCandidatureCode: holderCode,
      contenders,
    };
    if (penultimateContender) battle.penultimate = penultimateContender;
    battles.push(battle);
  }

  return sortLastSeatBattles(battles);
}

export function sortLastSeatBattles(
  battles: LastSeatBattle[],
  referenceOrder?: ReadonlyMap<string, number>,
): LastSeatBattle[] {
  return [...battles].sort((a, b) => {
    if (referenceOrder) {
      const aOrder = referenceOrder.get(a.territory.id) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = referenceOrder.get(b.territory.id) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }

    const aDistance = a.contenders[0]?.censusPoints ?? Number.POSITIVE_INFINITY;
    const bDistance = b.contenders[0]?.censusPoints ?? Number.POSITIVE_INFINITY;
    const distance = aDistance - bDistance;
    return distance || a.territory.name.localeCompare(b.territory.name, "es");
  });
}

function numeric(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function territoryFromRow(row: WideResultRow): TerritoryInfo {
  if (row.ccaa_prov === "TO") {
    return { id: "ES", name: "España", kind: "country" };
  }

  return {
    id: String(row.codigo_provincia).padStart(2, "0"),
    name: row.provincia,
    kind: "province",
  };
}

export function normalizeWideRows(
  rows: WideResultRow[],
  candidates: CandidateMap,
  onUnknownCode?: (code: string) => void,
): TerritorySeries[] {
  const territories = new Map<
    string,
    { territory: TerritoryInfo; snapshots: Map<number, ElectionSnapshot> }
  >();

  for (const row of rows) {
    const territory = territoryFromRow(row);
    let series = territories.get(territory.id);
    if (!series) {
      series = { territory, snapshots: new Map() };
      territories.set(territory.id, series);
    }

    const accumulated = new Map<string, PartyValue>();
    for (let slot = 1; slot <= 80; slot += 1) {
      const rawCode = row[`codigo_candidatura_${slot}`];
      const code = rawCode == null ? "" : String(rawCode).trim();
      if (!code || code === "0000") continue;

      const candidate = candidates.get(code);
      const partyId = candidate?.recode || "Sin recodificar";
      if (!candidate) onUnknownCode?.(code);

      const current = accumulated.get(partyId) ?? {
        partyId,
        votePct: 0,
        seats: 0,
        votes: 0,
      };
      current.votePct += numeric(row[`votos_pct_${slot}`]);
      current.seats += numeric(row[`diputados_${slot}`]);
      current.votes = (current.votes ?? 0) + numeric(row[`votos_${slot}`]);
      accumulated.set(partyId, current);
    }

    series.snapshots.set(Number(row.n_envio), {
      envio: Number(row.n_envio),
      timestamp: String(row.timestamp ?? ""),
      scrutinyPct: numeric(row.censo_escrutado_pct),
      parties: [...accumulated.values()].sort((a, b) =>
        a.partyId.localeCompare(b.partyId, "es"),
      ),
    });
  }

  return [...territories.values()]
    .map(({ territory, snapshots }) => ({
      territory,
      snapshots: [...snapshots.values()].sort((a, b) => a.envio - b.envio),
    }))
    .sort((a, b) => {
      if (a.territory.kind !== b.territory.kind) {
        return a.territory.kind === "country" ? -1 : 1;
      }
      return a.territory.id.localeCompare(b.territory.id, "es");
    });
}

const FALLBACK_COLORS = [
  "#6D5BD0",
  "#D9485F",
  "#0F8B8D",
  "#E08E0B",
  "#4B7BEC",
  "#9B51E0",
  "#2D9D78",
  "#B14AED",
  "#C05640",
  "#577590",
];

function fallbackColor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function buildPartyCatalog(
  records: CandidateRecord[],
  historicalIds: string[],
): PartyMeta[] {
  const catalog = new Map<string, PartyMeta>();

  for (const record of records) {
    if (!record.recode || catalog.has(record.recode)) continue;
    catalog.set(record.recode, {
      id: record.recode,
      label: record.recode,
      color: record.color || fallbackColor(record.recode),
      colorPastel: record.colorPastel || record.color || fallbackColor(record.recode),
      colorDark: record.colorDark || record.color || fallbackColor(record.recode),
      ...(record.recode === "FA" ? { historyLabel: "Sumar" } : {}),
    });
  }

  for (const id of historicalIds) {
    if (catalog.has(id)) continue;
    const color = fallbackColor(id);
    catalog.set(id, {
      id,
      label: id,
      color,
      colorPastel: color,
      colorDark: color,
      ...(id === "FA" ? { historyLabel: "Sumar" } : {}),
    });
  }

  return [...catalog.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es"),
  );
}

