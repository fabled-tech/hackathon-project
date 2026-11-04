#!/usr/bin/env python3
"""
Fabled E2E Test Suite Runner
Executes all 4 test tiers (Tiers 1-4) covering all 22 features (257 total tests).
Provides colored console summary, per-tier breakdowns, and JSON report generation.
"""

import sys
import os
import time
import json
import subprocess
from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
E2E_DIR = ROOT_DIR / "tests" / "e2e"

# ANSI color codes
RESET = "\033[0m"
BOLD = "\033[1m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"

TIERS = [
    {
        "id": "tier1",
        "name": "Tier 1: Feature Coverage (22 Features, >=5 tests/feature)",
        "file": E2E_DIR / "test_tier1_features.py",
        "expected_min": 110,
    },
    {
        "id": "tier2",
        "name": "Tier 2: Boundary & Corner Cases (22 Features, >=5 tests/feature)",
        "file": E2E_DIR / "test_tier2_boundaries.py",
        "expected_min": 110,
    },
    {
        "id": "tier3",
        "name": "Tier 3: Cross-Feature Interactions & Pairwise Combinations",
        "file": E2E_DIR / "test_tier3_interactions.py",
        "expected_min": 22,
    },
    {
        "id": "tier4",
        "name": "Tier 4: Real-World Application Scenarios & Complete Workflows",
        "file": E2E_DIR / "test_tier4_scenarios.py",
        "expected_min": 11,
    },
]

def print_header(title):
    width = 78
    print(f"\n{BOLD}{CYAN}{'=' * width}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'=' * width}{RESET}\n")

def run_pytest_module(module_path):
    """Run pytest on a single module and return (returncode, stdout, stderr, duration)."""
    start = time.time()
    cmd = [sys.executable, "-m", "pytest", str(module_path), "-v", "--tb=short"]
    proc = subprocess.run(
        cmd,
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    duration = time.time() - start
    return proc.returncode, proc.stdout, proc.stderr, duration

def parse_pytest_output(stdout):
    """Parse collected, passed, failed, and skipped counts from pytest output."""
    passed = 0
    failed = 0
    collected = 0

    for line in stdout.splitlines():
        if "collected " in line and "items" in line:
            try:
                parts = line.split("collected ")[1].split("items")[0].strip()
                collected = int(parts.split()[0])
            except Exception:
                pass
        if " passed" in line or " failed" in line:
            # e.g. "=== 110 passed in 14.82s ==="
            words = line.split()
            for i, w in enumerate(words):
                if w.startswith("pass") and i > 0:
                    try: passed = int(words[i - 1])
                    except Exception: pass
                elif w.startswith("fail") and i > 0:
                    try: failed = int(words[i - 1])
                    except Exception: pass

    if passed == 0 and failed == 0 and collected > 0 and "passed" in stdout:
        passed = collected

    return collected, passed, failed

def main():
    print_header("FABLED CAPABILITY SHOWCASE — E2E TEST RUNNER")
    print(f"Project Root: {ROOT_DIR}")
    print(f"Test Directory: {E2E_DIR}")
    print(f"Python: {sys.executable}\n")

    overall_start = time.time()
    results = []
    all_passed = True
    total_collected = 0
    total_passed = 0
    total_failed = 0

    for tier in TIERS:
        print(f"{BOLD}Running {tier['name']}...{RESET}")
        rc, stdout, stderr, dur = run_pytest_module(tier["file"])
        collected, passed, failed = parse_pytest_output(stdout)

        total_collected += collected
        total_passed += passed
        total_failed += failed

        success = (rc == 0 and failed == 0 and passed >= tier["expected_min"])
        if not success:
            all_passed = False

        status_str = f"{GREEN}PASS{RESET}" if success else f"{RED}FAIL{RESET}"
        print(f"  Result: {status_str} | Collected: {collected} | Passed: {passed} | Failed: {failed} | Time: {dur:.2f}s")
        if failed > 0:
            print(f"{YELLOW}--- Failure Output ---{RESET}")
            for line in stdout.splitlines()[-20:]:
                print(f"  {line}")

        results.append({
            "tier": tier["id"],
            "name": tier["name"],
            "collected": collected,
            "passed": passed,
            "failed": failed,
            "duration_s": round(dur, 2),
            "status": "PASS" if success else "FAIL",
        })

    overall_duration = time.time() - overall_start

    print_header("E2E TEST SUITE EXECUTION SUMMARY")
    print(f"{'Tier':<10} {'Name':<50} {'Passed':<8} {'Time':<8} {'Status':<6}")
    print(f"{'-' * 10} {'-' * 50} {'-' * 8} {'-' * 8} {'-' * 6}")
    for r in results:
        status_colored = f"{GREEN}PASS{RESET}" if r["status"] == "PASS" else f"{RED}FAIL{RESET}"
        print(f"{r['tier']:<10} {r['name'][:48]:<50} {r['passed']:<8} {r['duration_s']:<7.2f}s {status_colored:<6}")

    print(f"\n{BOLD}Total Tests Collected / Executed:{RESET} {total_collected}")
    print(f"{BOLD}Total Passed:{RESET} {GREEN}{total_passed}{RESET}")
    print(f"{BOLD}Total Failed:{RESET} {RED if total_failed > 0 else GREEN}{total_failed}{RESET}")
    print(f"{BOLD}Minimum Requirement:{RESET} 253 tests (Achieved: {total_passed} / 253)")
    print(f"{BOLD}Total Execution Time:{RESET} {overall_duration:.2f}s\n")

    summary_file = ROOT_DIR / "test_results.json"
    summary_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_tests": total_collected,
        "passed": total_passed,
        "failed": total_failed,
        "all_passed": all_passed,
        "duration_seconds": round(overall_duration, 2),
        "tiers": results,
    }
    summary_file.write_text(json.dumps(summary_data, indent=2))
    print(f"Results report written to {summary_file}")

    if all_passed and total_passed >= 253:
        print(f"\n{BOLD}{GREEN}>>> ALL E2E TEST SUITE TIERS PASSED (100% SUCCESS) <<<{RESET}\n")
        return 0
    else:
        print(f"\n{BOLD}{RED}>>> TEST RUN COMPLETED WITH FAILURES OR DEFICIENCIES <<<{RESET}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
