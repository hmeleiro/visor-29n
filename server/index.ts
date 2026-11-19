import { config as loadDotEnv } from "dotenv";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { loadConfig, type AppConfig } from "./config.js";
import { HistoryStore } from "./history-store.js";
import { buildPartyCatalog } from "./normalize.js";
import { EnvioPoller } from "./poller.js";
import { ResultsRepository } from "./repository.js";
import { parseAfter, parseTerritories, RequestError } from "./validation.js";
import type {
  EnvioEvent,
  HistoryResponse,
  LastSeatResponse,
  MetaResponse,
  SeriesResponse,
} from "../shared/types.js";

const fileEnvironment: Record<string, string> = {};
loadDotEnv({ processEnv: fileEnvironment });

function mergedEnvironment(): NodeJS.ProcessEnv {
  const merged = { ...fileEnvironment, ...process.env };
  // Docker define HOSTNAME con el id del contenedor. Si el fichero legado no
  // dispone de DB_HOST, su HOSTNAME es el que representa el servidor MySQL.
  if (!process.env.DB_HOST && fileEnvironment.HOSTNAME) {
    merged.HOSTNAME = fileEnvironment.HOSTNAME;
  }
  return merged;
}

interface ApiQuery {
  territories?: string;
  after?: string;
  envio?: string;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readBasicCredentials(header: string | undefined): [string, string] | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return [decoded.slice(0, separator), decoded.slice(separator + 1)];
  } catch {
    return null;
  }
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });
  const repository = new ResultsRepository(config);
  const history = new HistoryStore(config.historyDir);
  const manifest = await history.getManifest();
  const allowedTerritories = new Set(
    manifest.territories.map((territory) => territory.id),
  );
  const poller = new EnvioPoller(repository, config.pollIntervalMs);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz") return;
    const credentials = readBasicCredentials(request.headers.authorization);
    if (
      !credentials ||
      !safeEqual(credentials[0], config.dashboardUser) ||
      !safeEqual(credentials[1], config.dashboardPassword)
    ) {
      reply.header("WWW-Authenticate", 'Basic realm="Escrutinio 29N"');
      return reply.code(401).send({ error: "Autenticación necesaria" });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  app.get("/healthz", async (_request, reply) => {
    try {
      await repository.ping();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "error" });
    }
  });

  app.get("/api/meta", async (): Promise<MetaResponse> => {
    const [latest, candidateRecords] = await Promise.all([
      repository.getLatestCompleteState(),
      repository.getCandidateRecords(),
    ]);

    return {
      territories: manifest.territories,
      parties: buildPartyCatalog(candidateRecords, manifest.parties),
      latest,
      pollIntervalMs: config.pollIntervalMs,
    };
  });

  app.get<{ Querystring: ApiQuery }>(
    "/api/series",
    async (request): Promise<SeriesResponse> => {
      const territories = parseTerritories(
        request.query.territories,
        allowedTerritories,
      );
      const after = parseAfter(request.query.after);
      const latest = await repository.getLatestCompleteState();
      if (latest.envio === null) {
        return { election: "29N", territories: [], latest };
      }

      const unknownCodes = new Set<string>();
      const series = await repository.getSeries(
        territories,
        after,
        latest.envio,
        (code) => unknownCodes.add(code),
      );
      if (unknownCodes.size > 0) {
        request.log.warn(
          { codes: [...unknownCodes] },
          "Candidaturas sin recode en la tabla candidaturas",
        );
      }

      return { election: "29N", territories: series, latest };
    },
  );

  app.get<{ Querystring: ApiQuery }>("/api/last-seat", async (request): Promise<LastSeatResponse> => {
    const availableEnvios = await repository.getCompleteProvinceEnvios();
    const requestedEnvio =
      request.query.envio === undefined ? undefined : Number(request.query.envio);
    if (
      requestedEnvio !== undefined &&
      (!Number.isInteger(requestedEnvio) ||
        !availableEnvios.some((item) => item.envio === requestedEnvio))
    ) {
      throw new RequestError("El envío solicitado no está disponible o está incompleto");
    }
    const selected =
      requestedEnvio ?? availableEnvios.at(-1)?.envio ?? null;
    const selectedMeta = availableEnvios.find((item) => item.envio === selected);
    return {
      election: "29N",
      envio: selected,
      timestamp: selectedMeta?.timestamp ?? null,
      thresholdCensusPoints: 4,
      availableEnvios,
      battles: selected === null ? [] : await repository.getLastSeatBattles(selected),
    };
  });

  app.get<{ Querystring: ApiQuery }>(
    "/api/history",
    async (request, reply): Promise<HistoryResponse> => {
      const territories = parseTerritories(
        request.query.territories,
        allowedTerritories,
      );
      reply.header("Cache-Control", "private, max-age=86400");
      return {
        election: "23J",
        territories: await history.getTerritories(territories),
      };
    },
  );

  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("event: ready\ndata: {}\n\n");

    const onEnvio = (event: EnvioEvent) => {
      response.write(`event: envio\ndata: ${JSON.stringify(event)}\n\n`);
    };
    poller.on("envio", onEnvio);

    const keepAlive = setInterval(() => {
      response.write(": keepalive\n\n");
    }, 15_000);
    keepAlive.unref();

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      poller.off("envio", onEnvio);
    });
  });

  poller.on("poll-error", (error) => {
    app.log.error({ error }, "Error comprobando nuevos envíos");
  });

  if (existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: "/",
      maxAge: "1h",
      immutable: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html", { maxAge: 0, immutable: false });
      }
      return reply.code(404).send({ error: "Ruta no encontrada" });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const typedError = error as Error & { statusCode?: number };
    const statusCode =
      error instanceof RequestError
        ? error.statusCode
        : typedError.statusCode || 500;
    if (statusCode >= 500) request.log.error({ error }, "Error en la petición");
    reply.code(statusCode).send({
      error:
        statusCode >= 500 ? "Error interno del servidor" : typedError.message,
    });
  });

  app.addHook("onClose", async () => {
    poller.stop();
    await repository.close();
  });

  await poller.start();
  return app;
}

async function main(): Promise<void> {
  const config = loadConfig(mergedEnvironment());
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error: unknown) => {
    console.error("No se pudo iniciar el visor", error);
    process.exitCode = 1;
  });
}

