import { describe, expect, it } from "vitest";
import type { LastSeatBattle } from "../shared/types.js";
import {
  filterBattlesByScrutiny,
  highScrutinyThreshold,
} from "../client/src/components/LastSeatSection.js";

function battle(id: string, scrutinyPct: number): LastSeatBattle {
  return {
    territory: { id, name: `Provincia ${id}`, kind: "province" },
    scrutinyPct,
    holderPartyId: "PP",
    holderCandidatureCode: "0001",
    contenders: [],
  };
}

describe("filtro de escrutinio de la batalla por el último escaño", () => {
  const battles = [
    battle("01", 0),
    battle("02", highScrutinyThreshold),
    battle("03", highScrutinyThreshold + 0.01),
    battle("04", 100),
  ];

  it("oculta por defecto solo las provincias que superan el 98%", () => {
    expect(
      filterBattlesByScrutiny(battles, false).map(({ territory }) => territory.id),
    ).toEqual(["01", "02"]);
  });

  it("permite mostrar todas las provincias", () => {
    expect(filterBattlesByScrutiny(battles, true)).toEqual(battles);
  });
});
