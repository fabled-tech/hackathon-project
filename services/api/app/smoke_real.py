import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from app.config import IntegrationMode, Settings
from app.dependencies import ApplicationServices, build_services
from app.models import AssetUpload, Case, StoredAsset

_SMOKE_CONTENT = b"smoke test"
_SMOKE_FILENAME = "smoke-test.txt"


def _cleanup_disposable_records(
    services: ApplicationServices,
    case_id: str,
    asset: StoredAsset | None,
    *,
    case_created: bool,
    primary_error: BaseException | None,
) -> None:
    cleanup_errors: list[Exception] = []
    if asset is not None:
        try:
            services.asset_repository.delete(asset)
        except Exception as error:
            cleanup_errors.append(error)
    if case_created:
        try:
            services.case_repository.delete(case_id)
        except Exception as error:
            cleanup_errors.append(error)

    for cleanup_failure in cleanup_errors:
        print(f"Real repository smoke cleanup failed: {cleanup_failure}", file=sys.stderr)

    if primary_error is None and cleanup_errors:
        raise cleanup_errors[0]


def _verify_asset_metadata(assets: Sequence[StoredAsset], stored_asset: StoredAsset) -> None:
    if list(assets) != [stored_asset]:
        raise RuntimeError("Smoke asset metadata did not match the stored asset")


def run_repository_smoke(services: ApplicationServices) -> None:
    """Exercise configured repositories using records that are removed before returning."""

    case_id = str(uuid4())
    case = Case(
        id=case_id,
        script_text="Disposable repository smoke case.",
        created_at=datetime.now(UTC),
        findings=[],
    )
    asset: StoredAsset | None = None
    case_created = False
    primary_error: BaseException | None = None

    try:
        services.case_repository.create(case)
        case_created = True
        asset = services.asset_repository.store(
            case_id,
            AssetUpload(
                filename=_SMOKE_FILENAME,
                content_type="text/plain",
                content=_SMOKE_CONTENT,
            ),
        )
        _verify_asset_metadata(services.asset_repository.list_for_case(case_id), asset)
        if services.asset_repository.get_content(asset.id) != _SMOKE_CONTENT:
            raise RuntimeError("Smoke asset content did not match the stored text")
        services.case_repository.increment_asset_count(case_id)
        if services.case_repository.get(case_id).asset_count != 1:
            raise RuntimeError("Smoke case asset count was not incremented")
    except BaseException as error:
        primary_error = error
        raise
    finally:
        _cleanup_disposable_records(
            services,
            case_id,
            asset,
            case_created=case_created,
            primary_error=primary_error,
        )


def main(settings: Settings | None = None, services: ApplicationServices | None = None) -> int:
    configured_settings = settings or Settings()
    if not configured_settings.enable_real_smoke:
        print("Skipped: set RIGHTSRADAR_ENABLE_REAL_SMOKE=true to opt in.")
        return 0
    repository_mode = configured_settings.selected_mode(configured_settings.repository_mode)
    if repository_mode is not IntegrationMode.REAL:
        print("Skipped: set RIGHTSRADAR_REPOSITORY_MODE=real in hybrid or cloud mode.")
        return 0

    try:
        run_repository_smoke(services or build_services(configured_settings))
    except Exception as error:
        print(f"Real repository smoke test failed: {error}", file=sys.stderr)
        return 1

    print("Real repository smoke test completed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
