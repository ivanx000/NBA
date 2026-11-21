"""`tipoff` command-line interface. Every command is a stub until its roadmap phase."""

import logging
from collections import Counter
from datetime import date
from enum import StrEnum
from typing import Annotated

import typer
from sqlalchemy.exc import SQLAlchemyError

from tipoff import __version__
from tipoff.config import CURRENT_SEASON, WARMUP_SEASON

app = typer.Typer(
    name="tipoff",
    help="Tip-Off ML pipeline: ingest, features, train, predict, publish.",
    no_args_is_help=True,
    add_completion=False,
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"tipoff {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option("--version", callback=_version_callback, is_eager=True, help="Show version."),
    ] = False,
) -> None:
    """Tip-Off ML pipeline."""


class Source(StrEnum):
    stats = "stats"
    cdn = "cdn"
    injury = "injury"
    all = "all"


@app.command()
def ingest(
    seasons: Annotated[
        str, typer.Option(help="Season range, e.g. 2014-15:2026-27.")
    ] = f"{WARMUP_SEASON}:{CURRENT_SEASON}",
    source: Annotated[
        Source,
        typer.Option(
            help="stats = stats.nba.com (local only); cdn = cdn.nba.com; injury = the official "
            "injury report PDFs (morning and evening snapshots since 2019-20)."
        ),
    ] = Source.all,
    force: Annotated[bool, typer.Option(help="Re-fetch even if cached.")] = False,
    dry_run: Annotated[bool, typer.Option(help="Show what would be fetched.")] = False,
    stage: Annotated[bool, typer.Option(help="Stage and validate tables afterwards.")] = True,
    verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False,
) -> None:
    """Fetch and cache raw NBA data, then stage and validate it. Idempotent.

    stats.nba.com blocks cloud IPs: only run `--source stats` on a local machine.
    """
    from tipoff.ingest import nba_cdn, nba_stats
    from tipoff.seasons import parse_season_range

    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        season_list = parse_season_range(seasons)
    except ValueError as e:
        raise typer.BadParameter(str(e), param_hint="--seasons") from e

    if source in (Source.stats, Source.all):
        tasks = nba_stats.plan_tasks(season_list)
        results = nba_stats.ingest_stats(tasks, force=force, dry_run=dry_run)
        for r in results:
            if r.action != "skipped" or verbose:
                detail = f" ({r.reason})" if r.reason else ""
                typer.echo(f"{r.action:>9}  {r.task.key}  rows={r.rows}{detail}")
        counts = Counter(r.action for r in results)
        typer.echo("stats: " + ", ".join(f"{n} {a}" for a, n in sorted(counts.items())))

    if source in (Source.cdn, Source.all) and not dry_run:
        schedule = nba_cdn.ingest_schedule()
        board = nba_cdn.ingest_scoreboard()
        typer.echo(f"cdn: schedule {len(schedule)} games, scoreboard {len(board)} games")

    if stage and not dry_run and source in (Source.stats, Source.all):
        from tipoff.ingest.stage import stage_all

        for name, n in stage_all().items():
            typer.echo(f"staged: {name} rows={n}")

    if source in (Source.injury, Source.all) and not dry_run:
        from tipoff.config import STAGED_DIR
        from tipoff.ingest.injury_report import ingest_staged

        res = ingest_staged(STAGED_DIR, progress=verbose)
        typer.echo(f"injury: {res['snapshots']} snapshots staged ({res['with_report']} with a "
                   f"report, {res['rows']} rows)")  # fmt: skip


