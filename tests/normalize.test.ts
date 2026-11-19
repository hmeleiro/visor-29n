import { describe, expect, it, vi } from "vitest";
import {
  buildLastSeatBattles,
  buildPartyCatalog,
  normalizeWideRows,
  type CandidateMap,
  type WideResultRow,
} from "../server/normalize.js";

describe("normalizeWideRows", () => {
  it("agrupa candidaturas por recode e ignora el código de relleno", () => {
    const candidates: CandidateMap = new Map([
      [
        "0001",
        {
          code: "0001",
          recode: "PSOE",
          color: "#e30613",
          colorPastel: "#f7b7ba",
          colorDark: "#9f040d",
        },
      ],
      [
        "0024",
        {
          code: "0024",
          recode: "PSOE",
          color: "#e30613",
          colorPastel: "#f7b7ba",
          colorDark: "#9f040d",
        },
      ],
    ]);
    const unknown = vi.fn();
    const row = {
      n_envio: 96,
      timestamp: "2611181950",
      ccaa_prov: "PR",
      codigo_provincia: "07",
      provincia: "Illes Balears",
      censo_escrutado_pct: "99.73",
      codigo_candidatura_1: "0001",
      votos_1: 100,
      votos_pct_1: "20.50",
      diputados_1: 2,
      codigo_candidatura_2: "0024",
      votos_2: 50,
      votos_pct_2: "10.25",
      diputados_2: 1,
      codigo_candidatura_3: "0000",
      votos_3: 999,
      votos_pct_3: 99,
      diputados_3: 99,
    } as unknown as WideResultRow;

    const result = normalizeWideRows([row], candidates, unknown);

    expect(result).toHaveLength(1);
    expect(result[0].territory).toEqual({
      id: "07",
      name: "Illes Balears",
      kind: "province",
    });
    expect(result[0].snapshots[0]).toMatchObject({
      envio: 96,
      scrutinyPct: 99.73,
      parties: [
        { partyId: "PSOE", votePct: 30.75, seats: 3, votes: 150 },
      ],
    });
    expect(unknown).not.toHaveBeenCalled();
  });

  it("hace visible un código real que no tenga recodificación", () => {
    const unknown = vi.fn();
    const row = {
      n_envio: 1,
      timestamp: "2611292000",
      ccaa_prov: "TO",
      codigo_provincia: "99",
      provincia: "España",
      censo_escrutado_pct: 5,
      codigo_candidatura_1: "9999",
      votos_pct_1: 1.2,
      diputados_1: 0,
      votos_1: 100,
    } as unknown as WideResultRow;

    const result = normalizeWideRows([row], new Map(), unknown);
    expect(result[0].snapshots[0].parties[0].partyId).toBe("Sin recodificar");
    expect(unknown).toHaveBeenCalledWith("9999");
  });
});

describe("buildLastSeatBattles", () => {
  it("calcula hasta tres aspirantes en puntos sobre el censo", () => {
    const candidates: CandidateMap = new Map([
      ["0007", { code: "0007", recode: "PP", color: "#315899", colorPastel: "", colorDark: "" }],
      ["0001", { code: "0001", recode: "PSOE", color: "#e30613", colorPastel: "", colorDark: "" }],
      ["0006", { code: "0006", recode: "Vox", color: "#5ac035", colorPastel: "", colorDark: "" }],
      ["0008", { code: "0008", recode: "FA", color: "#e83b01", colorPastel: "", colorDark: "" }],
      ["0099", { code: "0099", recode: "Otros", color: "#808080", colorPastel: "", colorDark: "" }],
    ]);
    const row = {
      n_envio: 12,
      timestamp: "2611292100",
      ccaa_prov: "PR",
      codigo_provincia: "02",
      provincia: "Albacete",
      censo: 1000,
      censo_escrutado_pct: 80,
      ultimo_codigo_candidatura: "0007",
      codigo_candidatura_1: "0007",
      votos_1: 100,
      votos_pct_1: 40,
      diputados_1: 2,
      codigo_candidatura_2: "0001",
      votos_2: 46,
      votos_pct_2: 35,
      diputados_2: 0,
      codigo_candidatura_3: "0006",
      votos_3: 40,
      votos_pct_3: 12,
      diputados_3: 0,
      codigo_candidatura_4: "0008",
      votos_4: 20,
      votos_pct_4: 7,
      diputados_4: 0,
      codigo_candidatura_5: "0099",
      votos_5: 49,
      votos_pct_5: 2.5,
      diputados_5: 0,
    } as unknown as WideResultRow;

    const battles = buildLastSeatBattles([row], candidates, 4, 3);

    expect(battles).toHaveLength(1);
    expect(battles[0].holderPartyId).toBe("PP");
    expect(battles[0].contenders).toEqual([
      { partyId: "PSOE", candidatureCode: "0001", votesNeeded: 4, censusPoints: 0.4 },
      { partyId: "Vox", candidatureCode: "0006", votesNeeded: 10, censusPoints: 1 },
      { partyId: "FA", candidatureCode: "0008", votesNeeded: 30, censusPoints: 3 },
    ]);
  });
});

describe("buildPartyCatalog", () => {
  it("conserva colores de candidaturas y documenta la equivalencia FA/Sumar", () => {
    const catalog = buildPartyCatalog(
      [
        {
          code: "0008",
          recode: "FA",
          color: "#e83b01",
          colorPastel: "#f8c4b3",
          colorDark: "#a22901",
        },
      ],
      ["FA", "CUP"],
    );

    expect(catalog.find((party) => party.id === "FA")).toMatchObject({
      color: "#e83b01",
      historyLabel: "Sumar",
    });
    expect(catalog.find((party) => party.id === "CUP")?.color).toMatch(/^#/);
  });
});

