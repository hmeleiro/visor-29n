import { describe, expect, it } from "vitest";
import { parseTerritories } from "../server/validation.js";

const allowed = new Set(["ES", "01", "02", "03", "04", "05", "06"]);

describe("parseTerritories", () => {
  it("usa España como selección inicial y elimina duplicados", () => {
    expect(parseTerritories(undefined, allowed)).toEqual(["ES"]);
    expect(parseTerritories("ES,01,ES", allowed)).toEqual(["ES", "01"]);
  });

  it("rechaza territorios desconocidos y más de seis", () => {
    expect(() => parseTerritories("99", allowed)).toThrow("Territorios desconocidos");
    expect(() => parseTerritories("ES,01,02,03,04,05,06", allowed)).toThrow(
      "máximo seis",
    );
  });
});

