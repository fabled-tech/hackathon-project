import sys

from app.config import IntegrationMode, Settings
from app.dependencies import build_repositories
from app.repositories import AssetRepository


def main(settings: Settings | None = None, asset_repository: AssetRepository | None = None) -> int:
    configured_settings = settings or Settings()
    if not configured_settings.enable_reconciliation:
        print("Skipped: set RIGHTSRADAR_ENABLE_RECONCILIATION=true to opt in.")
        return 0
    repository_mode = configured_settings.selected_mode(configured_settings.repository_mode)
    if repository_mode is not IntegrationMode.REAL:
        print("Skipped: select real repositories in hybrid or cloud mode.")
        return 0

    try:
        repository = asset_repository or build_repositories(configured_settings)[1]
        reconciled = repository.reconcile_pending(limit=100)
    except Exception:
        print("Private asset reconciliation failed.", file=sys.stderr)
        return 1
    print(f"Reconciled {reconciled} private asset record(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
