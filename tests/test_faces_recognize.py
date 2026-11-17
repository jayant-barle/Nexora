"""Tests for face recognition and similarity."""

import numpy as np

from nexora.faces.recognize import (
    DEFAULT_THRESHOLD,
    cosine_similarity,
    same_person,
)


def test_same_person_identical_vectors():
    """Identical vectors should match with high similarity."""
    v = np.random.randn(128).astype(np.float32)
    assert same_person(v, v) is True
    assert cosine_similarity(v, v) >= 0.999


def test_same_person_opposite_vectors():
    """Opposite vectors should not match."""
    v = np.random.randn(128).astype(np.float32)
    opp = -v
    assert same_person(v, opp) is False
    assert cosine_similarity(v, opp) <= -0.999


def test_same_person_threshold_boundary():
    """Verify threshold boundary behavior."""
    v1 = np.array([1.0, 0.0] + [0.0] * 126, dtype=np.float32)
    # create vector with exact cosine similarity of 0.40
    # cos(theta) = 0.40 -> x = 0.40, y = sqrt(1 - 0.16) = sqrt(0.84)
    v2 = np.array([0.40, np.sqrt(0.84)] + [0.0] * 126, dtype=np.float32)
    
    # At default threshold 0.363, similarity 0.40 matches
    assert same_person(v1, v2, threshold=0.363) is True
    # At threshold 0.45, similarity 0.40 does not match
    assert same_person(v1, v2, threshold=0.45) is False


def test_cosine_similarity_zero_vectors():
    """Zero vectors should return 0.0 without raising."""
    v_zero = np.zeros(128, dtype=np.float32)
    v_norm = np.ones(128, dtype=np.float32)
    assert cosine_similarity(v_zero, v_norm) == 0.0
    assert same_person(v_zero, v_norm) is False
