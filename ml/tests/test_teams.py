from tipoff.teams import load_teams, team_by_abbr


def test_thirty_unique_teams():
    teams = load_teams()
    assert len(teams) == 30
    assert len({t["team_id"] for t in teams}) == 30
    assert len({t["abbr"] for t in teams}) == 30


def test_required_fields_and_hex_colors():
    for team in load_teams():
        for key in ("team_id", "abbr", "city", "name", "conference", "division", "colors"):
            assert key in team, f"{team.get('abbr')} missing {key}"
        assert team["conference"] in {"East", "West"}
        for hex_color in team["colors"].values():
            assert hex_color.startswith("#") and len(hex_color) == 7


def test_team_by_abbr():
    assert team_by_abbr("bos")["city"] == "Boston"
