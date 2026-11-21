import type { Metadata } from "next";
import Link from "next/link";

import { Chapter } from "@/components/how-it-works/chapter";
import { HologramStage } from "@/components/how-it-works/hologram-stage";
import { StoryProgress } from "@/components/how-it-works/story-progress";
import { ChanceFigure, FeatureBars, Figure, GamesGrid, Scorecard, Waterfall } from "@/components/how-it-works/visuals";
import "@/components/how-it-works/story.css";
import { pageMeta } from "@/lib/site";
import {
  ADJUSTED_FEATURE_COUNT,
  FACTOR_COUNT,
  FEATURE_COUNT,
  LEARNED_GAMES,
  SEASON_GAMES,
  TEST_SEASON,
} from "@/lib/story";

export const metadata: Metadata = pageMeta({
  title: "How it works · NBA Game Predictor",
  description:
    "From box scores to tonight's pick in five steps: the data, the numbers, the model, the prediction and the 3D shot.",
  path: "/how-it-works",
});

const ALL_GAMES = SEASON_GAMES.reduce((n, s) => n + s.games, 0);

const STEPS = [
  { id: "data", name: "Data", hint: "Eleven seasons of box scores" },
  { id: "features", name: "Features", hint: "A matchup as 56 numbers" },
  { id: "model", name: "Model", hint: "Weighing the evidence" },
  { id: "prediction", name: "Prediction", hint: "Published, then graded" },
  { id: "animation", name: "Animation", hint: "Your call, in 3D" },
];

export default function Page() {
  return (
    <main id="main" className="story">
      <header className="story-hero">
        <h1 className="story-hero__title">How it works</h1>
        <p className="story-hero__lede">
          The model picks a winner for every NBA game before tip-off. Here&apos;s how it gets there, following one
          example game, the Celtics at the Knicks, through five steps.
        </p>
        <nav aria-label="Steps" className="story-index">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="story-index__n" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="story-index__name">{s.name}</span>
                  <span className="story-index__hint">{s.hint}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <a href="#data" className="story-scroll" aria-hidden tabIndex={-1}>
          <span>Scroll</span>
          <i />
        </a>
      </header>
      <StoryProgress steps={STEPS} />

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
          The model starts from Elo, a simple rating that rises when a team wins and falls when it loses, and lets {ADJUSTED_FEATURE_COUNT} of the numbers nudge it toward one
          team or the other: rest, travel, who&apos;s missing or on the injury report, recent form. It learned how hard each one nudges from{" "}
          {LEARNED_GAMES.toLocaleString("en-US")} past games, and the nudges are kept small, so one noisy number
          can&apos;t pull it far from Elo. Fancier models were tried; this plain one beat Elo in each of the six
          seasons it was checked on, and it&apos;s easy to explain.
        </p>
        <p>
          Elo&apos;s part and the nudges are grouped into {FACTOR_COUNT} reasons you can read, and they add up exactly to
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
          Every morning a scheduled job makes the day&apos;s predictions and saves them, and updates them in the evening
          with the latest injury report. Once a game tips off, its
          prediction can&apos;t change, and when it ends it&apos;s graded against the final score.
        </p>
        <p>
          On the season kept back for the test, it called 68% of games right: far better than always picking the
          home team, and a point behind Elo, which is hard to beat. Its win chances were more accurate than
          Elo&apos;s, though, and that&apos;s what it&apos;s built for. Good NBA game models land in the mid to high
          60s, so the site doesn&apos;t promise more.
        </p>
        <p>
          <Link href="/performance" className="story-link">
            See the full report card
          </Link>
        </p>
      </Chapter>

      <Chapter id="animation" step={5} name="Animation" title="Your call, in 3D" visual={<HologramStage />}>
        <p>
          On the home page, a player from each team stands at center court as a hologram. Hover one and he steps
          forward; click the one you think wins and he takes the shot. It drops if your pick is right: by the final score once the game is over,
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
