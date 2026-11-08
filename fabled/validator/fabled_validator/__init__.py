"""Deprecated alias for `sculptline_validator` (the validator was renamed in the SculptLine rebrand).

`import fabled_validator` and `from fabled_validator.<module> import ...` keep working: this package re-exports
`sculptline_validator`, and any `fabled_validator.X` submodule import resolves to the very same module object as
`sculptline_validator.X` (no duplicate modules or exception classes).
New code should import `sculptline_validator` and run `python -m sculptline_validator`.
"""
import importlib
import importlib.abc
import importlib.util
import sys

import sculptline_validator as _new
from sculptline_validator import *  # noqa: F401,F403
from sculptline_validator import SCHEMA_VERSION, __version__, exit_code_for, validate  # noqa: F401

__all__ = list(_new.__all__)
_OLD, _NEW = __name__, _new.__name__


class _AliasLoader(importlib.abc.Loader):
    """Hands back the already-imported `sculptline_validator.<sub>` module instead of loading a copy."""

    def create_module(self, spec):
        module = importlib.import_module(_NEW + spec.name[len(_OLD):])
        self._real_spec = module.__spec__
        return module

    def exec_module(self, module):
        module.__spec__ = self._real_spec  # the import system just stamped the alias spec on it; keep the real one


class _AliasFinder(importlib.abc.MetaPathFinder):
    """Maps `fabled_validator.<sub>` (except `__main__`) onto `sculptline_validator.<sub>`."""

    def find_spec(self, fullname, path=None, target=None):
        if not fullname.startswith(_OLD + ".") or fullname == _OLD + ".__main__":
            return None
        if importlib.util.find_spec(_NEW + fullname[len(_OLD):]) is None:
            return None
        return importlib.util.spec_from_loader(fullname, _AliasLoader())


if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())


def __getattr__(name):
    try:
        return importlib.import_module(f"{_NEW}.{name}")
    except ImportError:
        raise AttributeError(f"module {_OLD!r} has no attribute {name!r}") from None
