"""Allow `python -m tipoff ...` as an alias for the `tipoff` CLI."""

from tipoff.cli import app

app(prog_name="tipoff")
