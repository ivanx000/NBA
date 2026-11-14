from typer.testing import CliRunner

from tipoff.cli import app
from tipoff.ingest import nba_stats

runner = CliRunner()


def test_help_lists_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("ingest", "features", "train", "evaluate", "predict", "publish", "daily"):
        assert command in result.output


def test_all_commands_have_help():
    for command in ("sync", "predict", "publish", "backfill", "freshness-check", "daily"):
        result = runner.invoke(app, [command, "--help"])
        assert result.exit_code == 0, result.output


def test_ingest_dry_run_plans_without_fetching(monkeypatch, tmp_path):
    original = nba_stats.ingest_stats

    def ingest_in_tmp(tasks, **kwargs):
        return original(tasks, root=tmp_path, **kwargs)

    monkeypatch.setattr(nba_stats, "ingest_stats", ingest_in_tmp)
    result = runner.invoke(
        app, ["ingest", "--source", "stats", "--seasons", "2024-25", "--dry-run"]
    )
    assert result.exit_code == 0, result.output
    assert "stats: 9 planned" in result.output
    assert "team_adv_logs/2024-25/playoffs" in result.output


def test_ingest_rejects_bad_seasons():
    result = runner.invoke(app, ["ingest", "--seasons", "2024-26", "--dry-run"])
    assert result.exit_code != 0
    assert "seasons" in result.output.lower()
