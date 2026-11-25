import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../server/index.js";
import { ResultsRepository } from "../server/repository.js";
import type { LastSeatFrame, LastSeatResponse } from "../shared/types.js";

const query = vi.hoisted(() => vi.fn());

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => ({ query, end: vi.fn() }) },
}));
vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("@fastify/static", () => ({ default: vi.fn() }));
vi.mock("../server/history-store.js", () => ({
  HistoryStore: class {
    async getManifest() {
      return { territories: [], parties: [] };
    }
  },
}));

const config = {
  host: "127.0.0.1",
  port: 3000,
  pollIntervalMs: 60_000,
  expectedTerritoryRows: 53,
  staticDir: "",
  historyDir: "",
  dashboardUser: "test",
  dashboardPassword: "test",
  db: { host: "", port: 3306, database: "", user: "", password: "" },
};

const headers = {
  authorization: `Basic ${Buffer.from("test:test").toString("base64")}`,
};

function provinceRow(envio: number, id: string, challengerVotes: number) {
  return {
    n_envio: envio,
    frame_timestamp: `timestamp-${envio}`,
    ccaa_prov: "PR",
    codigo_provincia: id,
    provincia: id,
    censo: 1000,
    censo_escrutado_pct: 50,
    ultimo_codigo_candidatura: "0001",
    codigo_candidatura_1: "0001",
    votos_1: 100,
    diputados_1: 1,
    codigo_candidatura_2: "0002",
    votos_pct_2: 40,
    votos_2: challengerVotes,
    diputados_2: 0,
  };
}

const batchQueries = () =>
  query.mock.calls.filter(([sql]) => sql.includes("complete_envios"));

let latestTimestamp: string;

beforeEach(() => {
  latestTimestamp = "timestamp-2";
  query.mockReset();
  query.mockImplementation(async (sql: string, envios: number[] = []) => {
    if (sql.includes("complete_envios")) {
      const rows = envios.flatMap((envio) => {
        if (envio === 1) return [provinceRow(1, "01", 20), provinceRow(1, "02", 98)];
        if (envio === 2) return [provinceRow(2, "01", 99), provinceRow(2, "02", 92)]
          .map((row) => ({ ...row, frame_timestamp: latestTimestamp }));
        return [];
      });
      return [rows];
    }
    if (sql.includes("FROM candidaturas")) {
      return [[
        { codigo_candidatura: "0001", recode: "PP" },
        { codigo_candidatura: "0002", recode: "PSOE" },
      ]];
    }
    if (sql.includes("COUNT(DISTINCT codigo_provincia)")) {
      return [[
        { n_envio: 1, timestamp: "timestamp-1" },
        { n_envio: 2, timestamp: latestTimestamp },
      ]];
    }
    return [[]];
  });
});

describe("fotogramas de la batalla por el último escaño", () => {
  let app: FastifyInstance;
  let address: string;

  beforeEach(async () => {
    vi.stubEnv("LOG_LEVEL", "silent");
    app = await buildApp(config);
    address = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("carga varios envíos juntos y comparte la caché con la ruta existente", async () => {
    const batch = await fetch(`${address}/api/last-seat/frames?envios=2,1`, { headers });
    expect(batch.status).toBe(200);
    const frames: LastSeatFrame[] = await batch.json();
    expect(frames.map(({ envio }) => envio)).toEqual([2, 1]);
    expect(frames[1].timestamp).toBe("timestamp-1");
    expect(frames[1].battles.map(({ territory }) => territory.id)).toEqual(["02", "01"]);
    expect(frames[1].battles[1].contenders).toEqual([]);

    const historical = await fetch(`${address}/api/last-seat?envio=1`, { headers });
    expect(historical.status).toBe(200);
    const response: LastSeatResponse = await historical.json();
    expect(response.provinceOrder).toEqual(["01", "02"]);
    expect(response.battles.map(({ territory }) => territory.id)).toEqual(["02"]);
    expect(batchQueries().map(([, envios]) => envios)).toEqual([[2, 1]]);
  });

  it("rechaza lotes mal formados o envíos incompletos", async () => {
    for (const params of ["", "?envios=1,01", "?envios=1e2", "?envios=1,2,3,4,5,6,7,8,9"]) {
      const response = await fetch(`${address}/api/last-seat/frames${params}`, { headers });
      expect(response.status).toBe(400);
      await response.body?.cancel();
    }
    expect(batchQueries()).toHaveLength(0);

    const incomplete = await fetch(`${address}/api/last-seat/frames?envios=1,3`, { headers });
    expect(incomplete.status).toBe(400);
    await incomplete.body?.cancel();
    expect(batchQueries().map(([, envios]) => envios)).toEqual([[1, 3]]);
  });

  it("recarga un envío en caché cuando cambia su timestamp", async () => {
    const initial = await fetch(`${address}/api/last-seat`, { headers });
    expect((await initial.json()).timestamp).toBe("timestamp-2");

    latestTimestamp = "timestamp-2-revised";
    const updated = await fetch(`${address}/api/last-seat`, { headers });
    expect((await updated.json()).timestamp).toBe(latestTimestamp);

    const batch = await fetch(`${address}/api/last-seat/frames?envios=2`, { headers });
    expect((await batch.json())[0].timestamp).toBe(latestTimestamp);
    expect(batchQueries().map(([, envios]) => envios)).toEqual([[2], [2]]);
  });
});

it("comparte las cargas en curso entre lotes que se solapan", async () => {
  const repository = new ResultsRepository(config);
  try {
    const [prefetch, selection] = await Promise.all([
      repository.getLastSeatFrames([1, 2]),
      repository.getLastSeatFrames([2]),
    ]);
    expect(selection).toEqual([prefetch[1]]);
    expect(batchQueries().map(([, envios]) => envios)).toEqual([[1, 2]]);
  } finally {
    await repository.close();
  }
});
