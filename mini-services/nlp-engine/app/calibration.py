"""Confidence calibration (BRD O-4: expected calibration error ≤ 0.05).

Two-parameter logistic (Platt) scaling fitted on the validation split with
train-only retrieval (no leakage). Newton's method with grid-search fallback —
deterministic, auditable, no external dependencies.
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np


def fit_platt(raw: np.ndarray, correct: np.ndarray) -> Tuple[float, float]:
    """Fit conf = sigmoid(a*raw + b) predicting correctness. Returns (a, b)."""
    raw = np.asarray(raw, dtype=float)
    y = np.asarray(correct, dtype=float)
    if len(raw) < 20 or y.min() == y.max():
        return 6.0, -2.0  # sane default when calibration data is degenerate

    X = np.stack([raw, np.ones_like(raw)], axis=1)  # (n, 2)
    theta = np.array([6.0, -2.0])

    try:
        for _ in range(50):
            z = X @ theta
            p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
            w = np.clip(p * (1 - p), 1e-6, None)
            grad = X.T @ (p - y) + 1e-6 * theta
            hess = (X.T * w) @ X + 1e-6 * np.eye(2)
            step = np.linalg.solve(hess, grad)
            theta = theta - step
            if np.max(np.abs(step)) < 1e-9:
                break
        if np.all(np.isfinite(theta)) and 0.1 < theta[0] < 100 and -50 < theta[1] < 50:
            return float(theta[0]), float(theta[1])
    except np.linalg.LinAlgError:
        pass

    # Fallback: coarse grid search (deterministic)
    best, best_nll = (6.0, -2.0), np.inf
    for a in np.linspace(0.5, 20, 80):
        z = np.outer(a, raw) + np.linspace(-16, 2, 91)[None, :]
        nll = np.mean(np.logaddexp(0, z) - y[None, :] * z, axis=1)  # (91,)
        j = int(np.argmin(nll))
        if nll[j] < best_nll:
            best_nll, best = float(nll[j]), (float(a), float(np.linspace(-16, 2, 91)[j]))
    return best


def apply_platt(raw: float, a: float, b: float) -> float:
    return float(1.0 / (1.0 + np.exp(-np.clip(a * raw + b, -30, 30))))


def expected_calibration_error(confidences: np.ndarray, correct: np.ndarray, n_bins: int = 10) -> float:
    """Equal-width binned ECE (lower is better; gate ≤ 0.05)."""
    confidences = np.asarray(confidences, dtype=float)
    correct = np.asarray(correct, dtype=float)
    n = len(confidences)
    if n == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (confidences > lo) & (confidences <= hi) if lo > 0 else (confidences >= lo) & (confidences <= hi)
        if mask.sum() == 0:
            continue
        gap = abs(confidences[mask].mean() - correct[mask].mean())
        ece += mask.sum() / n * gap
    return float(ece)
