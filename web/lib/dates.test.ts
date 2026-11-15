import { describe, expect, it } from "vitest";

import { addDays, dayLabel, parseDay, seasonFor, tipoffET, todayET } from "@/lib/dates";

describe("dates", () => {
  it("uses the ET schedule day", () => {
    // 2026-11-15 03:30 UTC is still Nov 14 in New York.
    expect(todayET(new Date("2026-11-15T03:30:00Z"))).toBe("2026-11-14");
    expect(todayET(new Date("2026-11-15T05:30:00Z"))).toBe("2026-11-15");
  });

  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("validates date parameters", () => {
    expect(parseDay("2026-11-14")).toBe("2026-11-14");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("tomorrow")).toBeNull();
    expect(parseDay(["2026-11-14"])).toBeNull();
    expect(parseDay("1999-01-01")).toBeNull();
  });

  it("maps days to seasons and labels", () => {
    expect(seasonFor("2026-11-14")).toBe("2026-27");
    expect(seasonFor("2027-04-10")).toBe("2026-27");
    expect(dayLabel("2026-11-14", "2026-11-14")).toBe("Tonight");
    expect(dayLabel("2026-11-15", "2026-11-14")).toBe("Tomorrow");
    expect(dayLabel("2026-11-20", "2026-11-14")).toBe("Fri, Nov 20");
    expect(tipoffET("2026-11-15T00:30:00Z")).toBe("7:30 PM ET");
  });
});
