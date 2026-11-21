"""The NBA's official injury report: fetch the PDF that was current at a cutoff time, parse it.

Source: ``https://ak-static.cms.nba.com/referee/injury/Injury-Report_<date>_<time>.pdf`` (linked
from official.nba.com). It's a static S3 host behind Akamai, not stats.nba.com, and answers
GitHub-hosted runners (probed 2026-11-21). A missing file answers 403.

Filename eras (times are US Eastern):
- before 2021-10-18: three reports a day, ``_01PM``, ``_05PM``, ``_08PM`` (from 2019-20; nothing
  earlier exists)
- 2021-10-18 .. 2025-12-21: hourly, ``_09AM``
- from 2025-12-22: every 15 minutes, ``_09_00AM``

The filename is not the publish time (the hourly ``_09AM`` file went up at 9:30). The S3
``Last-Modified`` header is, even on 2019 files, so "the report as of T" means the latest file
whose ``Last-Modified`` is at or before T. Each report lists today's and tomorrow's games.

All requests go through ``tipoff.ingest.http`` (shared rate limiter, retries). PDFs are cached in
``data/raw/injury/``; the index of probed files (present with its publish time, or missing) lives
next to them so nothing is fetched twice.
"""

from __future__ import annotations

import io
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from tipoff.config import HTTP_TIMEOUT_SECONDS, RAW_DIR
from tipoff.ingest.http import (
    DEFAULT_LIMITER,
    PermanentHTTPError,
    RateLimiter,
    call_with_retries,
    check_status,
    static_headers,
)
from tipoff.teams import load_teams

log = logging.getLogger(__name__)

BASE_URL = "https://ak-static.cms.nba.com/referee/injury/"
RAW_INJURY_DIR = RAW_DIR / "injury"
ET = ZoneInfo("America/New_York")

HOURLY_FROM = date(2021, 10, 18)
QUARTER_HOURLY_FROM = date(2025, 12, 22)
FIRST_REPORT_DAY = date(2019, 10, 1)
THREE_A_DAY = (time(13), time(17), time(20))

# The two snapshots used for features (ET, game day). Training and serving use the same cutoff.
SNAPSHOTS = {"am": time(9, 0), "pm": time(17, 45)}

STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
NOT_SUBMITTED = "Not Submitted"


# --- filenames ----------------------------------------------------------------------------------


def filename(ts: datetime) -> str:
    """The report filename for an ET wall-clock time on the era's grid."""
    d = ts.date()
    stamp = ts.strftime("%I_%M%p") if d >= QUARTER_HOURLY_FROM else ts.strftime("%I%p")
    return f"Injury-Report_{d.isoformat()}_{stamp}.pdf"


def candidates(cutoff: datetime, lookback: timedelta = timedelta(hours=30)) -> list[datetime]:
    """Grid times (ET, naive) at or before ``cutoff``, newest first, back ``lookback``."""
    cutoff = cutoff.replace(second=0, microsecond=0)
    out: list[datetime] = []
    day = cutoff.date()
    while datetime.combine(day, time(23, 59)) >= cutoff - lookback:
        if day >= QUARTER_HOURLY_FROM:
            grid = [time(h, m) for h in range(24) for m in (0, 15, 30, 45)]
        elif day >= HOURLY_FROM:
            grid = [time(h) for h in range(24)]
        elif day >= FIRST_REPORT_DAY:
            grid = list(THREE_A_DAY)
        else:
            grid = []
        for t in reversed(grid):
            ts = datetime.combine(day, t)
            if cutoff - lookback <= ts <= cutoff:
                out.append(ts)
        day -= timedelta(days=1)
    return out


# --- fetching -----------------------------------------------------------------------------------


@dataclass
class Report:
    filename: str
    published: datetime  # UTC, from Last-Modified
    pdf: bytes


