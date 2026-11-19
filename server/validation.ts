export class RequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function parseTerritories(
  raw: string | undefined,
  allowedIds: ReadonlySet<string>,
): string[] {
  const ids = [...new Set((raw || "ES").split(",").map((id) => id.trim()))]
    .filter(Boolean);

  if (ids.length === 0) return ["ES"];
  if (ids.length > 6) {
    throw new RequestError("Se pueden seleccionar como máximo seis territorios");
  }

  const invalid = ids.filter((id) => !allowedIds.has(id));
  if (invalid.length > 0) {
    throw new RequestError(`Territorios desconocidos: ${invalid.join(", ")}`);
  }
  return ids;
}

export function parseAfter(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new RequestError("after debe ser un número de envío válido");
  }
  return value;
}

