import { useEffect, useMemo, useRef, useState } from "react";
import type { LastSeatFrame, LastSeatResponse, LatestState } from "../../shared/types.js";
import { fetchLastSeat, fetchLastSeatFrames } from "./api.js";

const batchSize = 8;
const cacheLimit = 64;
export const provinceBattleThreshold = 2.5;
const emptyEnvios: LastSeatResponse["availableEnvios"] = [];

type Envio = Pick<LastSeatFrame, "envio" | "timestamp">;
type FrameRequest = { controller: AbortController; keys: Set<string> };

function frameKey({ envio, timestamp }: Envio) {
  return `${envio}:${timestamp}`;
}

function storeFrames(cache: Map<string, LastSeatFrame>, frames: LastSeatFrame[]) {
  const updated = new Map(cache);
  for (const frame of frames) {
    const key = frameKey(frame);
    updated.delete(key);
    updated.set(key, frame);
  }
  while (updated.size > cacheLimit) {
    const oldest = updated.keys().next();
    if (oldest.done) break;
    updated.delete(oldest.value);
  }
  return updated;
}

export function useLastSeatTimeline(
  latest: LatestState | undefined,
  initialLive?: LastSeatResponse | null,
) {
  const [live, setLive] = useState<LastSeatResponse | null>(initialLive ?? null);
  const [liveError, setLiveError] = useState(false);
  const [retryLive, setRetryLive] = useState(0);
  const [selection, setSelection] = useState<number | null>(null);
  const [cache, setCache] = useState(() => new Map<string, LastSeatFrame>());
  const [failed, setFailed] = useState(() => new Set<string>());
  const [completedRequests, setCompletedRequests] = useState(0);
  const requests = useRef<{ selected?: FrameRequest; nearby?: FrameRequest }>({});
  const lastDisplayed = useRef<LastSeatFrame | null>(null);

  const ready = latest !== undefined;
  const latestEnvio = latest?.envio;
  const latestTimestamp = latest?.timestamp;
  useEffect(() => {
    if (!ready) return;
    if (
      retryLive === 0 &&
      initialLive &&
      initialLive.envio === latestEnvio &&
      initialLive.timestamp === latestTimestamp
    ) {
      setLive(initialLive);
      const { envio, timestamp, battles } = initialLive;
      if (envio !== null && timestamp !== null) {
        setCache((previous) => storeFrames(previous, [{ envio, timestamp, battles }]));
      }
      return;
    }
    const controller = new AbortController();
    setLiveError(false);
    fetchLastSeat(undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLive(response);
        const { envio, timestamp, battles } = response;
        if (envio !== null && timestamp !== null) {
          setCache((previous) => storeFrames(previous, [{ envio, timestamp, battles }]));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLiveError(true);
      });
    return () => controller.abort();
  }, [ready, latestEnvio, latestTimestamp, retryLive, initialLive]);

  const availableEnvios = live?.availableEnvios ?? emptyEnvios;
  const liveIndex = availableEnvios.length - 1;
  const requestedIndex = availableEnvios.findIndex((item) => item.envio === selection);
  const selectedIndex = requestedIndex < 0 ? liveIndex : requestedIndex;
  const selected = availableEnvios[selectedIndex];
  const selectedKey = selected ? frameKey(selected) : undefined;
  const frame = selectedKey ? cache.get(selectedKey) : undefined;

  useEffect(() => () => {
    requests.current.selected?.controller.abort();
    requests.current.nearby?.controller.abort();
    requests.current = {};
  }, []);

  useEffect(() => {
    if (!selected) return;

    function needsFrame(item: Envio) {
      const key = frameKey(item);
      return !cache.has(key) && !failed.has(key)
        && !requests.current.selected?.keys.has(key)
        && !requests.current.nearby?.keys.has(key);
    }

    function requestFrames(kind: "selected" | "nearby", wanted: Envio[]) {
      const controller = new AbortController();
      const keys = new Set(wanted.map(frameKey));
      requests.current[kind] = { controller, keys };
      function markFailed(missing: string[]) {
        if (missing.length && !controller.signal.aborted) {
          setFailed((previous) => new Set([...previous, ...missing]));
        }
      }

      fetchLastSeatFrames(wanted.map((item) => item.envio), controller.signal)
        .then((frames) => {
          if (controller.signal.aborted) return;
          const returned = new Set(frames.map(frameKey));
          setCache((previous) => storeFrames(previous, frames));
          markFailed([...keys].filter((key) => !returned.has(key)));
        })
        .catch(() => markFailed([...keys]))
        .finally(() => {
          if (!controller.signal.aborted) {
            delete requests.current[kind];
            setCompletedRequests((previous) => previous + 1);
          }
        });
    }

    // A jump away from a batch in flight can still load the selected frame first.
    if (!requests.current.selected && needsFrame(selected)) {
      requestFrames("selected", [selected]);
    }

    if (requests.current.nearby) return;
    const nearby: Envio[] = [];
    for (let distance = 1; distance < batchSize; distance += 1) {
      const before = availableEnvios[selectedIndex - distance];
      const after = availableEnvios[selectedIndex + distance];
      if (before && needsFrame(before)) nearby.push(before);
      if (after && needsFrame(after)) nearby.push(after);
    }
    if (nearby.length) requestFrames("nearby", nearby.slice(0, batchSize));
  }, [availableEnvios, selected, selectedIndex, cache, failed, completedRequests]);

  useEffect(() => {
    if (frame) lastDisplayed.current = frame;
  }, [frame]);

  const displayed = frame ?? (selected ? lastDisplayed.current : null);
  const provinceOrder = live?.provinceOrder;
  const battles = useMemo(() => {
    if (!displayed) return [];
    const rank = new Map(
      (provinceOrder ?? []).map((id, index) => [id, index]),
    );
    return displayed.battles
      .filter((battle) =>
        battle.contenders.some(
          (contender) => contender.censusPoints < provinceBattleThreshold,
        ),
      )
      .sort((a, b) =>
        (rank.get(a.territory.id) ?? rank.size) -
        (rank.get(b.territory.id) ?? rank.size),
      );
  }, [displayed, provinceOrder]);

  function selectEnvio(envio?: number) {
    setSelection(envio === undefined || envio === live?.envio ? null : envio);
  }

  function retry() {
    if (liveError) setRetryLive((previous) => previous + 1);
    if (selectedKey) {
      setFailed((previous) => {
        const updated = new Set(previous);
        updated.delete(selectedKey);
        return updated;
      });
    }
  }

  return {
    live,
    liveError,
    availableEnvios,
    liveIndex,
    selectedIndex,
    selected,
    displayed,
    battles,
    frameError: selectedKey !== undefined && !frame && failed.has(selectedKey),
    loadingFrame: Boolean(selected && !frame),
    selectEnvio,
    retry,
  };
}
