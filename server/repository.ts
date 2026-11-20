import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "./config.js";
import {
  normalizeWideRows,
  buildLastSeatBattles,
  type CandidateMap,
  type CandidateRecord,
  type WideResultRow,
} from "./normalize.js";
import type {
  LastSeatFrame,
  LatestState,
  TerritorySeries,
} from "../shared/types.js";

interface LatestRow extends RowDataPacket {
  n_envio: number;
  timestamp: string;
  relevant_rows: number;
}

interface CandidateRow extends RowDataPacket {
  codigo_candidatura: string;
  recode: string | null;
  color: string | null;
  color_pastel: string | null;
  color_oscuro: string | null;
}

interface EnvioRow extends RowDataPacket {
  n_envio: number;
  timestamp: string;
}

interface LastSeatRow extends WideResultRow {
  frame_timestamp: string;
}

export class ResultsRepository {
  private readonly pool: Pool;
  private readonly expectedRows: number;
  private readonly lastSeatCache = new Map<number, LastSeatFrame>();
  private readonly lastSeatPending = new Map<number, Promise<LastSeatFrame | undefined>>();
  private lastSeatTimestamps = new Map<number, string>();

  constructor(config: AppConfig) {
    this.expectedRows = config.expectedTerritoryRows;
    this.pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      charset: "utf8mb4",
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 20,
      enableKeepAlive: true,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  }

  async getLatestCompleteState(): Promise<LatestState> {
    const [rows] = await this.pool.query<LatestRow[]>(`
      SELECT n_envio, MAX(timestamp) AS timestamp, COUNT(*) AS relevant_rows
      FROM resultados_totales
      WHERE ccaa_prov IN ('PR', 'TO')
      GROUP BY n_envio
      HAVING COUNT(*) = ?
      ORDER BY n_envio DESC
      LIMIT 1
    `, [this.expectedRows]);

    const row = rows[0];
    if (!row) {
      return {
        envio: null,
        timestamp: null,
        relevantRows: 0,
        complete: false,
      };
    }

    return {
      envio: Number(row.n_envio),
      timestamp: String(row.timestamp),
      relevantRows: Number(row.relevant_rows),
      complete: true,
    };
  }

  async getCandidateRecords(): Promise<CandidateRecord[]> {
    const [rows] = await this.pool.query<CandidateRow[]>(`
      SELECT codigo_candidatura, recode, color, color_pastel, color_oscuro
      FROM candidaturas
      WHERE recode IS NOT NULL AND recode <> ''
      ORDER BY codigo_candidatura
    `);

    return rows.map((row) => ({
      code: row.codigo_candidatura,
      recode: row.recode ?? "Sin recodificar",
      color: row.color ?? "",
      colorPastel: row.color_pastel ?? "",
      colorDark: row.color_oscuro ?? "",
    }));
  }

  async getSeries(
    territoryIds: string[],
    afterEnvio: number | undefined,
    throughEnvio: number,
    onUnknownCode?: (code: string) => void,
  ): Promise<TerritorySeries[]> {
    const provinceIds = territoryIds.filter((id) => id !== "ES");
    const wantsSpain = territoryIds.includes("ES");
    const geographyClauses: string[] = [];
    const params: Array<string | number> = [];

    if (wantsSpain) geographyClauses.push("ccaa_prov = 'TO'");
    if (provinceIds.length > 0) {
      geographyClauses.push(
        `(ccaa_prov = 'PR' AND codigo_provincia IN (${provinceIds
          .map(() => "?")
          .join(", ")}))`,
      );
      params.push(...provinceIds);
    }

    const envioClauses = ["n_envio <= ?"];
    params.push(throughEnvio);
    if (afterEnvio !== undefined) {
      envioClauses.push("n_envio > ?");
      params.push(afterEnvio);
    }

    const [rows] = await this.pool.query<WideResultRow[]>(`
      SELECT *
      FROM resultados_totales
      WHERE (${geographyClauses.join(" OR ")})
        AND ${envioClauses.join(" AND ")}
      ORDER BY n_envio, ccaa_prov DESC, codigo_provincia
    `, params);

    const records = await this.getCandidateRecords();
    const candidates: CandidateMap = new Map(
      records.map((record) => [record.code, record]),
    );
    return normalizeWideRows(rows, candidates, onUnknownCode);
  }

