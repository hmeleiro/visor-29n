import { resolve } from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  pollIntervalMs: number;
  expectedTerritoryRows: number;
  staticDir: string;
  historyDir: string;
  dashboardUser: string;
  dashboardPassword: string;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

function required(
  env: NodeJS.ProcessEnv,
  primary: string,
  legacy?: string,
): string {
  const value = env[primary] || (legacy ? env[legacy] : undefined);
  if (!value) {
    const alternatives = legacy ? ` (o ${legacy})` : "";
    throw new Error(`Falta la variable de entorno ${primary}${alternatives}`);
  }
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspace = process.cwd();

  return {
    port: positiveInteger(env.PORT, 3000, "PORT"),
    host: env.APP_HOST || "0.0.0.0",
    pollIntervalMs: positiveInteger(
      env.POLL_INTERVAL_MS,
      2000,
      "POLL_INTERVAL_MS",
    ),
    expectedTerritoryRows: positiveInteger(
      env.EXPECTED_TERRITORY_ROWS,
      53,
      "EXPECTED_TERRITORY_ROWS",
    ),
    staticDir: env.STATIC_DIR || resolve(workspace, "dist", "client"),
    historyDir:
      env.HISTORY_DIR || resolve(workspace, "generated", "history"),
    dashboardUser: required(env, "DASHBOARD_USER"),
    dashboardPassword: required(env, "DASHBOARD_PASSWORD"),
    db: {
      host: required(env, "DB_HOST", "HOSTNAME"),
      port: positiveInteger(env.DB_PORT || env.DBPORT, 3306, "DB_PORT"),
      database: required(env, "DB_NAME", "DBNAME"),
      user: required(env, "DB_USER", "DBUSER"),
      password: required(env, "DB_PASSWORD", "DBPASS"),
    },
  };
}