class ReportStore:
    """Cached PDFs plus an index: filename -> publish time (UTC ISO) or None (missing)."""

    def __init__(self, root: Path = RAW_INJURY_DIR, limiter: RateLimiter = DEFAULT_LIMITER,
                 session: requests.Session | None = None) -> None:  # fmt: skip
        self.root = root
        self.limiter = limiter
        self.session = session or requests.Session()
        self._index_path = root / "index.json"
        self.index: dict[str, str | None] = (
            json.loads(self._index_path.read_text()) if self._index_path.exists() else {}
        )

    def save_index(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self._index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.index, indent=0, sort_keys=True))
        tmp.replace(self._index_path)

    def _get(self, name: str) -> tuple[datetime, bytes] | None:
        url = BASE_URL + name

        def fetch() -> tuple[datetime, bytes] | None:
            resp = self.session.get(url, headers=static_headers(), timeout=HTTP_TIMEOUT_SECONDS)
            if resp.status_code in (403, 404):
                return None
            check_status(resp.status_code, url)
            if not resp.content.startswith(b"%PDF"):
                raise PermanentHTTPError(f"not a PDF: {url}")
            published = parsedate_to_datetime(resp.headers["Last-Modified"]).astimezone(UTC)
            return published, resp.content

        return call_with_retries(fetch, limiter=self.limiter)

    def load(self, name: str, *, now: datetime | None = None) -> Report | None:
        """The report ``name`` from the cache, or fetched. A miss is remembered only once the
        file's slot is a day old (until then it may still be published)."""
        path = self.root / name
        if name in self.index:
            pub = self.index[name]
            if pub is None:
                return None
            if path.exists():
                return Report(name, datetime.fromisoformat(pub), path.read_bytes())
        got = self._get(name)
        now = now or datetime.now(UTC)
        if got is None:
            slot = _slot_time(name)
            if slot is not None and now - slot > timedelta(days=1):
                self.index[name] = None
            return None
        published, pdf = got
        self.root.mkdir(parents=True, exist_ok=True)
        path.write_bytes(pdf)
        self.index[name] = published.isoformat()
        return Report(name, published, pdf)

    def as_of(self, cutoff_et: datetime, *, now: datetime | None = None) -> Report | None:
        """The latest report published at or before ``cutoff_et`` (naive ET wall clock)."""
        cutoff_utc = cutoff_et.replace(tzinfo=ET).astimezone(UTC)
        for ts in candidates(cutoff_et):
            rep = self.load(filename(ts), now=now)
            if rep is not None and rep.published <= cutoff_utc:
                return rep
        return None


_NAME_RE = re.compile(r"Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})(?:_(\d{2}))?(AM|PM)\.pdf")


def _slot_time(name: str) -> datetime | None:
    m = _NAME_RE.fullmatch(name)
    if not m:
        return None
    d, h, mi, ampm = m.groups()
    ts = datetime.strptime(f"{d} {h}:{mi or '00'} {ampm}", "%Y-%m-%d %I:%M %p")
    return ts.replace(tzinfo=ET).astimezone(UTC)


# --- parsing ------------------------------------------------------------------------------------

_HEADER_KEYS = {"gamedate": "date", "gametime": "time", "matchup": "matchup", "team": "team",
                "playername": "player", "currentstatus": "status", "reason": "reason",
                "previousstatus": "previous", "category": "category"}  # fmt: skip
_DATE_RE = re.compile(r"\d{2}/\d{2}/\d{4}")
_MATCHUP_RE = re.compile(r"([A-Z]{2,3})@([A-Z]{2,3})")
_HEADER_TIME_RE = re.compile(r"Injury\s*Report:\s*(\d{2}/\d{2}/\d{2})\s*(\d{2}:\d{2})\s*([AP]M)")