  async getLastSeatFrames(
    envios: number[],
    includeOutsideThreshold = false,
  ): Promise<LastSeatFrame[]> {
    const missing = envios.filter(
      (envio) => !this.lastSeatCache.has(envio) && !this.lastSeatPending.has(envio),
    );
    if (missing.length > 0) {
      const batch = this.loadLastSeatFrames(missing);
      for (const envio of missing) {
        const frame = batch
          .then((frames) => frames.get(envio))
          .finally(() => this.lastSeatPending.delete(envio));
        this.lastSeatPending.set(envio, frame);
      }
    }

    const frames = await Promise.all(envios.map((envio) => {
      const cached = this.lastSeatCache.get(envio);
      if (!cached) return this.lastSeatPending.get(envio);
      // Move the entry to the end so active timeline frames stay warm.
      this.lastSeatCache.delete(envio);
      this.lastSeatCache.set(envio, cached);
      return cached;
    }));

    return frames
      .filter((frame): frame is LastSeatFrame => frame !== undefined)
      .map((frame) => includeOutsideThreshold
        ? frame
        : { ...frame, battles: frame.battles.filter((battle) => battle.contenders.length > 0) });
  }

  private async loadLastSeatFrames(envios: number[]): Promise<Map<number, LastSeatFrame>> {
    const [[rows], records] = await Promise.all([
      this.pool.query<LastSeatRow[]>(`
        SELECT results.*, complete_envios.frame_timestamp
        FROM resultados_totales AS results
        JOIN (
          SELECT n_envio, MAX(timestamp) AS frame_timestamp
          FROM resultados_totales
          WHERE ccaa_prov = 'PR' AND n_envio IN (${envios.map(() => "?").join(", ")})
          GROUP BY n_envio
          HAVING COUNT(DISTINCT codigo_provincia) = 52
        ) AS complete_envios ON complete_envios.n_envio = results.n_envio
        WHERE results.ccaa_prov = 'PR'
        ORDER BY results.codigo_provincia
      `, envios),
      this.getCandidateRecords(),
    ]);
    const candidates: CandidateMap = new Map(
      records.map((record) => [record.code, record]),
    );

    const rowsByEnvio = new Map<number, LastSeatRow[]>();
    for (const row of rows) {
      const envio = Number(row.n_envio);
      const group = rowsByEnvio.get(envio);
      if (group) group.push(row);
      else rowsByEnvio.set(envio, [row]);
    }

    const frames = new Map<number, LastSeatFrame>();
    for (const [envio, group] of rowsByEnvio) {
      const frame = {
        envio,
        timestamp: String(group[0].frame_timestamp),
        battles: buildLastSeatBattles(group, candidates, 4, 3, true),
      };
      frames.set(envio, frame);
      const knownTimestamp = this.lastSeatTimestamps.get(envio);
      if (knownTimestamp !== undefined && knownTimestamp !== frame.timestamp) continue;
      this.lastSeatCache.set(envio, frame);
      if (this.lastSeatCache.size > 48) {
        const oldest = this.lastSeatCache.keys().next().value;
        if (oldest !== undefined) this.lastSeatCache.delete(oldest);
      }
    }
    return frames;
  }

  async getCompleteProvinceEnvios(): Promise<Array<{ envio: number; timestamp: string }>> {
    const [rows] = await this.pool.query<EnvioRow[]>(`
      SELECT n_envio, MAX(timestamp) AS timestamp
      FROM resultados_totales
      WHERE ccaa_prov = 'PR'
      GROUP BY n_envio
      HAVING COUNT(DISTINCT codigo_provincia) = 52
      ORDER BY n_envio
    `);
    const envios = rows.map((row) => ({
      envio: Number(row.n_envio),
      timestamp: String(row.timestamp),
    }));
    this.lastSeatTimestamps = new Map(envios.map(({ envio, timestamp }) => [envio, timestamp]));
    for (const [envio, frame] of this.lastSeatCache) {
      if (this.lastSeatTimestamps.get(envio) !== frame.timestamp) {
        this.lastSeatCache.delete(envio);
      }
    }
    return envios;
  }
}

