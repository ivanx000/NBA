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


def _not_implemented(command: str, phase: str) -> None:
    typer.echo(f"tipoff {command}: not implemented yet (see docs/ROADMAP.md {phase}).")


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


@app.command()
def predict(
    date_: Annotated[str, typer.Option("--date", help="ET schedule date or 'today'.")] = "today",
) -> None:
    """Generate predictions for one schedule date."""
    target = date.today().isoformat() if date_ == "today" else date_
    typer.echo(f"target date: {target}")
    _not_implemented("predict", "Phase 4")


@app.command()
def publish() -> None:
    """Write pregame predictions to Postgres."""
    _not_implemented("publish", "Phase 4")


@app.command()
def daily() -> None:
    """Run the daily job: ingest -> features -> predict -> publish."""
    _not_implemented("daily", "Phase 4")
