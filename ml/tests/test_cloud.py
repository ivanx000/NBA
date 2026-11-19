"""The cloud daily path must never touch stats.nba.com (it blocks GitHub's IP ranges)."""

import pandas as pd

from tipoff import cli


def test_cloud_update_uses_only_cdn(monkeypatch, tmp_path):
    from tipoff import state
    from tipoff.ingest import cdn_box, nba_cdn, nba_stats, stage

    def forbidden(*args, **kwargs):
        raise AssertionError("stats.nba.com must not be called in cloud mode")

    monkeypatch.setattr(nba_stats, "ingest_stats", forbidden)
    monkeypatch.setattr(nba_stats, "nba_api_fetcher", forbidden)

    staged = tmp_path / "staged"
    staged.mkdir()
    pd.DataFrame({"game_id": ["0022600001"]}).to_parquet(staged / "games.parquet")
    monkeypatch.setattr("tipoff.config.STAGED_DIR", staged)
    schedule = pd.DataFrame({"game_id": ["0022600001", "0022600002"], "status": ["final", "final"],
                             "game_date": ["2026-10-21", "2026-10-22"], "season": "2026-27",
                             "is_neutral": False})  # fmt: skip
    calls = []
    monkeypatch.setattr(state, "pull_staged", lambda engine: {"through": "2026-10-21"})
    monkeypatch.setattr(state, "push_staged", lambda engine: calls.append("push"))
    monkeypatch.setattr(nba_cdn, "ingest_schedule", lambda: schedule)
    monkeypatch.setattr(nba_cdn, "ingest_scoreboard", lambda: pd.DataFrame())

    def fake_boxscores(todo):
        calls.append(list(todo["game_id"]))
        return "t", "p"

    monkeypatch.setattr(cdn_box, "ingest_boxscores", fake_boxscores)
    monkeypatch.setattr(stage, "stage_incremental", lambda t, p: calls.append("stage") or {})

    cli._cloud_update(engine=None)
    assert calls == [["0022600002"], "stage", "push"]


def test_cloud_player_steps_never_import_stats_nba():
    """`daily --cloud` also projects players and fills results; those modules read staged data
    and the database only."""
    import inspect

    from tipoff.features import players as features
    from tipoff.predict import players as predict
    from tipoff.publish import players as publish

    for module in (features, predict, publish):
        assert "nba_stats" not in inspect.getsource(module), module.__name__
