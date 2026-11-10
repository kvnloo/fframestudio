"""Registration uses Hermes's exact data namespace without changing the environment."""
import os
from types import SimpleNamespace

import pytest

from test_core import core, plugin


@pytest.fixture(autouse=True)
def isolate_registration(monkeypatch, tmp_path):
    # Restore the previous module setting after each fake registration.
    monkeypatch.setattr(core, "_plugin_data_dir", None, raising=False)
    monkeypatch.delenv("FACTORY_DATA_DIR", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "profile"))


def context(**attributes):
    return SimpleNamespace(register_command=lambda *args, **kwargs: None, **attributes)


def test_register_uses_exact_host_state_namespace_without_env_mutation(tmp_path):
    directory = tmp_path / "profile/plugin-data/agent-plugin-factory-fixture"
    before = dict(os.environ)
    plugin.register(context(state=SimpleNamespace(data_dir=directory)))
    assert core._data_root() == directory
    assert dict(os.environ) == before
    assert not directory.exists()


def test_explicit_override_wins_over_registered_directory(monkeypatch, tmp_path):
    directory, override = tmp_path / "host-namespace", tmp_path / "override"
    monkeypatch.setenv("FACTORY_DATA_DIR", str(override))
    before = dict(os.environ)
    plugin.register(context(state=SimpleNamespace(data_dir=directory)))
    assert core._data_root() == override
    assert dict(os.environ) == before
    monkeypatch.delenv("FACTORY_DATA_DIR")
    assert core._data_root() == directory


@pytest.mark.parametrize("attributes", [{}, {"state": SimpleNamespace()}])
def test_old_context_uses_plugin_data_fallback(attributes, tmp_path):
    plugin.register(context(**attributes))
    assert core._data_root() == tmp_path / "profile/plugin-data/factory"


def test_reregistering_old_context_does_not_retain_previous_host_directory(tmp_path):
    plugin.register(context(state=SimpleNamespace(data_dir=tmp_path / "previous-profile")))
    plugin.register(context())
    assert core._data_root() == tmp_path / "profile/plugin-data/factory"
