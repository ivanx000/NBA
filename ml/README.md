# tipoff (ML pipeline)

Python package for ingesting NBA data, building leakage-safe features, training models and
publishing daily predictions. See `../docs/ML_PLAN.md` and `../docs/ARCHITECTURE.md`.

```bash
uv sync
uv run tipoff --help
uv run pytest
uv run ruff check . && uv run ruff format --check .
```
