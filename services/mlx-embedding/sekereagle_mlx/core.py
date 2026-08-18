from __future__ import annotations

import math
from collections.abc import Sequence


def project_mrl(vector: Sequence[float], dimensions: int) -> list[float]:
    """Take the MRL prefix and restore unit length for cosine search."""
    if dimensions <= 0 or len(vector) < dimensions:
        raise ValueError("embedding dimension contract cannot be satisfied")
    projected = [float(value) for value in vector[:dimensions]]
    if not all(math.isfinite(value) for value in projected):
        raise ValueError("embedding contains a non-finite value")
    norm = math.sqrt(sum(value * value for value in projected))
    if norm <= 1e-12:
        raise ValueError("embedding projection is a zero vector")
    return [value / norm for value in projected]

