import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import TypeVar
from uuid import uuid4

from app.config import IntegrationMode, Settings
from app.dependencies import ApplicationServices, build_services
from app.models import AssetUpload, Case, StoredAsset

_SMOKE_CONTENT = b"smoke test"
_SMOKE_FILENAME = "smoke-test.txt"
Result = TypeVar("Result")


class SmokeOperationError(Exception):
    def __init__(self, operation: str, cause: Exception) -> None:
        super().__init__(operation)
        self.operation = operation
        self.cause = cause


def _report_failure(operation: str, error: Exception) -> None:
    print(
        f"Real repository smoke {operation} failed ({type(error).__name__}).",
        file=sys.stderr,
    )


def _perform(operation: str, action: Callable[[], Result]) -> Result:
    try:
        return action()
    except Exception as error:
        raise SmokeOperationError(operation, error) from error


def _cleanup_disposable_records(
    services: ApplicationServices,
    case_id: str,
    asset: StoredAsset | None,
    *,
    case_created: bool,
    primary_error: BaseException | None,
) -> None:
    cleanup_errors: list[tuple[str, Exception]] = []
    if asset is not None:
        try:
            services.asset_repository.delete(asset)
        except Exception as error:
            cleanup_errors.append(("delete asset", error))
    if case_created:
        try:
            services.case_repository.delete(case_id)
        except Exception as error:
            cleanup_errors.append(("delete case", error))

    for operation, cleanup_failure in cleanup_errors:
        _report_failure(operation, cleanup_failure)

    if primary_error is None and cleanup_errors:
        operation, cleanup_failure = cleanup_errors[0]
        raise SmokeOperationError(operation, cleanup_failure) from cleanup_failure


def _verify_asset_metadata(assets: Sequence[StoredAsset], case_id: str) -> None:
    if len(assets) != 1:
        raise RuntimeError("Smoke asset metadata count did not match")
    asset = assets[0]
    if (
        asset.case_id != case_id
        or asset.filename != _SMOKE_FILENAME
        or asset.content_type != "text/plain"
        or asset.byte_size != len(_SMOKE_CONTENT)
    ):
        raise RuntimeError("Smoke asset metadata did not match expected values")


def _verify_asset_content(content: bytes) -> None:
    if content != _SMOKE_CONTENT:
        raise RuntimeError("Smoke asset content did not match the stored text")


def _verify_asset_count(case: Case) -> None:
    if case.asset_count != 1:
        raise RuntimeError("Smoke case asset count was not incremented")


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
        _perform("create case", lambda: services.case_repository.create(case))
        case_created = True
        asset = _perform(
            "store asset",
            lambda: services.asset_repository.store(
                case_id,
                AssetUpload(
                    filename=_SMOKE_FILENAME,
                    content_type="text/plain",
                    content=_SMOKE_CONTENT,
                ),
            ),
        )
        _perform(
            "verify asset metadata",
            lambda: _verify_asset_metadata(
                services.asset_repository.list_for_case(case_id), case_id
            ),
        )
        _perform(
            "read asset content",
            lambda: _verify_asset_content(services.asset_repository.get_content(asset.id)),
        )
        _perform(
            "increment asset count",
            lambda: services.case_repository.increment_asset_count(case_id),
        )
        _perform(
            "verify asset count",
            lambda: _verify_asset_count(services.case_repository.get(case_id)),
        )
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
    except SmokeOperationError as error:
        _report_failure(error.operation, error.cause)
        return 1
    except Exception as error:
        _report_failure("run", error)
        return 1

    print("Real repository smoke test completed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
