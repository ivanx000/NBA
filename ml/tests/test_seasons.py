from datetime import date

import pytest

from tipoff.seasons import (
    GAME_ID_PREFIX_TO_TYPE,
    SeasonType,
    parse_season_range,
    postseason_may_have_started,
    season_start_year,
)


def test_parse_season_range():
    assert parse_season_range("2015-16:2017-18") == ["2015-16", "2016-17", "2017-18"]
    assert parse_season_range("2019-20") == ["2019-20"]
    assert parse_season_range("1999-00:2000-01") == ["1999-00", "2000-01"]


@pytest.mark.parametrize("bad", ["2015", "2015-17", "15-16", "2017-18:2015-16", "abcd-ef"])
def test_bad_seasons_rejected(bad):
    with pytest.raises(ValueError):
        parse_season_range(bad)


def test_season_types():
    assert season_start_year("2024-25") == 2024
    assert SeasonType.PLAYIN.api_name == "PlayIn"
    assert GAME_ID_PREFIX_TO_TYPE["004"] is SeasonType.PLAYOFFS


def test_postseason_window():
    assert not postseason_may_have_started("2026-27", today=date(2026, 11, 14))
    assert postseason_may_have_started("2026-27", today=date(2027, 4, 1))
