"""The shared render boundary must not launch without canonical approval."""
import json
from unittest.mock import Mock

import pytest

from test_core import core, factory


@pytest.mark.parametrize("route", ["direct", "text", "json"])
def test_no_approval_cannot_launch(factory, monkeypatch, route):
    launch = Mock()
    monkeypatch.setattr(core, "Popen", launch)
    if route == "direct":
        with pytest.raises(ValueError, match="approval"):
            core.render("shot-a")
    elif route == "text":
        assert "approval" in core.command("render shot-a", "sid").lower()
    else:
        result = json.loads(core.command('json render {"run":"shot-a"}', "sid"))
        assert "approval" in result.get("error", "").lower()
    launch.assert_not_called()
