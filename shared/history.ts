export const HISTORY_PARTY_ALIASES: Readonly<Record<string, string>> = {
  Sumar: "FA",
};

export function normalizeHistoryParty(party: string): string {
  const cleaned = party.trim();
  return HISTORY_PARTY_ALIASES[cleaned] ?? cleaned;
}

