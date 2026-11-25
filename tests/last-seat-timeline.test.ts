import { describe, expect, it } from "vitest";
import type { LastSeatBattle } from "../shared/types.js";
import { selectTimelineBattles } from "../client/src/useLastSeatTimeline.js";

function battle(id: string, censusPoints: number, scrutinyPct = 50): LastSeatBattle {
  return {
    territory: { id, name: `Provincia ${id}`, kind: "province" },
    scrutinyPct,
    holderPartyId: "PP",
    holderCandidatureCode: "0001",
    contenders: [{
      partyId: "PSOE",
      candidatureCode: "0002",
      votesNeeded: 10,
      censusPoints,
    }],
  };
}

describe("selección de batallas en la línea temporal", () => {
  it("mantiene a 0% una provincia del último envío sin datos anteriores", () => {
    const latest = [battle("01", 0.5, 80), battle("02", 1.5, 75)];
    const selected = selectTimelineBattles(
      [battle("01", 1, 20)],
      latest,
      ["02", "01"],
    );

    expect(selected.map(({ territory }) => territory.id)).toEqual(["02", "01"]);
    expect(selected[0]).toMatchObject({
      territory: latest[1].territory,
      scrutinyPct: 0,
      dataAvailable: false,
      holderPartyId: "",
      contenders: [],
    });
    expect(selected[1].scrutinyPct).toBe(20);
  });

  it("no confunde datos fuera del umbral con la ausencia de datos", () => {
    const latest = [battle("01", 0.5), battle("02", 1.5)];
    const selected = selectTimelineBattles(
      [battle("01", 3), battle("02", 2)],
      latest,
      ["01", "02"],
    );

    expect(selected.map(({ territory }) => territory.id)).toEqual(["02"]);
    expect(selected[0].dataAvailable).toBeUndefined();
  });
});
