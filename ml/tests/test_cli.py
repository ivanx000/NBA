from typer.testing import CliRunner

from tipoff.cli import app

runner = CliRunner()


def test_help_lists_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("ingest", "features", "train", "predict", "publish", "daily"):
        assert command in result.output


def test_stub_commands_exit_cleanly():
    for command in ("ingest", "features", "train", "predict", "publish", "daily"):
        result = runner.invoke(app, [command])
        assert result.exit_code == 0, result.output
        assert "not implemented yet" in result.output
