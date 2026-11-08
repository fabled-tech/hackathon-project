"""SculptLine pre-import check (SculptLine by Fabled), v0.

Python API:
    from sculptline_validator import validate
    report = validate("asset.glb", "profiles/example_studio.json")   # -> dict (schema/report.schema.json)
"""
__version__ = "0.2.0"
SCHEMA_VERSION = "0.2.0"  # 0.2: optional `manifest` check + top-level `manifest` object (additive)

from .report import validate, exit_code_for  # noqa: E402

__all__ = ["validate", "exit_code_for", "__version__", "SCHEMA_VERSION"]