@app.command()
def features(
    tune_elo: Annotated[
        bool, typer.Option(help="Re-tune Elo parameters on the training seasons first.")
    ] = False,
    fit_injury_probs: Annotated[
        bool,
        typer.Option(help="Re-measure each injury status's chance of playing (2019-20..2023-24)."),
    ] = False,
) -> None:
    """Build the leakage-safe feature tables: games (game_features.parquet) and players
    (player_features.parquet), in data/features/."""
    import json

    import pandas as pd

    from tipoff.config import ELO_PARAMS_PATH, STAGED_DIR
    from tipoff.features import elo
    from tipoff.features.build import build_and_save
    from tipoff.features.players import build_and_save_players
    from tipoff.features.timeline import prepare_games

    if tune_elo or not ELO_PARAMS_PATH.exists():
        games = prepare_games(pd.read_parquet(STAGED_DIR / "games.parquet"))
        params, loss = elo.tune(games)
        params.save(train_log_loss=round(loss, 5), tuned_on="2015-16..2023-24 regular season")
        typer.echo(f"elo: tuned {params} (train log loss {loss:.4f}) -> {ELO_PARAMS_PATH.name}")
    from tipoff.features.injury import PLAY_PROBS_PATH, fit_play_probs
    from tipoff.ingest.injury_report import load_staged

    if fit_injury_probs or not PLAY_PROBS_PATH.exists():
        inj = load_staged(STAGED_DIR, "am")
        if inj is None:
            raise typer.BadParameter(
                "no staged injury reports; run `tipoff ingest --source injury`"
            )
        fitted = fit_play_probs(inj, pd.read_parquet(STAGED_DIR / "player_games.parquet"))
        fitted["fit_on"] = "morning reports, 2019-20..2023-24"
        PLAY_PROBS_PATH.write_text(json.dumps(fitted, indent=2) + "\n")
        typer.echo(f"injury: chance of playing by status {fitted['play_probs']} "
                   f"-> {PLAY_PROBS_PATH.name}")  # fmt: skip
    df, digest = build_and_save()
    typer.echo(f"features: {len(df):,} games, hash {digest}")
    players, p_digest = build_and_save_players()
    typer.echo(
        f"features: {int(players['in_scope'].sum()):,} player-games in scope "
        f"({len(players):,} rows), hash {p_digest}"
    )


class ModelSet(StrEnum):
    baselines = "baselines"
    game = "game"
    champion = "champion"
    player = "player"
    player_champion = "player-champion"


@app.command()
def train(
    only: Annotated[ModelSet, typer.Option(help="Which models to train.")] = ModelSet.baselines,
    mlflow_log: Annotated[bool, typer.Option("--mlflow/--no-mlflow")] = True,
    trials: Annotated[int, typer.Option(help="Optuna trials for LightGBM (game only).")] = 100,
) -> None:
    """Train on 2015-16..2023-24, evaluate on 2024-25, log runs to MLflow.

    `--only game` tunes LightGBM, picks calibration and the champion kind, and writes
    ml/config/game_model.json. It never touches the test season.

    `--only player` picks the player projection models on 2024-25 (ml/config/player_model.json);
    `--only player-champion` fits them on everything and registers tipoff-player@champion.
    """
    from tipoff.evaluate.metrics import to_markdown

    if only is ModelSet.player:
        from tipoff.models.train_player import select_player

        out = select_player(log_to_mlflow=mlflow_log)
        typer.echo(f"player point projections: {out['config']['point']}")
        typer.echo(out["table"].round(4).to_string())
        return
    if only is ModelSet.player_champion:
        from tipoff.models.train_player import train_player_champion

        info = train_player_champion()
        typer.echo(
            f"registered tipoff-player v{info['version']} @champion: "
            f"{info['n_train']:,} player-games through {info['through']}"
        )
        return

    if only is ModelSet.champion:
        from tipoff.models.final import train_champion

        info = train_champion()
        typer.echo(
            f"registered tipoff-game v{info['version']} @champion: {info['kind']}, "
            f"{info['n_train']:,} games through {info['through']}"
        )
        return
    if only is ModelSet.baselines:
        from tipoff.models.train_baselines import run_baselines

        out = run_baselines(log_to_mlflow=mlflow_log)
    else:
        from tipoff.models.train_game import select

        out = select(n_trials=trials, log_to_mlflow=mlflow_log)
        cfg = out["config"]
        typer.echo(f"champion kind: {cfg['kind']} ({cfg['calibration']} calibration)")
    typer.echo(to_markdown(out["table"]))


