export type TerritoryKind = "country" | "province";

export interface TerritoryInfo {
  id: string;
  name: string;
  kind: TerritoryKind;
}

export interface PartyMeta {
  id: string;
  label: string;
  color: string;
  colorPastel: string;
  colorDark: string;
  historyLabel?: string;
}

export interface PartyValue {
  partyId: string;
  votePct: number;
  seats: number;
  votes?: number;
}

export interface ElectionSnapshot {
  envio: number;
  timestamp: string;
  scrutinyPct: number;
  parties: PartyValue[];
}

export interface TerritorySeries {
  territory: TerritoryInfo;
  snapshots: ElectionSnapshot[];
}

export interface HistoryManifest {
  source: string;
  generatedAt: string;
  territories: TerritoryInfo[];
  parties: string[];
}

export interface LatestState {
  envio: number | null;
  timestamp: string | null;
  relevantRows: number;
  complete: boolean;
}

export interface MetaResponse {
  territories: TerritoryInfo[];
  parties: PartyMeta[];
  latest: LatestState;
  pollIntervalMs: number;
}

export interface SeriesResponse {
  election: "29N";
  territories: TerritorySeries[];
  latest: LatestState;
}

export interface HistoryResponse {
  election: "23J";
  territories: TerritorySeries[];
}

export interface EnvioEvent {
  envio: number;
  timestamp: string;
}

export interface LastSeatContender {
  partyId: string;
  candidatureCode: string;
  votesNeeded: number;
  censusPoints: number;
}

export interface PenultimateSeatBattle {
  holderPartyId: string;
  holderCandidatureCode: string;
  contender: LastSeatContender;
}

export interface LastSeatBattle {
  territory: TerritoryInfo;
  scrutinyPct: number;
  dataAvailable?: boolean;
  holderPartyId: string;
  holderCandidatureCode: string;
  contenders: LastSeatContender[];
  penultimate?: PenultimateSeatBattle;
}

export interface LastSeatFrame {
  envio: number;
  timestamp: string;
  battles: LastSeatBattle[];
}

export interface LastSeatResponse {
  election: "29N";
  envio: number | null;
  timestamp: string | null;
  thresholdCensusPoints: number;
  availableEnvios: Array<{ envio: number; timestamp: string }>;
  provinceOrder: string[];
  battles: LastSeatBattle[];
}

