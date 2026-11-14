"""`tipoff` command-line interface. Every command is a stub until its roadmap phase."""

from datetime import date
from typing import Annotated

import typer

from tipoff import __version__
from tipoff.config import CURRENT_SEASON, FIRST_SEASON

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


@app.command()
def ingest(
    seasons: Annotated[
        str, typer.Option(help="Season range, e.g. 2015-16:2026-27.")
    ] = f"{FIRST_SEASON}:{CURRENT_SEASON}",
) -> None:
    """Fetch and cache raw NBA data (runs locally only; never from CI)."""
    _not_implemented("ingest", "Phase 1")


@app.command()
def features() -> None:
    """Build the leakage-safe game-level feature table."""
    _not_implemented("features", "Phase 2")


@app.command()
def train() -> None:
    """Train models and log runs to MLflow."""
    _not_implemented("train", "Phase 3")


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