@app.command()
def evaluate(
    test: Annotated[bool, typer.Option("--test", help="Run the one-time 2025-26 test.")] = False,
    force_retest: Annotated[bool, typer.Option(help="Allow re-running the test.")] = False,
    backtest: Annotated[bool, typer.Option(help="Also run the 2025-26 walk-forward.")] = True,
    player: Annotated[
        bool, typer.Option("--player", help="Evaluate the player projections instead.")
    ] = False,
) -> None:
    """Final evaluation on the test season (once) and the monthly walk-forward backtest."""
    from tipoff.evaluate.metrics import to_markdown
    from tipoff.models.final import TestAlreadyRunError, final_test, walk_forward

    if player:
        from tipoff.models import train_player

        if not test:
            raise typer.BadParameter("the player models only have the one-time --test")
        try:
            out = train_player.final_test_player(force=force_retest)
        except train_player.TestAlreadyRunError as e:
            raise typer.BadParameter(str(e), param_hint="--test") from e
        typer.echo("player test:\n" + out["table"].round(4).to_string())
        return

    if test:
        try:
            out = final_test(force=force_retest)
        except TestAlreadyRunError as e:
            raise typer.BadParameter(str(e), param_hint="--test") from e
        typer.echo("final test:\n" + to_markdown(out["table"]))
    if backtest:
        from tipoff.models.final import factor_importance

        wf = walk_forward()
        typer.echo("walk-forward:\n" + to_markdown(wf["table"]))
        fi = factor_importance()
        typer.echo("factor importance (mean |pp|):\n" + fi.round(4).to_string())


class DbTarget(StrEnum):
    dev = "dev"
    prod = "prod"


TargetOpt = Annotated[DbTarget, typer.Option("--target", help="Neon branch to write to.")]
DateOpt = Annotated[str, typer.Option("--date", help="ET schedule date (YYYY-MM-DD) or 'today'.")]


def _day(value: str) -> date:
    from tipoff.db import today_et

    return today_et() if value == "today" else date.fromisoformat(value)


@app.command()
def sync(target: TargetOpt = DbTarget.dev) -> None:
    """Upsert the current season's games from cdn.nba.com (safe in CI)."""
    from tipoff.db import get_engine
    from tipoff.publish.sync import sync_games

    n = sync_games(get_engine(target.value))
    typer.echo(f"sync: {n} games upserted ({target.value})")


class ModelSource(StrEnum):
    mlflow = "mlflow"
    db = "db"


class Snapshot(StrEnum):
    am = "am"
    pm = "pm"


def _injuries_for(day: date, snapshot: Snapshot):
    """The staged injury report snapshots plus ``day``'s; (None, False) if the report can't be
    had (predictions go out without it rather than not at all). The flag says whether ``day``'s
    snapshot was newly staged."""
    from tipoff.config import STAGED_DIR
    from tipoff.ingest.injury_report import day_snapshot

    try:
        inj, staged = day_snapshot(STAGED_DIR, day, snapshot.value)
    except Exception as e:
        typer.echo(f"injury: report unavailable ({type(e).__name__}: {e}); predicting without it",
                   err=True)  # fmt: skip
        return None, False
    if inj is None:
        typer.echo("injury: no staged reports; predicting without them", err=True)
        return None, staged
    import pandas as pd

    today = inj[inj["game_date"] == pd.Timestamp(day)]
    typer.echo(f"injury: {snapshot.value} report for {day}: {len(today)} rows"
               f"{' (newly staged)' if staged else ''}")  # fmt: skip
    return inj, staged


