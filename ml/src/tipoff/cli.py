"""`tipoff` command-line interface. Every command is a stub until its roadmap phase."""

import logging
from collections import Counter
from datetime import date
from enum import StrEnum
from typing import Annotated

import typer

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
    all = "all"


@app.command()
def ingest(
    seasons: Annotated[
        str, typer.Option(help="Season range, e.g. 2014-15:2026-27.")
    ] = f"{WARMUP_SEASON}:{CURRENT_SEASON}",
    source: Annotated[
        Source, typer.Option(help="stats = stats.nba.com (local only); cdn = cdn.nba.com.")
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


@app.command()
def features(
    tune_elo: Annotated[
        bool, typer.Option(help="Re-tune Elo parameters on the training seasons first.")
    ] = False,
) -> None:
    """Build the leakage-safe game-level feature table (data/features/game_features.parquet)."""
    import pandas as pd

    from tipoff.config import ELO_PARAMS_PATH, STAGED_DIR
    from tipoff.features import elo
    from tipoff.features.build import build_and_save
    from tipoff.features.timeline import prepare_games

    if tune_elo or not ELO_PARAMS_PATH.exists():
        games = prepare_games(pd.read_parquet(STAGED_DIR / "games.parquet"))
        params, loss = elo.tune(games)
        params.save(train_log_loss=round(loss, 5), tuned_on="2015-16..2023-24 regular season")
        typer.echo(f"elo: tuned {params} (train log loss {loss:.4f}) -> {ELO_PARAMS_PATH.name}")
    df, digest = build_and_save()
    typer.echo(f"features: {len(df):,} games, hash {digest}")


class ModelSet(StrEnum):
    baselines = "baselines"
    game = "game"
    champion = "champion"


@app.command()
def train(
    only: Annotated[ModelSet, typer.Option(help="Which models to train.")] = ModelSet.baselines,
    mlflow_log: Annotated[bool, typer.Option("--mlflow/--no-mlflow")] = True,
    trials: Annotated[int, typer.Option(help="Optuna trials for LightGBM (game only).")] = 100,
) -> None:
    """Train on 2015-16..2023-24, evaluate on 2024-25, log runs to MLflow.

    `--only game` tunes LightGBM, picks calibration and the champion kind, and writes
    ml/config/game_model.json. It never touches the test season.
    """
    from tipoff.evaluate.metrics import to_markdown

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
) -> None:
    """Final evaluation on the test season (once) and the monthly walk-forward backtest."""
    from tipoff.evaluate.metrics import to_markdown
    from tipoff.models.final import TestAlreadyRunError, final_test, walk_forward

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


@app.command()
def predict(
    date_: DateOpt = "today",
    model_source: Annotated[
        ModelSource, typer.Option(help="mlflow = local registry; db = pipeline_state (cloud).")
    ] = ModelSource.mlflow,
    target: TargetOpt = DbTarget.dev,
) -> None:
    """Predict a date's scheduled games with the champion (writes data/predictions)."""
    from tipoff.db import get_engine
    from tipoff.predict.run import predict_date

    day = _day(date_)
    engine = get_engine(target.value) if model_source is ModelSource.db else None
    preds = predict_date(day, model_source=model_source.value, engine=engine)
    if preds.empty:
        typer.echo(f"predict: no unplayed regular-season games on {day}")
        return
    for r in preds.itertuples(index=False):
        typer.echo(f"{r.game_id}  P(home) {r.home_win_prob:.3f}  (Elo {r.elo_home_win_prob:.3f})")


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
    res = do_publish(get_engine(target.value), pd.read_parquet(path))
    typer.echo(f"publish: {res.written} predictions written to {target.value}; "
               f"skipped (already started): {res.skipped_started or 'none'}")  # fmt: skip


@app.command()
def backfill(
    seasons: Annotated[str, typer.Option(help="Comma-separated seasons.")] = "2025-26,2026-27",
    target: TargetOpt = DbTarget.dev,
) -> None:
    """Weekly walk-forward predictions for past games, published with source='backfill'."""
    from tipoff.db import get_engine
    from tipoff.predict.backfill import backfill_predictions, save
    from tipoff.predict.run import champion_info
    from tipoff.publish.publish import publish as do_publish

    version = champion_info()["model_version"] + "-wf"
    preds = backfill_predictions(seasons.split(","), version)
    save(preds, "backfill")
    res = do_publish(get_engine(target.value), preds)
    typer.echo(f"backfill: {res.written} predictions ({version}) written to {target.value}")


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
) -> None:
    """The daily job: new results -> stage -> sync -> predict today (ET) -> publish."""
    from tipoff.db import get_engine, today_et
    from tipoff.publish.freshness import missing_predictions

    day = today_et()
    engine = get_engine(target.value)
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
    predict(date_=day.isoformat(), model_source=source, target=target)
    publish(date_=day.isoformat(), target=target)
    freshness_check(date_=day.isoformat(), target=target, upcoming_only=True)


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


state_app = typer.Typer(help="Pipeline state in Postgres for the cloud daily job.")
app.add_typer(state_app, name="state")


class StateWhat(StrEnum):
    staged = "staged"
    champion = "champion"
    all = "all"


@state_app.command("push")
def state_push(
    what: Annotated[StateWhat, typer.Option("--what")] = StateWhat.all,
    target: TargetOpt = DbTarget.dev,
) -> None:
    """Upload local staged history and/or the MLflow champion to pipeline_state."""
    from tipoff.db import get_engine
    from tipoff.state import push_champion, push_staged

    engine = get_engine(target.value)
    if what in (StateWhat.staged, StateWhat.all):
        typer.echo(f"state: staged pushed ({push_staged(engine)[:12]}) to {target.value}")
    if what in (StateWhat.champion, StateWhat.all):
        from tipoff.models.final import load_champion
        from tipoff.predict.run import champion_info

        info = champion_info()
        digest = push_champion(engine, load_champion(), info)
        typer.echo(f"state: champion {info['model_version']} pushed ({digest[:12]}) "
                   f"to {target.value}")  # fmt: skip


@state_app.command("pull")
def state_pull(target: TargetOpt = DbTarget.dev) -> None:
    """Download staged history from pipeline_state into data/staged."""
    from tipoff.db import get_engine
    from tipoff.state import pull_staged

    meta = pull_staged(get_engine(target.value))
    typer.echo(f"state: staged pulled ({meta})")
