"""Bootstrapped confidence intervals. Pure Python so eval needs nothing extra installed."""

import random
from collections.abc import Callable, Sequence
from statistics import mean
from typing import TypeVar

T = TypeVar("T")


def bootstrap_ci(
    rows: Sequence[T],
    stat: Callable[[Sequence[T]], float] = mean,
    n: int = 10_000,
    seed: int = 0,
    alpha: float = 0.05,
) -> tuple[float, float, float]:
    """(point estimate, lower, upper) with a percentile bootstrap over `rows`.

    rows can be numbers (default stat = mean) or any records with a custom stat,
    e.g. precision computed over resampled (predicted, label) pairs.
    """
    if not rows:
        return (float("nan"),) * 3
    rng = random.Random(seed)
    k = len(rows)
    draws = (stat([rows[rng.randrange(k)] for _ in range(k)]) for _ in range(n))
    samples = sorted(s for s in draws if s == s)  # drop NaN: stat undefined on that resample
    if not samples:
        return stat(rows), float("nan"), float("nan")
    m = len(samples)
    lo = samples[int(m * alpha / 2)]
    hi = samples[min(m - 1, int(m * (1 - alpha / 2)))]
    return stat(rows), lo, hi


def fmt(ci: tuple[float, float, float], pct: bool = True, digits: int = 1) -> str:
    point, lo, hi = ci
    if pct:
        return f"{point * 100:.{digits}f}% [{lo * 100:.{digits}f}, {hi * 100:.{digits}f}]"
    return f"{point:.{digits}f} [{lo:.{digits}f}, {hi:.{digits}f}]"
