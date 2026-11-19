"use client";

import { useEffect, useId, useState } from "react";

/**
 * A Mermaid diagram, drawn in the browser. Mermaid is large, so it's loaded only on pages that
 * use a diagram; until then (or without JavaScript) the source shows as text.
 */
export function Diagram({ chart, label }: { chart: string; label: string }) {
  const id = useId().replace(/:/g, "");
  // Mermaid's own SVG output from the chart text in this file (not user input).
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          fontFamily: "var(--font-archivo), system-ui, sans-serif",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            primaryColor: "#0d1631",
            primaryTextColor: "#f3f6fc",
            primaryBorderColor: "#5b8cff",
            lineColor: "#7f8db0",
            secondaryColor: "#1a1030",
            tertiaryColor: "#0a1022",
            clusterBkg: "rgba(91,140,255,0.06)",
            clusterBorder: "rgba(243,246,252,0.18)",
            edgeLabelBackground: "#0a1022",
            fontSize: "14px",
          },
        });
        const { svg } = await mermaid.render(`diagram-${id}`, chart);
        if (!cancelled) setSvg(svg);
      } catch {
        // Leave the source text showing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);
  return (
    <figure className="docs-diagram" role="img" aria-label={label}>
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <pre className="docs-diagram__source">{chart}</pre>}
    </figure>
  );
}
