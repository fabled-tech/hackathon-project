"""Deprecated: `python -m fabled_validator` -> `python -m sculptline_validator` (same argv, same exit code).

The deprecation notice goes to stderr only, so `--json-only` stdout stays pure JSON.
"""
import sys

from sculptline_validator.cli import main

if __name__ == "__main__":
    print("DeprecationWarning: 'python -m fabled_validator' is deprecated; use 'python -m sculptline_validator'.",
          file=sys.stderr)
    sys.exit(main())
