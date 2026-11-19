import { actualWinner, predictedWinner, type SlateGame } from "@/lib/slate";

import "./game.css";

/** "Final · BOS 112–104 NYK · ✓ Model correct" for finished games; nothing otherwise. */
export function FinalBadge({ game }: { game: SlateGame }) {
  const actual = actualWinner(game);
  if (!actual) return null;
  const model = predictedWinner(game);
  const correct = model === actual;
  return (
    <p className="final-badge tabular" data-correct={model ? correct : undefined}>
      Final · {game.away.abbr} {game.awayScore}–{game.homeScore} {game.home.abbr}
      {model && (
        <>
          {" · "}
          <span aria-hidden>{correct ? "✓" : "✗"}</span> {correct ? "Model correct" : "Model missed"}
        </>
      )}
    </p>
  );
}
