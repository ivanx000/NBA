import { ImageResponse } from "next/og";

import { shortDate, tipoffET } from "@/lib/dates";
import { getGameDetail } from "@/lib/db/queries";
import { actualWinner, winProb } from "@/lib/slate";
import { hologramMatchup } from "@/lib/team-colors";
import { requireTeam } from "@/lib/teams";

export const alt = "Tip-Off: the model's win chance for this NBA game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#02040a";

/** The link preview for a game: the matchup, the model's win chance in the teams' colors. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getGameDetail(id);
  if (!detail) {
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: "100%", height: "100%", background: BG, color: "#f3f6fc", fontSize: 64, alignItems: "center", justifyContent: "center" }}>
          Tip-Off
        </div>
      ),
      size,
    );
  }
  const { game } = detail;
  const colors = hologramMatchup(requireTeam(game.home.teamId), requireTeam(game.away.teamId));
  const homeP = winProb(game, "home");
  const actual = actualWinner(game);
  const when =
    actual !== null
      ? `${shortDate(game.gameDate)} · Final ${game.away.abbr} ${game.awayScore}–${game.homeScore} ${game.home.abbr}`
      : `${shortDate(game.gameDate)} · ${tipoffET(game.tipoffUtc) ?? ""}`;
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "64px 72px",
          background: `radial-gradient(ellipse 80% 60% at 50% 0%, #1d428a 0%, ${BG} 70%)`,
          color: "#f3f6fc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#ff4d5e", textTransform: "uppercase" }}>
          {when}
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 92, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>
          {game.away.name}
          <span style={{ fontSize: 44, color: "#a8b3cc", margin: "0 28px", alignSelf: "center" }}>at</span>
          {game.home.name}
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        {homeP !== null ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 56, fontWeight: 800 }}>
              <span style={{ color: colors.away.color }}>
                {game.away.abbr} {pct(1 - homeP)}
              </span>
              <span style={{ color: colors.home.color }}>
                {pct(homeP)} {game.home.abbr}
              </span>
            </div>
            <div style={{ display: "flex", marginTop: 16, height: 18, borderRadius: 9, overflow: "hidden" }}>
              <div style={{ display: "flex", width: `${(1 - homeP) * 100}%`, background: colors.away.color }} />
              <div style={{ display: "flex", width: 6, background: BG }} />
              <div style={{ display: "flex", width: `${homeP * 100}%`, background: colors.home.color }} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 40, color: "#a8b3cc" }}>Prediction published on game day</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, fontSize: 24, color: "#a8b3cc" }}>
          <span style={{ fontWeight: 800, color: "#f3f6fc", letterSpacing: 2 }}>TIP-OFF</span>
          <span>Model win chance · Unofficial fan project, not affiliated with the NBA</span>
        </div>
      </div>
    ),
    size,
  );
}
