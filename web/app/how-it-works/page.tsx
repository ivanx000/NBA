import type { Metadata } from "next";
import Link from "next/link";

import { Chapter } from "@/components/how-it-works/chapter";
import { HologramStage } from "@/components/how-it-works/hologram-stage";
import { ChanceFigure, FeatureBars, Figure, GamesGrid, Scorecard, Waterfall } from "@/components/how-it-works/visuals";
import "@/components/how-it-works/story.css";
import { pageMeta } from "@/lib/site";
import { FACTOR_COUNT, FEATURE_COUNT, LEARNED_GAMES, SEASON_GAMES, TEST_SEASON } from "@/lib/story";

export const metadata: Metadata = pageMeta({
  title: "How it works · Tip-Off",
  description:
    "From box scores to tonight's pick in five steps: the data, the numbers, the model, the prediction and the 3D shot. Unofficial fan project.",
  path: "/how-it-works",
});

const ALL_GAMES = SEASON_GAMES.reduce((n, s) => n + s.games, 0);

const STEPS = [
  { id: "data", name: "Data" },
  { id: "features", name: "Features" },
  { id: "model", name: "Model" },
  { id: "prediction", name: "Prediction" },
  { id: "animation", name: "Animation" },
];

export default function Page() {
  return (
    <main id="main" className="story">
      <header className="story-hero">
        <h1 className="story-hero__title">How it works</h1>
        <p className="story-hero__lede">
          Tip-Off picks a winner for every NBA game before tip-off. Here&apos;s how it gets there, following one
          example game, the Celtics at the Knicks, through five steps.
        </p>
        <nav aria-label="Steps" className="story-rail">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span aria-hidden>{i + 1}</span>
                  {s.name}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <Chapter
        id="data"
        step={1}
        name="Data"
        title="Eleven seasons of box scores"
        figure={<Figure value={ALL_GAMES}>regular-season games since 2015-16</Figure>}
        visual={<GamesGrid />}
      >
        <p>
          It starts with every regular-season game since 2015-16: the final score and each team&apos;s box score,
          from NBA.com&apos;s public stats. Each dot is one game. The two short seasons are 2019-20, cut short by
          the pandemic, and 2020-21, shortened after it.
        </p>
        <p>
          The model learns from ten seasons. The eleventh, 2025-26, was kept back and used once, at the very end,
          to check it honestly. Every morning, last night&apos;s games are added.
        </p>
      </Chapter>

      <Chapter
        id="features"
        step={2}
        name="Features"
        title="Turning a matchup into numbers"
        figure={<Figure value={FEATURE_COUNT}>numbers describe each game</Figure>}
        visual={<FeatureBars />}
      >
        <p>
          Before each game, both teams are summed up in {FEATURE_COUNT} numbers: how strong they are, how
          they&apos;ve played lately, how they shoot, how rested they are, how far they traveled and who&apos;s
          missing. Most compare the two teams directly.
        </p>
        <p>
          The rule that matters most: every number uses only games played before tip-off. Nothing from the game
          itself, or after it, can leak in. A test checks this on every change.
        </p>
      </Chapter>

      <Chapter
        id="model"
        step={3}
        name="Model"
        title="Weighing the evidence"
        figure={<ChanceFigure />}
        visual={<Waterfall />}
      >
        <p>
          The model is a logistic regression: each number nudges the odds toward one team or the other, and it
          learned how hard each one nudges from {LEARNED_GAMES.toLocaleString("en-US")} past games. Fancier models
          were tried; this plain one did as well and is easy to explain.
        </p>
        <p>
          Its {FEATURE_COUNT} nudges are grouped into {FACTOR_COUNT} reasons you can read, and they add up exactly to
          the prediction. In the example, rest, ratings and Boston&apos;s missing players outweigh the Celtics&apos;
          better form.
        </p>
      </Chapter>

      <Chapter
        id="prediction"
        step={4}
        name="Prediction"
        title={"Published before tip\u2011off, graded after"}
        figure={
          <Figure value={TEST_SEASON.accuracy.model} unit="percent">
            of {TEST_SEASON.season}&apos;s {TEST_SEASON.games.toLocaleString("en-US")} games called right
          </Figure>
        }
        visual={<Scorecard />}
      >
        <p>
          Every morning a scheduled job makes the day&apos;s predictions and saves them. Once a game tips off, its
          prediction can&apos;t change, and when it ends it&apos;s graded against the final score.
        </p>
        <p>
          On the season kept back for the test, it called 67% of games right: far better than always picking the
          home team, and about two points behind Elo, a simple rating system that&apos;s hard to beat. Good NBA
          game models land in the mid to high 60s, so the site doesn&apos;t promise more.
        </p>
        <p>
          <Link href="/performance" className="story-link">
            See the full report card
          </Link>
        </p>
      </Chapter>

      <Chapter id="animation" step={5} name="Animation" title="Your call, in 3D" visual={<HologramStage />}>
        <p>
          On the home page, a player from each team stands on a platform as a hologram. Click the one you think
          wins and he takes the shot. It drops if your pick is right: by the final score once the game is over,
          or by the model&apos;s call before then.
        </p>
        <p>
          Then the reasons and both teams&apos; numbers come up, and you can switch to the other team or pick
          another game.
        </p>
        <p className="story-actions">
          <Link href="/" className="story-cta">
            Pick tonight&apos;s winner
          </Link>
          <Link href="/docs" className="story-link">
            Read the technical docs
          </Link>
        </p>
      </Chapter>
    </main>
  );
}