def _squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _header_bands(words: list[dict]) -> list[tuple[str, float]] | None:
    """Column starts from the header row ('Game Date', 'Player Name', ...)."""
    rows: dict[int, list[dict]] = {}
    for w in words:
        rows.setdefault(round(w["top"]), []).append(w)
    for top in sorted(rows):
        line = sorted(rows[top], key=lambda w: w["x0"])
        if "matchup" not in _squash(" ".join(w["text"] for w in line)):
            continue
        bands: list[tuple[str, float]] = []
        buf, x0 = "", None
        for w in line:
            buf += _squash(w["text"])
            x0 = w["x0"] if x0 is None else x0
            if buf in _HEADER_KEYS:
                bands.append((_HEADER_KEYS[buf], x0))
                buf, x0 = "", None
        if {"player", "status", "team", "matchup"} <= {b for b, _ in bands}:
            return bands
    return None


def _lines(words: list[dict], bands: list[tuple[str, float]]) -> list[dict[str, str]]:
    """Words grouped into printed lines, each split into columns by the header's x positions."""
    starts = [x - 2.0 for _, x in bands]
    names = [b for b, _ in bands]
    rows: dict[float, list[dict]] = {}
    for w in sorted(words, key=lambda w: w["top"]):
        key = next((k for k in rows if abs(k - w["top"]) < 2.5), w["top"])
        rows.setdefault(key, []).append(w)
    out = []
    for top in sorted(rows):
        cells: dict[str, list[str]] = {n: [] for n in names}
        for w in sorted(rows[top], key=lambda w: w["x0"]):
            i = max((j for j, s in enumerate(starts) if w["x0"] >= s), default=0)
            cells[names[i]].append(w["text"])
        out.append({k: " ".join(v) for k, v in cells.items()})
    return out


def report_time(pdf: bytes) -> datetime | None:
    """The 'Injury Report: mm/dd/yy hh:mm AM' timestamp printed on the first page (ET, naive)."""
    import pdfplumber

    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        text = doc.pages[0].extract_text() or ""
    m = _HEADER_TIME_RE.search(text)
    if not m:
        return None
    return datetime.strptime(" ".join(m.groups()), "%m/%d/%y %I:%M %p")


def parse_report(pdf: bytes) -> pd.DataFrame:
    """Rows: game_date, matchup, team_name, player_name, status, reason.

    One row per listed player, plus one row per team that hasn't filed (``status`` =
    "Not Submitted", no player). Long reasons wrap onto the lines around the player's; only the
    player line carries the status, so the reason is kept as printed on that line.
    """
    import pdfplumber

    rows = []
    cur = {"date": None, "matchup": None, "team": None}
    bands = None
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        for page in doc.pages:
            words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
            bands = _header_bands(words) or bands  # later pages may not repeat the header
            if bands is None:
                continue
            for line in _lines(words, bands):
                text = _squash(" ".join(line.values()))
                if "matchup" in text or text.startswith("injuryreport") or text.startswith("page"):
                    continue  # the header row, the title, the page number
                if _DATE_RE.fullmatch(line.get("date", "").strip()):
                    cur["date"] = line["date"].strip()
                m = _MATCHUP_RE.search(line.get("matchup", ""))
                if m:
                    cur["matchup"] = m.group(0)
                    cur["team"] = None
                team = line.get("team", "").strip()
                if team:
                    cur["team"] = team
                rest = _squash(line.get("player", "") + line.get("category", "")
                               + line.get("status", "") + line.get("reason", ""))  # fmt: skip
                if "notyetsubmitted" in rest:
                    rows.append((cur["date"], cur["matchup"], cur["team"], None, NOT_SUBMITTED,
                                 None))  # fmt: skip
                    continue
                status = line.get("status", "").strip()
                player = line.get("player", "").strip()
                if status in STATUSES and player and cur["date"] and cur["matchup"]:
                    parts = (line.get("category", "").strip(), line.get("reason", "").strip())
                    reason = " - ".join(x for x in parts if x)
                    rows.append((cur["date"], cur["matchup"], cur["team"], player, status,
                                 reason or None))  # fmt: skip
    df = pd.DataFrame(rows, columns=["game_date", "matchup", "team_name", "player_name",
                                     "status", "reason"])  # fmt: skip
    df["game_date"] = pd.to_datetime(df["game_date"], format="%m/%d/%Y")
    return df