@app.command()
def predict(
    date_: DateOpt = "today",
    model_source: Annotated[
        ModelSource, typer.Option(help="mlflow = local registry; db = pipeline_state (cloud).")
    ] = ModelSource.mlflow,
    target: TargetOpt = DbTarget.dev,
    players: Annotated[
        bool, typer.Option("--players/--no-players", help="Also project player lines.")
    ] = True,
    snapshot: Annotated[
        Snapshot,
        typer.Option(help="Injury report as of 09:00 ET (am) or 17:45 ET (pm) on game day."),
    ] = Snapshot.am,
    injury: Annotated[
        bool, typer.Option("--injury/--no-injury", help="Use the official injury report.")
    ] = True,
) -> bool:
    """Predict a date's scheduled games with the champion, and project the players' lines
    with the player champion (writes data/predictions/live and data/predictions/players).
    Returns whether the day's injury report snapshot was newly staged."""
    from tipoff.db import get_engine
    from tipoff.predict.run import predict_date

    day = _day(date_)
    engine = get_engine(target.value) if model_source is ModelSource.db else None
    inj, staged = _injuries_for(day, snapshot) if injury else (None, False)
    preds = predict_date(day, model_source=model_source.value, engine=engine, injuries=inj,
                         snapshot=snapshot.value)  # fmt: skip
    if preds.empty:
        typer.echo(f"predict: no unplayed regular-season games on {day}")
        return staged
    for r in preds.itertuples(index=False):
        typer.echo(f"{r.game_id}  P(home) {r.home_win_prob:.3f}  (Elo {r.elo_home_win_prob:.3f})")
    if players:
        _project_players(day, model_source, engine, inj)
    return staged


def _project_players(day: date, model_source: ModelSource, engine, injuries=None) -> None:
    """Project player lines; a missing player champion is reported, not fatal (games come first)."""
    from mlflow.exceptions import MlflowException

    from tipoff.predict.players import project_date
    from tipoff.state import StateError

    try:
        proj = project_date(day, model_source=model_source.value, engine=engine,
                            injuries=injuries)  # fmt: skip
    except (StateError, MlflowException) as e:
        typer.echo(f"players: no player champion available ({e}); skipping projections", err=True)
        return
    if proj.empty:
        typer.echo(f"players: nobody to project on {day}")
        return
    typer.echo(f"players: {len(proj)} projections for {proj['game_id'].nunique()} games "
               f"({proj['model_version'].iloc[0]})")  # fmt: skip


@app.command()
def publish(date_: DateOpt = "today", target: TargetOpt = DbTarget.dev) -> None:
    """Publish a date's predictions (from `tipoff predict`) with the pregame-only guard."""
    import pandas as pd

    from tipoff.config import PREDICTIONS_DIR
    from tipoff.db import get_engine
    from tipoff.publish.publish import publish as do_publish

    day = _day(date_)
    path = PREDICTIONS_DIR / "live" / f"{day.isoformat()}.parquet"
    if not path.exists():
        raise typer.BadParameter(f"{path.name} not found; run `tipoff predict --date {day}`.")
    engine = get_engine(target.value)
    res = do_publish(engine, pd.read_parquet(path))
    typer.echo(f"publish: {res.written} predictions written to {target.value}; "
               f"skipped (already started): {res.skipped_started or 'none'}")  # fmt: skip
    player_path = PREDICTIONS_DIR / "players" / f"{day.isoformat()}.parquet"
    if player_path.exists():
        from tipoff.publish.players import publish_projections

        try:
            pres = publish_projections(engine, pd.read_parquet(player_path))
        except SQLAlchemyError as e:
            typer.echo(f"publish: player projections failed ({type(e).__name__}); "
                       "game predictions are unaffected", err=True)  # fmt: skip
            return
        typer.echo(f"publish: {pres.written} player projections for {pres.games} games; "
                   f"skipped (already started): {pres.skipped_started or 'none'}")  # fmt: skip


class BackfillWhat(StrEnum):
    games = "games"
    players = "players"


