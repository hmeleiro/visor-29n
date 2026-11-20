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

function metricAtOrBefore(
  snapshots: ElectionSnapshot[],
  partyId: string,
  scrutinyPct: number,
  metric: Metric,
) {
  let selected: { snapshot: ElectionSnapshot; value: number } | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.scrutinyPct <= 0 || snapshot.scrutinyPct > scrutinyPct) continue;
    const party = snapshot.parties.find((value) => value.partyId === partyId);
    if (
      party &&
      (!selected || snapshot.scrutinyPct > selected.snapshot.scrutinyPct)
    ) {
      selected = { snapshot, value: party[metric] };
    }
  }
  return selected;
}

function finalMetric(
  snapshots: ElectionSnapshot[],
  partyId: string,
  metric: Metric,
) {
  let selected: { snapshot: ElectionSnapshot; value: number } | undefined;
  for (const snapshot of snapshots) {
    const party = snapshot.parties.find((value) => value.partyId === partyId);
    if (
      party &&
      (!selected || snapshot.scrutinyPct > selected.snapshot.scrutinyPct)
    ) {
      selected = { snapshot, value: party[metric] };
    }
  }
  return selected;
}

function formatMetric(value: number, metric: Metric) {
  return metric === "votePct"
    ? `${formatNumber(value, 2)}%`
    : `${formatNumber(value)} esc.`;
}

function signedVariation(value: number, metric: Metric) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const formatted = formatNumber(
    Math.abs(value),
    metric === "votePct" ? 2 : 0,
  );
  return `${sign}${formatted} ${metric === "votePct" ? "pp" : "esc."}`;
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
          const party = snapshot.parties.find(
            (candidate) => candidate.partyId === partyId,
          );
          if (value === null || !party) return [];
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
          showSymbol: true,
          symbol: "circle",
          symbolSize: 9,
          smooth: false,
          step: "end",
          lineStyle: { color, width: 2.8, type: "solid", opacity: 0.28 },
          itemStyle: { color, opacity: 0 },
          emphasis: {
            lineStyle: { width: 2.8, opacity: 0.72 },
            itemStyle: { opacity: 1 },
          },
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
          showSymbol: true,
          symbol: "circle",
          symbolSize: 9,
          smooth: false,
          step: "end",
          lineStyle: { color, width: 2.8, type: "solid", opacity: 1 },
          itemStyle: { color, opacity: 0 },
          // emphasis: {
          //   lineStyle: { width: 2.8 },
          //   itemStyle: { opacity: 1 },
          // },
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
      textStyle: {
        fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
      },
      grid: { top: 18, right: 18, bottom: 54, left: 62 },
      legend: { show: false },
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: "rgba(10, 16, 32, 0.96)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc",
          fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
          fontSize: 13,
        },
        formatter: (rawParam: unknown) => {
          const param = rawParam as TooltipParam;
          const { partyId, scrutinyPct } = param.data;
          const label = partyMap.get(partyId)?.label ?? partyId;
          const currentFinal = finalMetric(current, partyId, metric);
          const currentPoint =
            currentFinal && currentFinal.snapshot.scrutinyPct >= scrutinyPct
              ? metricAtOrBefore(current, partyId, scrutinyPct, metric)
              : undefined;
          const historicalPoint = metricAtOrBefore(
            historical,
            partyId,
            scrutinyPct,
            metric,
          );
          const historicalFinal = finalMetric(historical, partyId, metric);
          const currentLabel =
            metric === "votePct" ? "Voto actual" : "Escaños actuales";

          const currentRow = currentPoint
            ? `<div class="chart-tooltip-row"><span><i style="background:${param.color}"></i>${currentLabel}</span><b>${formatMetric(currentPoint.value, metric)}</b></div><small class="chart-tooltip-detail">Envío ${currentPoint.snapshot.envio} · ${formatTimestamp(currentPoint.snapshot.timestamp)}</small>`
            : `<div class="chart-tooltip-row"><span><i style="background:${param.color}"></i>${currentLabel}</span><b>Sin alcanzar</b></div>`;
          const historicalRow =
            historicalPoint && historicalFinal
              ? `<div class="chart-tooltip-row"><span>Variación 23J hasta el final</span><b>${signedVariation(historicalFinal.value - historicalPoint.value, metric)}</b></div><small class="chart-tooltip-detail">23J: ${formatMetric(historicalPoint.value, metric)} → ${formatMetric(historicalFinal.value, metric)}</small>`
              : `<div class="chart-tooltip-row"><span>Variación 23J</span><b>Sin dato comparable</b></div>`;

          return `<div class="chart-tooltip"><strong class="chart-tooltip-title"><i style="background:${param.color}"></i>${label}</strong><small>${formatNumber(scrutinyPct, 2)}% escrutado</small>${currentRow}${historicalRow}</div>`;
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