# --- teams and players --------------------------------------------------------------------------


def team_lookup() -> dict[str, int]:
    """Squashed full name (and abbreviation) -> team_id. 'LA Clippers' is printed that way."""
    out: dict[str, int] = {}
    for t in load_teams():
        out[_squash(f"{t['city']} {t['name']}")] = t["team_id"]
        out[_squash(t["abbr"])] = t["team_id"]
    out[_squash("LA Clippers")] = out[_squash("Los Angeles Clippers")]
    return out


def abbr_lookup() -> dict[str, int]:
    return {t["abbr"]: t["team_id"] for t in load_teams()}


_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def name_key(name: str) -> str:
    """Letters only, accents and suffixes dropped, 'Last, First' turned into 'First Last'."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    if "," in s:
        last, _, first = s.partition(",")
        s = f"{first} {last}"
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"[^a-z]", "", s.lower())


def name_parts(name: str) -> tuple[str, str]:
    """(first, last) as squashed keys, from 'Last, First' or 'First Last'."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = _SUFFIX.sub(" ", s)
    if "," in s:
        last, _, first = s.partition(",")
    else:
        first, _, last = s.strip().partition(" ")
    return re.sub(r"[^a-z]", "", first.lower()), re.sub(r"[^a-z]", "", last.lower())


def _nickname_match(name: str, roster: pd.DataFrame) -> pd.Series | None:
    """A unique roster player with the same last name whose first name is a prefix of the
    printed one, or the other way round ('Nicolas Claxton' and 'Nic Claxton')."""
    first, last = name_parts(name)
    if not first or not last:
        return None
    parts = roster["player_name"].map(name_parts)
    ok = parts.map(lambda fl: fl[1] == last and bool(fl[0])
                   and (fl[0].startswith(first) or first.startswith(fl[0])))  # fmt: skip
    hit = roster[ok.to_numpy()]
    ids = hit["player_id"].to_numpy()
    if len(ids) == 0 or (ids != ids[0]).any():
        return None
    return hit.iloc[-1]