@app.command()
def backfill(
    seasons: Annotated[
        str | None,
        typer.Option(help="Comma-separated seasons (games: 2025-26,2026-27; players: current)."),
    ] = None,
    what: Annotated[BackfillWhat, typer.Option("--what")] = BackfillWhat.games,
    target: TargetOpt = DbTarget.dev,
) -> None:
    """Weekly walk-forward predictions for past games, published with source='backfill'."""
    from tipoff.db import get_engine

    engine = get_engine(target.value)
    if what is BackfillWhat.players:
        from tipoff.models.train_player import load_player_champion
        from tipoff.predict.players import backfill_projections, save
        from tipoff.publish.players import publish_projections

        champion, info = load_player_champion()
        version = info["model_version"] + "-wf"
        chosen = (seasons or CURRENT_SEASON).split(",")
        proj = backfill_projections(chosen, version, widen=champion.widen)
        save(proj, "backfill")
        res = publish_projections(engine, proj)
        typer.echo(f"backfill: {res.written} player projections for {res.games} games "
                   f"({version}) written to {target.value}")  # fmt: skip
        return
    from tipoff.predict.backfill import backfill_predictions, save
    from tipoff.predict.run import champion_info
    from tipoff.publish.publish import publish as do_publish

    version = champion_info()["model_version"] + "-wf"
    preds = backfill_predictions((seasons or "2025-26,2026-27").split(","), version)
    save(preds, "backfill")
    res = do_publish(engine, preds)
    typer.echo(f"backfill: {res.written} predictions ({version}) written to {target.value}")


@app.command()
def results(target: TargetOpt = DbTarget.dev) -> None:
    """Fill in projected players' real lines for games in the staged box scores."""
    import pandas as pd

    from tipoff.config import STAGED_DIR
    from tipoff.db import get_engine
    from tipoff.publish.players import record_results

    n = record_results(get_engine(target.value),
                       pd.read_parquet(STAGED_DIR / "player_games.parquet"),
                       pd.read_parquet(STAGED_DIR / "games.parquet"))  # fmt: skip
    typer.echo(f"results: {n} projected lines filled in ({target.value})")


@app.command()
def stats(
    target: TargetOpt = DbTarget.dev,
    rewrite: Annotated[
        bool, typer.Option(help="Rewrite every game in scope, not just new ones.")
    ] = False,
) -> None:
    """Write this season's and last season's box scores for the site's advanced stats."""
    import pandas as pd

    from tipoff.config import STAGED_DIR
    from tipoff.db import get_engine
    from tipoff.publish.stats import publish_stats

    res = publish_stats(get_engine(target.value),
                        pd.read_parquet(STAGED_DIR / "team_games.parquet"),
                        pd.read_parquet(STAGED_DIR / "player_games.parquet"),
                        only_new=not rewrite)  # fmt: skip
    typer.echo(
        f"stats: {res.games} games ({res.team_rows} team rows, {res.player_rows} player rows) "
        f"written to {target.value}; {res.skipped_unsynced} not synced yet"
    )


@app.command("freshness-check")
def freshness_check(
    date_: DateOpt = "today",
    target: TargetOpt = DbTarget.dev,
    upcoming_only: Annotated[bool, typer.Option(help="Ignore games already started.")] = False,
) -> None:
    """Exit 1 if any scheduled game on the date lacks a live pregame prediction."""
    from tipoff.db import get_engine
    from tipoff.publish.freshness import missing_predictions

    day = _day(date_)
    missing = missing_predictions(get_engine(target.value), day, upcoming_only=upcoming_only)
    if missing:
        typer.echo(f"freshness: {len(missing)} game(s) on {day} have no prediction: {missing}")
        raise typer.Exit(1)
    scope = "all upcoming games" if upcoming_only else "all games"
    typer.echo(f"freshness: {scope} on {day} have predictions")


