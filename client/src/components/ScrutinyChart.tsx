import { useEffect, useMemo, useRef } from "react";
import { LineChart, type LineSeriesOption } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type {
  ElectionSnapshot,
  PartyMeta,
} from "../../../shared/types.js";
import { formatNumber, formatTimestamp } from "../format.js";

use([LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export type Metric = "votePct" | "seats";

interface Props {
  current: ElectionSnapshot[];
  historical: ElectionSnapshot[];
  parties: PartyMeta[];
  visiblePartyIds: string[];
  metric: Metric;
}

interface TooltipDatum {
  election: "29N" | "23J";
  partyId: string;
  envio: number;
  timestamp: string;
  scrutinyPct: number;
  metricValue: number;
}

interface TooltipParam {
  color: string;
  data: TooltipDatum & { value: [number, number] };
}

function partyValue(
  snapshot: ElectionSnapshot,
  partyId: string,
  metric: Metric,
): number | null {
  const party = snapshot.parties.find((value) => value.partyId === partyId);
  return party ? party[metric] : null;
}

function axisMinimum(
  range: { min: number; max: number },
  metric: Metric,
): number {
  const span = Math.max(0, range.max - range.min);
  const padding = metric === "votePct" ? Math.max(0.5, span * 0.08) : Math.max(1, span * 0.08);
  const raw = Math.max(0, range.min - padding);
  return metric === "votePct" ? Math.floor(raw * 2) / 2 : Math.floor(raw);
}

function axisMaximum(
  range: { min: number; max: number },
  metric: Metric,
): number {
  const span = Math.max(0, range.max - range.min);
  const padding = metric === "votePct" ? Math.max(0.5, span * 0.08) : Math.max(1, span * 0.08);
  const raw = range.max + padding;
  return metric === "votePct" ? Math.ceil(raw * 2) / 2 : Math.ceil(raw);
}

export function ScrutinyChart({
  current,
  historical,
  parties,
  visiblePartyIds,
  metric,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const partyMap = useMemo(
    () => new Map(parties.map((party) => [party.id, party])),
    [parties],
  );

  const option = useMemo(() => {
    const series: LineSeriesOption[] = [];

    for (const partyId of visiblePartyIds) {
      const party = partyMap.get(partyId);
      const color = party?.color ?? "#64748b";
      const displayName = party?.label ?? partyId;

      const makeData = (
        snapshots: ElectionSnapshot[],
        election: "29N" | "23J",
      ) =>
        snapshots.flatMap((snapshot) => {
          if (snapshot.scrutinyPct <= 0) return [];
          const value = partyValue(snapshot, partyId, metric);
          if (value === null) return [];
          return [
            {
              value: [snapshot.scrutinyPct, value],
              election,
              partyId,
              envio: snapshot.envio,
              timestamp: snapshot.timestamp,
              scrutinyPct: snapshot.scrutinyPct,
              metricValue: value,
            },
          ];
        });

      const historyData = makeData(historical, "23J");
      if (historyData.length > 0) {
        series.push({
          name: `${displayName} · 23J`,
          type: "line",
          data: historyData,
          showSymbol: false,
          symbol: "none",
          smooth: false,
          step: metric === "seats" ? "end" : false,
          lineStyle: { width: 1.4, type: "solid", opacity: 0.28 },
          itemStyle: { color },
          emphasis: { lineStyle: { width: 2.4, opacity: 0.72 } },
          animation: false,
          connectNulls: false,
          z: 1,
        });
      }

      const currentData = makeData(current, "29N");
      if (currentData.length > 0) {
        series.push({
          name: `${displayName} · 29N`,
          type: "line",
          data: currentData,
          showSymbol: currentData.length <= 18,
          symbol: "circle",
          symbolSize: 5,
          smooth: false,
          step: metric === "seats" ? "end" : false,
          lineStyle: { width: 2.8, type: "solid", opacity: 1 },
          itemStyle: { color },
          emphasis: { lineStyle: { width: 4 } },
          animationDuration: 350,
          connectNulls: false,
          z: 3,
        });
      }
    }

    return {
      animation: false,
      aria: { enabled: true },
      color: visiblePartyIds.map((id) => partyMap.get(id)?.color ?? "#64748b"),
      grid: { top: 18, right: 18, bottom: 54, left: 62 },
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(10, 16, 32, 0.96)",
        borderWidth: 0,
        textStyle: { color: "#f8fafc", fontSize: 13 },
        formatter: (rawParams: unknown) => {
          const params = rawParams as TooltipParam[];
          if (!params.length) return "";
          const scrutiny = params[0].data.scrutinyPct;
          const rows = params
            .sort((a, b) => b.data.metricValue - a.data.metricValue)
            .map((param) => {
              const data = param.data;
              const label = partyMap.get(data.partyId)?.label ?? data.partyId;
              const suffix = metric === "votePct" ? "%" : "";
              const digits = metric === "votePct" ? 2 : 0;
              return `<div class="chart-tooltip-row"><span><i style="background:${param.color}"></i>${label} · ${data.election}</span><b>${formatNumber(data.metricValue, digits)}${suffix}</b></div>`;
            })
            .join("");
          const source = params.find((param) => param.data.election === "29N") ?? params[0];
          return `<div class="chart-tooltip"><strong>${formatNumber(scrutiny, 2)}% escrutado</strong><small>Envío ${source.data.envio} · ${formatTimestamp(source.data.timestamp)}</small>${rows}</div>`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        name: "% escrutado",
        nameLocation: "middle",
        nameGap: 34,
        nameTextStyle: { color: "#667085", fontSize: 13 },
        axisLabel: { color: "#667085", formatter: "{value}%" },
        axisLine: { lineStyle: { color: "#d7dce5" } },
        splitLine: { lineStyle: { color: "#edf0f5" } },
      },
      yAxis: {
        type: "value",
        scale: true,
        min: (range: { min: number; max: number }) => axisMinimum(range, metric),
        max: (range: { min: number; max: number }) => axisMaximum(range, metric),
        name: metric === "votePct" ? "% voto" : "escaños",
        nameTextStyle: { color: "#667085", fontSize: 13 },
        axisLabel: {
          color: "#667085",
          formatter: metric === "votePct" ? "{value}%" : "{value}",
        },
        splitLine: { lineStyle: { color: "#edf0f5" } },
      },
      series,
    };
  }, [current, historical, metric, partyMap, visiblePartyIds]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = init(chartRef.current, undefined, {
      renderer: "canvas",
    });
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div className="scrutiny-chart" ref={chartRef} />;
}

