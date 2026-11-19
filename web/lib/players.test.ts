import { describe, expect, it } from "vitest";

import { didNotPlay, initials, inRange, type PlayerLine, rangeText, shortName } from "@/lib/players";

function line(actual: PlayerLine["actual"]): PlayerLine {
  return {
    playerId: 1, teamId: 1, name: "Cameron Boozer", number: null, minutes: 31,
    proj: { pts: 17.3, reb: 8.6, ast: 5 },
    range: { pts: [9.2, 25.3], reb: [4, 13], ast: [2, 8] },
    actual,
  }; // prettier-ignore
}

describe("names", () => {
  it("makes initials and short names", () => {
    expect(initials("Cameron Boozer")).toBe("CB");
    expect(initials("Jaren Jackson Jr.")).toBe("JJ");
    expect(initials("De'Anthony Melton")).toBe("DM");
    expect(initials("Nenê")).toBe("N");
    expect(shortName("Cameron Boozer")).toBe("C. Boozer");
    expect(shortName("Shai Gilgeous-Alexander")).toBe("S. Gilgeous-Alexander");
    expect(shortName("Nenê")).toBe("Nenê");
  });
});

describe("ranges", () => {
  it("formats ranges and checks real lines against them", () => {
    expect(rangeText([9.2, 25.3])).toBe("9–25");
    expect(inRange(line(null), "pts")).toBeNull();
    expect(inRange(line({ minutes: 33, pts: 25, reb: 3, ast: 5 }), "pts")).toBe(true);
    expect(inRange(line({ minutes: 33, pts: 25, reb: 3, ast: 5 }), "reb")).toBe(false);
  });

  it("knows who didn't play", () => {
    const dnp = line({ minutes: 0, pts: null, reb: null, ast: null });
    expect(didNotPlay(dnp)).toBe(true);
    expect(inRange(dnp, "pts")).toBeNull();
    expect(didNotPlay(line(null))).toBe(false);
  });
});
