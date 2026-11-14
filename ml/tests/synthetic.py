"""A small synthetic league in the staged-table format, for offline feature tests.

Six real teams, two seasons (2014-15 warm-up + 2015-16), varied rest, players who miss games,
and one mid-season trade. Results are random but internally consistent.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TEAMS = [
    1610612737,
    1610612738,
    1610612747,
    1610612743,
    1610612744,
    1610612761,
]  # ATL BOS LAL DEN GSW TOR
SEASONS = {"2014-15": "2014-10-28", "2015-16": "2015-10-27"}
TRADED_PLAYER = 1_000_000 + 1610612738 % 1000 * 10 + 0  # BOS's first player
TRADE_TO = 1610612747  # LAL


def make_league(
    seed: int = 7, dates_per_season: int = 45, seasons: dict[str, str] | None = None
) -> dict[str, pd.DataFrame]:
    seasons = seasons or SEASONS
    rng = np.random.default_rng(seed)
    games, team_rows, player_rows = [], [], []
    roster = {t: [1_000_000 + t % 1000 * 10 + j for j in range(9)] for t in TEAMS}
    strength = {t: rng.normal(0, 4) for t in TEAMS}
    n = 0
    for s_idx, (season, start) in enumerate(seasons.items()):
        day = pd.Timestamp(start)
        for d in range(dates_per_season):
            day += pd.Timedelta(days=int(rng.choice([1, 1, 2, 2, 3])))
            if season == "2015-16" and d == dates_per_season // 2:
                roster[1610612738].remove(TRADED_PLAYER)
                roster[TRADE_TO].append(TRADED_PLAYER)
            order = rng.permutation(TEAMS)
            for k in range(int(rng.integers(1, 4))):  # 1 to 3 games that day
                home, away = int(order[2 * k]), int(order[2 * k + 1])
                n += 1
                gid = f"002{14 + s_idx:02d}{n:05d}"
                hp = int(110 + strength[home] - strength[away] + 3 + rng.normal(0, 12))
                ap = int(110 + rng.normal(0, 12))
                if hp == ap:
                    hp += 1
                games.append(dict(game_id=gid, season=season, season_type="regular",
                                  game_date=day, home_team_id=home, away_team_id=away,
                                  is_neutral=False, home_pts=hp, away_pts=ap,
                                  home_win=hp > ap, overtimes=0))  # fmt: skip
                for team, opp, pts, opp_pts, is_home in ((home, away, hp, ap, True),
                                                         (away, home, ap, hp, False)):  # fmt: skip
                    poss = float(rng.normal(99, 3))
                    fga = int(rng.integers(80, 95))
                    fg3m = int(rng.integers(8, 18))
                    ftm = int(rng.integers(10, 25))
                    fgm = max((pts - ftm - fg3m) // 2, fg3m)
                    team_rows.append(dict(
                        game_id=gid, season=season, season_type="regular", game_date=day,
                        team_id=team, opp_team_id=opp, is_home=is_home, is_neutral=False,
                        win=pts > opp_pts, minutes=240, pts=pts, opp_pts=opp_pts,
                        plus_minus=pts - opp_pts, fgm=fgm, fga=fga, fg3m=fg3m,
                        fg3a=fg3m + int(rng.integers(15, 25)), ftm=ftm,
                        fta=ftm + int(rng.integers(0, 8)), oreb=int(rng.integers(6, 15)),
                        dreb=int(rng.integers(28, 40)), reb=0, ast=int(rng.integers(18, 30)),
                        stl=7, blk=5, tov=int(rng.integers(8, 18)), pf=20,
                        off_rating=100 * pts / poss, def_rating=100 * opp_pts / poss,
                        net_rating=100 * (pts - opp_pts) / poss, pace=poss, poss=poss,
                    ))  # fmt: skip
                    players = list(roster[team])
                    for j, pid in enumerate(players):
                        if rng.random() < 0.12:  # missed this game
                            continue
                        minutes = int(max(0, rng.normal(34 if j < 5 else 14, 4)))
                        player_rows.append(dict(
                            game_id=gid, season=season, season_type="regular", game_date=day,
                            player_id=pid, player_name=f"P{pid}", team_id=team, is_home=is_home,
                            minutes=minutes, pts=int(max(0, rng.normal(22 if j < 2 else 8, 5))),
                            reb=4, ast=3,
                        ))  # fmt: skip
    return {
        "games": pd.DataFrame(games),
        "team_games": pd.DataFrame(team_rows),
        "player_games": pd.DataFrame(player_rows),
    }
