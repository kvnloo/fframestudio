"""The plugin root is a package (`__init__.py` with relative imports); collect it as a plain directory
so pytest does not import it standalone. Same hook as github.com/kvnloo/glide tests/conftest.py."""

from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]


class _RootIsNotATestPackage:
    @pytest.hookimpl(tryfirst=True)
    def pytest_collect_directory(self, path, parent):
        return pytest.Dir.from_parent(parent, path=path) if Path(path).resolve() == _ROOT else None


def pytest_configure(config):
    if not config.pluginmanager.has_plugin("factory-root"):
        config.pluginmanager.register(_RootIsNotATestPackage(), "factory-root")