def resolve(report: pd.DataFrame, games: pd.DataFrame,
            player_games: pd.DataFrame) -> pd.DataFrame:  # fmt: skip
    """Attach team_id, game_id and player_id.

    Teams come from the printed name (or the matchup, when a team's name wrapped off the line).
    Players are matched by name against the team's roster (anyone who played for it in the 400
    days before the game), then against everyone who played in that window (a player traded
    but not yet on the court for his new team), then by a close spelling within the team. Names
    that don't match (mostly two-way players who never played) keep ``player_id`` empty.
    """
    import difflib

    teams, abbrs = team_lookup(), abbr_lookup()
    df = report.copy()
    df["team_id"] = df["team_name"].map(lambda s: teams.get(_squash(s)) if s else None)
    home = df["matchup"].str.split("@").str[1].map(abbrs)
    away = df["matchup"].str.split("@").str[0].map(abbrs)
    df["home_team_id"], df["away_team_id"] = home, away

    g = games[["game_id", "game_date", "home_team_id", "away_team_id"]].copy()
    g["game_date"] = pd.to_datetime(g["game_date"])
    df = df.merge(g, on=["game_date", "home_team_id", "away_team_id"], how="left")

    pg = player_games[["player_id", "player_name", "team_id", "game_date"]].drop_duplicates(
        ["player_id", "team_id", "game_date"]
    )
    pg = pg.assign(game_date=pd.to_datetime(pg["game_date"]),
                   key=pg["player_name"].map(name_key)).sort_values("game_date")  # fmt: skip
    by_key = {k: v for k, v in pg.groupby("key")}
    by_team = {t: v for t, v in pg.groupby("team_id")}
    df["key"] = df["player_name"].map(lambda s: name_key(s) if isinstance(s, str) else None)

    ids: list[int | None] = []
    resolved_team: list[int | None] = []
    window = pd.Timedelta(days=400)
    for r in df.itertuples():
        team = int(r.team_id) if pd.notna(r.team_id) else None
        sides = [team] if team is not None else [r.home_team_id, r.away_team_id]
        hit = None
        if isinstance(r.key, str) and r.key:
            cand = by_key.get(r.key)
            if cand is not None:
                cand = cand[(cand["game_date"] < r.game_date)
                            & (cand["game_date"] >= r.game_date - window)]  # fmt: skip
                on_team = cand[cand["team_id"].isin(sides)]
                if not on_team.empty:
                    hit = on_team.iloc[-1]
                elif len(cand) and (cand["player_id"] == cand["player_id"].iloc[0]).all():
                    hit = cand.iloc[-1]
            if hit is None:
                roster = pd.concat([by_team[s] for s in sides if s in by_team])
                roster = roster[(roster["game_date"] < r.game_date)
                                & (roster["game_date"] >= r.game_date - window)]  # fmt: skip
                close = difflib.get_close_matches(r.key, roster["key"].unique().tolist(), n=1,
                                                  cutoff=0.88)  # fmt: skip
                if close:
                    hit = roster[roster["key"] == close[0]].iloc[-1]
                else:
                    hit = _nickname_match(r.player_name, roster)
        if hit is not None:
            ids.append(int(hit["player_id"]))
            if team is None and hit["team_id"] in sides:
                team = int(hit["team_id"])
        else:
            ids.append(None)
        resolved_team.append(team)
    df["player_id"] = pd.array(ids, dtype="Int64")
    df["team_id"] = pd.array(resolved_team, dtype="Int64")
    return df.drop(columns=["key", "home_team_id", "away_team_id"])


# --- snapshots ----------------------------------------------------------------------------------

STAGED_COLUMNS = ["game_date", "snapshot", "report_file", "published", "game_id", "matchup",
                  "team_id", "player_id", "player_name", "status", "reason"]  # fmt: skip


def snapshot(
    store: ReportStore,
    day: date,
    which: str,
    games: pd.DataFrame,
    player_games: pd.DataFrame,
    *,
    now: datetime | None = None,
    cutoff: datetime | None = None,
) -> pd.DataFrame:
    """The report as of ``which`` ('am' or 'pm') on ``day``, for ``day``'s games, resolved.
    ``cutoff`` (ET, naive) replaces the snapshot's usual time (the daily job before 09:00)."""
    cutoff = cutoff or datetime.combine(day, SNAPSHOTS[which])
    rep = store.as_of(cutoff, now=now)
    if rep is None:
        return pd.DataFrame(columns=STAGED_COLUMNS)
    parsed = parse_report(rep.pdf)
    parsed = parsed[parsed["game_date"] == pd.Timestamp(day)]
    if parsed.empty:
        return pd.DataFrame(columns=STAGED_COLUMNS)
    out = resolve(parsed, games, player_games)
    out["snapshot"] = which
    out["report_file"] = rep.filename
    out["published"] = pd.Timestamp(rep.published).tz_convert("UTC").tz_localize(None)
    return out[STAGED_COLUMNS]


# --- staged history -----------------------------------------------------------------------------

INJURY_FILE = "injury_reports.parquet"
SNAPSHOTS_FILE = "injury_snapshots.parquet"  # (game_date, snapshot) done, with the file used


def game_days(games: pd.DataFrame, first: date = FIRST_REPORT_DAY) -> list[date]:
    """Regular-season game dates on or after ``first``."""
    reg = games[(games["season_type"] == "regular") if "season_type" in games else slice(None)]
    days = pd.to_datetime(reg["game_date"]).dt.date
    return sorted(d for d in set(days) if d >= first)