@app.command()
def daily(
    target: Annotated[DbTarget, typer.Option("--target")] = DbTarget.prod,
    if_needed: Annotated[
        bool, typer.Option(help="Do nothing if today's games already have predictions.")
    ] = False,
    cloud: Annotated[
        bool,
        typer.Option(
            help="GitHub Actions mode: cdn.nba.com box scores + state from Postgres. "
            "Never calls stats.nba.com."
        ),
    ] = False,
    refresh: Annotated[
        bool,
        typer.Option(
            help="Evening run: once the 17:45 ET injury report snapshot is due, re-predict and "
            "re-publish today's games that haven't started (once a day)."
        ),
    ] = False,
) -> None:
    """The daily job: new results -> stage -> sync -> predict and project today (ET) ->
    publish -> fill projected players' actual lines -> box scores for the advanced stats."""
    from tipoff.db import get_engine, today_et
    from tipoff.publish.freshness import missing_predictions

    day = today_et()
    engine = get_engine(target.value)
    if refresh:
        _refresh(day, target, engine, cloud)
        return
    if if_needed and not missing_predictions(engine, day, upcoming_only=True):
        typer.echo(f"daily: nothing left to publish for {day} on {target.value}")
        return
    if cloud:
        _cloud_update(engine)
    else:
        ingest(seasons=f"{CURRENT_SEASON}:{CURRENT_SEASON}", source=Source.all, force=False,
               dry_run=False, stage=True, verbose=False)  # fmt: skip
    sync(target=target)
    source = ModelSource.db if cloud else ModelSource.mlflow
    staged = predict(date_=day.isoformat(), model_source=source, target=target, players=True,
                     snapshot=Snapshot.am, injury=True)  # fmt: skip
    if cloud and staged:
        _push_injuries(engine)
    publish(date_=day.isoformat(), target=target)
    # Player steps come after the game predictions are out, and never stop the job.
    try:
        results(target=target)
    except SQLAlchemyError as e:
        typer.echo(f"results: failed ({type(e).__name__}); game predictions are unaffected",
                   err=True)  # fmt: skip
    try:
        stats(target=target)
    except SQLAlchemyError as e:
        typer.echo(f"stats: failed ({type(e).__name__}); game predictions are unaffected",
                   err=True)  # fmt: skip
    freshness_check(date_=day.isoformat(), target=target, upcoming_only=True)


def _push_injuries(engine) -> None:
    from tipoff.state import push_staged

    push_staged(engine)
    typer.echo("state: staged pushed (with the new injury report snapshot)")


def _refresh(day: date, target: DbTarget, engine, cloud: bool) -> None:
    """The evening re-publish with the 17:45 ET injury report (see ``daily --refresh``)."""
    from datetime import datetime

    from tipoff.config import STAGED_DIR
    from tipoff.ingest.injury_report import ET, SNAPSHOTS, SNAPSHOTS_FILE

    now_et = datetime.now(ET)
    if now_et.time() < SNAPSHOTS["pm"]:
        typer.echo(f"refresh: the evening snapshot is due at {SNAPSHOTS['pm']} ET; not yet")
        return
    if cloud:
        _cloud_update(engine)
    snaps_path = STAGED_DIR / SNAPSHOTS_FILE
    if snaps_path.exists():
        import pandas as pd

        snaps = pd.read_parquet(snaps_path)
        if ((snaps["game_date"] == pd.Timestamp(day)) & (snaps["snapshot"] == "pm")).any():
            typer.echo(f"refresh: {day} already refreshed")
            return
    sync(target=target)
    source = ModelSource.db if cloud else ModelSource.mlflow
    staged = predict(date_=day.isoformat(), model_source=source, target=target, players=True,
                     snapshot=Snapshot.pm, injury=True)  # fmt: skip
    if not staged:
        typer.echo("refresh: no evening injury report snapshot; nothing re-published")
        return
    if cloud:
        _push_injuries(engine)
    publish(date_=day.isoformat(), target=target)


def _cloud_update(engine) -> None:
    """Pull staged history, add newly finished games from cdn box scores, push it back."""
    import pandas as pd

    from tipoff.config import STAGED_DIR
    from tipoff.ingest import nba_cdn
    from tipoff.ingest.cdn_box import ingest_boxscores, missing_final_games
    from tipoff.ingest.stage import stage_incremental
    from tipoff.state import pull_staged, push_staged

    meta = pull_staged(engine)
    typer.echo(f"state: pulled staged history through {meta.get('through')}")
    schedule = nba_cdn.ingest_schedule()
    nba_cdn.ingest_scoreboard()
    todo = missing_final_games(schedule, pd.read_parquet(STAGED_DIR / "games.parquet"))
    if todo.empty:
        typer.echo("cdn box scores: no new finished games")
        return
    teams, players = ingest_boxscores(todo)
    counts = stage_incremental(teams, players)
    push_staged(engine)
    typer.echo(f"cdn box scores: {len(todo)} new games staged {counts}; state pushed")


