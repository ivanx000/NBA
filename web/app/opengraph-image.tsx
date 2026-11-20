import { ImageResponse } from "next/og";

export const alt = "Tip-Off: who wins tonight? NBA game predictions in 3D. Unofficial fan project.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#02040a";

/** The default link preview (pages without their own): the name, the question, what's inside. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: `radial-gradient(ellipse 80% 60% at 50% 0%, #1d428a 0%, ${BG} 70%), ${BG}`,
          color: "#f3f6fc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: "#ff4d5e", textTransform: "uppercase" }}>
          Tip-Off
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 112, fontWeight: 800, lineHeight: 0.95, textTransform: "uppercase" }}>
          Who wins tonight?
        </div>
        <div style={{ display: "flex", marginTop: 24, width: 140, height: 6, borderRadius: 3, background: "#5b8cff" }} />
        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 36, color: "#c9d3ea" }}>
          Pick the winner, see what the model thinks, and how often it&apos;s right.
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 22, letterSpacing: 3, color: "#8b96b0", textTransform: "uppercase" }}>
          Unofficial fan project. Not affiliated with the NBA.
        </div>
      </div>
    ),
    size,
  );
}