def ingest_history(
    days: list[date],
    games: pd.DataFrame,
    player_games: pd.DataFrame,
    staged_dir: Path,
    store: ReportStore | None = None,
    which: tuple[str, ...] = ("am", "pm"),
    now: datetime | None = None,
    progress: bool = False,
) -> dict[str, int]:
    """Add the morning and evening snapshots for ``days`` to the staged injury table.

    Snapshots already staged are skipped, and so are cutoffs still in the future (``now``). A
    day with no report before its cutoff is recorded as done with no file, so it isn't probed
    again; the ReportStore remembers missing files too.
    """
    store = store or ReportStore()
    now = now or datetime.now(UTC)
    inj_path, snap_path = staged_dir / INJURY_FILE, staged_dir / SNAPSHOTS_FILE
    inj = pd.read_parquet(inj_path) if inj_path.exists() else pd.DataFrame(columns=STAGED_COLUMNS)
    snap_cols = ["game_date", "snapshot", "report_file", "published"]
    snaps = pd.read_parquet(snap_path) if snap_path.exists() else pd.DataFrame(columns=snap_cols)
    done = {
        (pd.Timestamp(d).date(), s)
        for d, s in zip(snaps["game_date"], snaps["snapshot"], strict=True)
    }
    new_rows, new_snaps = [], []
    todo = [(d, w) for d in days for w in which if (d, w) not in done]
    for i, (d, w) in enumerate(todo):
        cutoff = datetime.combine(d, SNAPSHOTS[w]).replace(tzinfo=ET)
        if cutoff > now:
            continue
        rows = snapshot(store, d, w, games, player_games, now=now)
        new_rows.append(rows)
        new_snaps.append({
            "game_date": pd.Timestamp(d), "snapshot": w,
            "report_file": rows["report_file"].iloc[0] if len(rows) else None,
            "published": rows["published"].iloc[0] if len(rows) else pd.NaT,
        })  # fmt: skip
        if progress and (i + 1) % 25 == 0:
            store.save_index()
            log.warning("injury: %d/%d snapshots (%s %s)", i + 1, len(todo), d, w)
    found = sum(1 for s in new_snaps if s["report_file"] is not None)
    if len(new_snaps) >= 10 and found == 0:
        # Every file "missing" is far likelier a refused request than a month without reports.
        raise RuntimeError(f"no injury report found for any of {len(new_snaps)} snapshots")
    store.save_index()
    if new_snaps:
        frames = [f for f in (inj, *new_rows) if len(f)]
        inj = pd.concat(frames, ignore_index=True) if frames else inj
        snaps = pd.concat([snaps, pd.DataFrame(new_snaps)], ignore_index=True)
        write_staged(inj, snaps, staged_dir)
    return {"snapshots": len(new_snaps), "with_report": found,
            "rows": int(sum(len(r) for r in new_rows))}  # fmt: skip


def write_staged(inj: pd.DataFrame, snaps: pd.DataFrame, staged_dir: Path) -> None:
    inj = inj.copy()
    inj["game_date"] = pd.to_datetime(inj["game_date"])
    inj["published"] = pd.to_datetime(inj["published"])
    for c in ("team_id", "player_id"):
        inj[c] = inj[c].astype("Int64")
    for c in ("snapshot", "report_file", "game_id", "matchup", "player_name", "status", "reason"):
        inj[c] = inj[c].astype("string")
    inj = inj.sort_values(["game_date", "snapshot", "team_id", "player_name"], na_position="last")
    snaps = snaps.assign(game_date=pd.to_datetime(snaps["game_date"]),
                         published=pd.to_datetime(snaps["published"]),
                         snapshot=snaps["snapshot"].astype("string"),
                         report_file=snaps["report_file"].astype("string"))  # fmt: skip
    snaps = snaps.sort_values(["game_date", "snapshot"])
    staged_dir.mkdir(parents=True, exist_ok=True)
    inj.reset_index(drop=True).to_parquet(staged_dir / INJURY_FILE, index=False)
    snaps.reset_index(drop=True).to_parquet(staged_dir / SNAPSHOTS_FILE, index=False)