@app.command()
def retrain(
    target: Annotated[DbTarget, typer.Option("--target")] = DbTarget.prod,
    pull: Annotated[
        bool, typer.Option("--pull/--no-pull", help="Pull the staged history from pipeline_state.")
    ] = True,
    dry_run: Annotated[bool, typer.Option(help="Evaluate only; push nothing.")] = False,
    summary: Annotated[str | None, typer.Option(help="Write the markdown report here.")] = None,
    decision: Annotated[str | None, typer.Option(help="Write the decisions (JSON) here.")] = None,
) -> None:
    """Weekly retrain: refit both models, promote each only if no worse than what was published.

    Compares a weekly walk-forward of each champion's recipe over the last 4 complete weeks with
    the stored pregame predictions and projections for the same games (models/retrain.py). Uses
    only the staged history (cdn.nba.com in the cloud), never stats.nba.com.
    """
    import json
    from pathlib import Path

    from tipoff.db import get_engine
    from tipoff.models.retrain import run_retrain

    result = run_retrain(get_engine(target.value), pull=pull, dry_run=dry_run)
    typer.echo(result.summary)
    if summary:
        Path(summary).write_text(result.summary)
    if decision:
        out = {
            "game": {"promote": result.game.promote, "reason": result.game.reason},
            "player": None if result.player is None
            else {"promote": result.player.promote, "reason": result.player.reason},
            "pushed": result.pushed,
            "dry_run": dry_run,
        }  # fmt: skip
        Path(decision).write_text(json.dumps(out, indent=2))


state_app = typer.Typer(help="Pipeline state in Postgres for the cloud daily job.")
app.add_typer(state_app, name="state")


class StateWhat(StrEnum):
    staged = "staged"
    injuries = "injuries"
    champion = "champion"
    player_champion = "player-champion"
    all = "all"


@state_app.command("push")
def state_push(
    what: Annotated[StateWhat, typer.Option("--what")] = StateWhat.all,
    target: TargetOpt = DbTarget.dev,
) -> None:
    """Upload local staged history and/or the MLflow champions to pipeline_state."""
    from tipoff.db import get_engine
    from tipoff.state import push_champion, push_staged

    engine = get_engine(target.value)
    if what in (StateWhat.staged, StateWhat.all):
        typer.echo(f"state: staged pushed ({push_staged(engine)[:12]}) to {target.value}")
    if what is StateWhat.injuries:
        from tipoff.state import push_injuries

        meta = push_injuries(engine)
        typer.echo(f"state: injury report tables added to {target.value}'s staged history "
                   f"(through {meta.get('through')})")  # fmt: skip
    if what in (StateWhat.champion, StateWhat.all):
        from tipoff.models.final import load_champion
        from tipoff.predict.run import champion_info

        info = champion_info()
        digest = push_champion(engine, load_champion(), info)
        typer.echo(f"state: champion {info['model_version']} pushed ({digest[:12]}) "
                   f"to {target.value}")  # fmt: skip
    if what in (StateWhat.player_champion, StateWhat.all):
        from tipoff.models.train_player import load_player_champion
        from tipoff.state import push_player_champion

        model, pinfo = load_player_champion()
        digest = push_player_champion(engine, model, pinfo)
        typer.echo(f"state: player champion {pinfo['model_version']} pushed ({digest[:12]}) "
                   f"to {target.value}")  # fmt: skip


@state_app.command("pull")
def state_pull(target: TargetOpt = DbTarget.dev) -> None:
    """Download staged history from pipeline_state into data/staged."""
    from tipoff.db import get_engine
    from tipoff.state import pull_staged

    meta = pull_staged(get_engine(target.value))
    typer.echo(f"state: staged pulled ({meta})")
