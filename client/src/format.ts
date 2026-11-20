const numberFormats = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, digits = 0): string {
  let formatter = numberFormats.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(digits, formatter);
  }
  return formatter.format(value);
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Sin datos";
  if (/^\d{10}$/.test(value)) {
    const year = `20${value.slice(0, 2)}`;
    const month = value.slice(2, 4);
    const day = value.slice(4, 6);
    const hour = value.slice(6, 8);
    const minute = value.slice(8, 10);
    return `${day}/${month}/${year} · ${hour}:${minute}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

