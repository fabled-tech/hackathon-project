import sys
from uuid import uuid4

from app.config import Settings
from app.dependencies import build_services


def main() -> int:
    settings = Settings()
    if not settings.enable_real_smoke:
        print("Skipped: set RIGHTSRADAR_ENABLE_REAL_SMOKE=true to opt in.")
        return 0
    if settings.mode.value == "mock":
        print("Skipped: set RIGHTSRADAR_MODE=hybrid or cloud to enable a real integration.")
        return 0
    services = build_services(settings)
    findings = services.agent_service.analyze(
        str(uuid4()), "A short fictional script mentions Nimbus Soda."
    )
    print(f"Real smoke test completed with {len(findings)} finding(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
