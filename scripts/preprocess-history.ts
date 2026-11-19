import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import { normalizeHistoryParty } from "../shared/history.js";
import type {
  ElectionSnapshot,
  HistoryManifest,
  PartyValue,
  TerritoryInfo,
  TerritorySeries,
} from "../shared/types.js";

interface CsvRow {
  n_envio: string;
  fecha_hora: string;
  ccaa_prov: string;
  codigo_provincia: string;
  provincia: string;
  censo_escrutado_pct: string;
  partido: string;
  votos: string;
  votos_pct: string;
  diputados: string;
}

interface MutableSnapshot {
  envio: number;
  timestamp: string;
  scrutinyPct: number;
  parties: Map<string, PartyValue>;
}

const workspace = process.cwd();
const inputPath = resolve(
  workspace,
  "votos_escrutinio_provincias_acumulado_23J.csv",
);
const outputDir = resolve(workspace, "generated", "history");

const territories = new Map<string, TerritoryInfo>();
const snapshotsByTerritory = new Map<string, Map<number, MutableSnapshot>>();
const partyIds = new Set<string>();

function numberOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function territoryFromRow(row: CsvRow): TerritoryInfo | null {
  if (row.ccaa_prov === "TO") {
    return { id: "ES", name: "España", kind: "country" };
  }

  if (row.ccaa_prov === "PR") {
    return {
      id: row.codigo_provincia.padStart(2, "0"),
      name: row.provincia.trim(),
      kind: "province",
    };
  }

  return null;
}

async function preprocess(): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const parser = createReadStream(inputPath).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }),
  );

  for await (const rawRow of parser) {
    const row = rawRow as CsvRow;
    const territory = territoryFromRow(row);
    if (!territory) continue;

    const envio = Number(row.n_envio);
    if (!Number.isFinite(envio)) continue;

    const partyId = normalizeHistoryParty(row.partido);
    if (!partyId) continue;

    territories.set(territory.id, territory);
    partyIds.add(partyId);

    let territorySnapshots = snapshotsByTerritory.get(territory.id);
    if (!territorySnapshots) {
      territorySnapshots = new Map();
      snapshotsByTerritory.set(territory.id, territorySnapshots);
    }

    let snapshot = territorySnapshots.get(envio);
    if (!snapshot) {
      snapshot = {
        envio,
        timestamp: row.fecha_hora,
        scrutinyPct: numberOrZero(row.censo_escrutado_pct),
        parties: new Map(),
      };
      territorySnapshots.set(envio, snapshot);
    }

    const current = snapshot.parties.get(partyId) ?? {
      partyId,
      votePct: 0,
      seats: 0,
      votes: 0,
    };
    current.votePct += numberOrZero(row.votos_pct);
    current.seats += numberOrZero(row.diputados);
    current.votes = (current.votes ?? 0) + numberOrZero(row.votos);
    snapshot.parties.set(partyId, current);
  }

  const orderedTerritories = [...territories.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
    return a.id.localeCompare(b.id, "es");
  });

  for (const territory of orderedTerritories) {
    const mutableSnapshots = snapshotsByTerritory.get(territory.id) ?? new Map();
    const snapshots: ElectionSnapshot[] = [...mutableSnapshots.values()]
      .sort((a, b) => a.envio - b.envio)
      .map((snapshot) => ({
        envio: snapshot.envio,
        timestamp: snapshot.timestamp,
        scrutinyPct: snapshot.scrutinyPct,
        parties: [...snapshot.parties.values()].sort((a, b) =>
          a.partyId.localeCompare(b.partyId, "es"),
        ),
      }));

    const payload: TerritorySeries = { territory, snapshots };
    await writeFile(
      resolve(outputDir, `${territory.id}.json`),
      JSON.stringify(payload),
      "utf8",
    );
  }

  const manifest: HistoryManifest = {
    source: "votos_escrutinio_provincias_acumulado_23J.csv",
    generatedAt: new Date().toISOString(),
    territories: orderedTerritories,
    parties: [...partyIds].sort((a, b) => a.localeCompare(b, "es")),
  };

  await writeFile(
    resolve(outputDir, "manifest.json"),
    JSON.stringify(manifest),
    "utf8",
  );

  process.stdout.write(
    `Histórico preparado: ${orderedTerritories.length} territorios, ${partyIds.size} partidos.\n`,
  );
}

preprocess().catch((error: unknown) => {
  console.error("No se pudo preparar el histórico del 23J", error);
  process.exitCode = 1;
});

