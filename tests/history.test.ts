import { describe, expect, it } from "vitest";
import { normalizeHistoryParty } from "../shared/history.js";

describe("normalizeHistoryParty", () => {
  it("aplica únicamente la equivalencia acordada", () => {
    expect(normalizeHistoryParty("Sumar")).toBe("FA");
    expect(normalizeHistoryParty("  PSOE ")).toBe("PSOE");
    expect(normalizeHistoryParty("Podemos")).toBe("Podemos");
  });
});

