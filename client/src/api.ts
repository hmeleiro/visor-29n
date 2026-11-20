import type {
  HistoryResponse,
  LastSeatFrame,
  LastSeatResponse,
  MetaResponse,
  SeriesResponse,
} from "../../shared/types.js";

async function fetchJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error || `Error HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function territoryQuery(ids: string[]): string {
  return encodeURIComponent(ids.join(","));
}

export function fetchMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return fetchJson<MetaResponse>("/api/meta", signal);
}

export function fetchSeries(
  territoryIds: string[],
  after?: number,
  signal?: AbortSignal,
): Promise<SeriesResponse> {
  const afterQuery = after === undefined ? "" : `&after=${after}`;
  return fetchJson<SeriesResponse>(
    `/api/series?territories=${territoryQuery(territoryIds)}${afterQuery}`,
    signal,
  );
}

export function fetchHistory(
  territoryIds: string[],
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  return fetchJson<HistoryResponse>(
    `/api/history?territories=${territoryQuery(territoryIds)}`,
    signal,
  );
}

export function fetchLastSeat(
  envio?: number,
  signal?: AbortSignal,
): Promise<LastSeatResponse> {
  const query = envio === undefined ? "" : `?envio=${envio}`;
  return fetchJson<LastSeatResponse>(`/api/last-seat${query}`, signal);
}

export function fetchLastSeatFrames(
  envios: number[],
  signal: AbortSignal,
): Promise<LastSeatFrame[]> {
  return fetchJson<LastSeatFrame[]>(
    `/api/last-seat/frames?envios=${envios.join(",")}`,
    signal,
  );
}

