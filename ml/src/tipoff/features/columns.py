"""Column names of the game feature table."""

KEY_COLUMNS = [
    "game_id", "season", "season_type", "game_date", "home_team_id", "away_team_id",
    "is_neutral", "played",
]  # fmt: skip
TARGET = "home_win"

# Team-level pre-game values turned into home-minus-away differences.
DIFF_SOURCES = [
    *(f"{s}_std" for s in [
        "net_rating", "off_rating", "def_rating", "pace", "efg", "tov_pct", "oreb_pct", "ft_rate",
        "opp_efg", "opp_tov_pct", "dreb_pct", "opp_ft_rate", "margin", "win",
    ]),
    *(f"{s}_l10" for s in [
        "net_rating", "off_rating", "def_rating", "pace", "efg", "tov_pct", "oreb_pct", "ft_rate",
        "opp_efg", "opp_tov_pct", "dreb_pct", "opp_ft_rate", "margin", "win",
    ]),
    "net_rating_l5", "margin_l5", "net_rating_ewm",
    "rest_days", "games_last7", "travel_km", "out_min_share", "lineup_strength",
]  # fmt: skip
# Team-level values kept separately for each side.
RAW_SOURCES = ["rest_days", "b2b", "three_in_four", "travel_km", "tz_crossed", "out_min_share",
               "star_out"]  # fmt: skip

FEATURE_COLUMNS = [
    "elo_diff", "elo_prob_home", "elo_hfa", "is_neutral_f", "season_progress",
    "home_venue_win_pct", "away_venue_win_pct",
    *(f"diff_{c}" for c in DIFF_SOURCES),
    *(f"{side}_{c}" for c in RAW_SOURCES for side in ("home", "away")),
]  # fmt: skip

# The Elo-anchored model's adjustments on top of Elo (ml/reports/elo_gap_study.md): rest and
# travel, availability, last-10 form, venue records and lineup strength. Season-to-date stats and
# the short-window ratings add nothing beyond Elo across the held-out seasons, so they're left out.
ANCHOR_FEATURES = [
    c for c in FEATURE_COLUMNS
    if c.endswith("_l10")
    or c in ("home_venue_win_pct", "away_venue_win_pct", "diff_lineup_strength")
    or any(k in c for k in ("rest_days", "b2b", "three_in_four", "travel_km", "tz_crossed",
                             "games_last7", "out_min_share", "star_out"))
]  # fmt: skip
