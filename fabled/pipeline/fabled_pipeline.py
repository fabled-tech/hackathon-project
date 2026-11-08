#!/usr/bin/env python3
"""Deprecated alias: the pipeline driver is now sculptline_pipeline.py (SculptLine rebrand).

Runs sculptline_pipeline.py in this process with the same argv, so output and exit code are identical.
Importing this module (e.g. `from fabled_pipeline import wait_for_other_blender`) re-exports the new module.
"""
import os
import runpy
import sys

_NEW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sculptline_pipeline.py")

if __name__ == "__main__":
    sys.argv[0] = _NEW
    runpy.run_path(_NEW, run_name="__main__")
else:
    sys.path.insert(0, os.path.dirname(_NEW))
    from sculptline_pipeline import *  # noqa: F401,F403,E402
    import sculptline_pipeline as _new  # noqa: E402

    def __getattr__(name):
        return getattr(_new, name)
