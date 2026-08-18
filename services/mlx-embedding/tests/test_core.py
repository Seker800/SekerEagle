import math

import pytest

from sekereagle_mlx.core import project_mrl


def test_project_mrl_uses_prefix_and_restores_unit_norm():
    result = project_mrl([3, 4, 99], 2)
    assert result == [0.6, 0.8]
    assert math.isclose(sum(value * value for value in result), 1.0)


def test_project_mrl_fails_closed_on_invalid_contract():
    with pytest.raises(ValueError, match="dimension"):
        project_mrl([1], 2)
    with pytest.raises(ValueError, match="non-finite"):
        project_mrl([1, math.nan], 2)