def load_staged(staged_dir: Path, which: str = "am") -> pd.DataFrame | None:
    """One snapshot's rows from the staged table, or None if there's no table yet."""
    path = staged_dir / INJURY_FILE
    if not path.exists():
        return None
    inj = pd.read_parquet(path)
    return inj[inj["snapshot"] == which].reset_index(drop=True)


def known_games(staged_dir: Path) -> pd.DataFrame:
    """Regular-season games from the staged table plus this season's cdn schedule (today's
    games aren't staged until they're played)."""
    from tipoff.config import CURRENT_SEASON, RAW_CDN_DIR

    cols = ["game_id", "game_date", "home_team_id", "away_team_id"]
    games = pd.read_parquet(staged_dir / "games.parquet")
    games = games.loc[games["season_type"] == "regular", cols]
    sched_path = RAW_CDN_DIR / "schedule" / f"{CURRENT_SEASON}.parquet"
    if sched_path.exists():
        sched = pd.read_parquet(sched_path)
        sched = sched.loc[sched["game_id"].str.startswith("002"), cols]
        games = pd.concat([games, sched[~sched["game_id"].isin(games["game_id"])]])
    games["game_date"] = pd.to_datetime(games["game_date"])
    return games.reset_index(drop=True)


def ingest_staged(
    staged_dir: Path,
    *,
    first: date = FIRST_REPORT_DAY,
    last: date | None = None,
    which: tuple[str, ...] = ("am", "pm"),
    now: datetime | None = None,
    progress: bool = False,
) -> dict[str, int]:
    """Stage the snapshots for every regular-season game day from ``first`` to ``last``."""
    games = known_games(staged_dir)
    days = [d for d in game_days(games.assign(season_type="regular"), first)
            if last is None or d <= last]  # fmt: skip
    cols = ["player_id", "player_name", "team_id", "game_date"]
    player_games = pd.read_parquet(staged_dir / "player_games.parquet", columns=cols)
    return ingest_history(days, games, player_games, staged_dir, which=which, now=now,
                          progress=progress)  # fmt: skip


def day_snapshot(
    staged_dir: Path,
    day: date,
    which: str = "am",
    *,
    now: datetime | None = None,
    store: ReportStore | None = None,
) -> tuple[pd.DataFrame | None, bool]:
    """The staged ``which`` snapshots plus ``day``'s, for predicting ``day``'s games.

    Once the snapshot's cutoff has passed, ``day``'s snapshot is staged like the history (same
    rule as training) and the second value is True if that added a report. Before it (a run
    before 09:00 ET), the report current right now is used and nothing is staged."""
    now = now or datetime.now(UTC)
    nominal = datetime.combine(day, SNAPSHOTS[which]).replace(tzinfo=ET)
    games = known_games(staged_dir)
    cols = ["player_id", "player_name", "team_id", "game_date"]
    player_games = pd.read_parquet(staged_dir / "player_games.parquet", columns=cols)
    if nominal <= now:
        res = ingest_history([day], games, player_games, staged_dir, store=store,
                             which=(which,), now=now)  # fmt: skip
        return load_staged(staged_dir, which), res["with_report"] > 0
    early = now.astimezone(ET).replace(tzinfo=None)
    rows = snapshot(store or ReportStore(), day, which, games, player_games, now=now,
                    cutoff=early)  # fmt: skip
    hist = load_staged(staged_dir, which)
    frames = [f for f in (hist, rows) if f is not None and len(f)]
    return (pd.concat(frames, ignore_index=True) if frames else None), False
