import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "upload.sh"

STUB = """#!/usr/bin/env bash
echo "$@" >> "$STUB_LOG"
case "$1" in
  lsf) printf '%s' "${STUB_LSF:-}" ;;
  check) exit "${STUB_CHECK_EXIT:-0}" ;;
esac
"""


@pytest.fixture
def env(tmp_path):
    (tmp_path / "bin").mkdir()
    stub = tmp_path / "bin" / "rclone"
    stub.write_text(STUB)
    stub.chmod(0o755)
    (tmp_path / "src" / "v1").mkdir(parents=True)
    (tmp_path / "src" / "v1" / "manifest.json").write_text("{}")
    return {**os.environ, "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}", "STUB_LOG": str(tmp_path / "log")}


def upload(tmp_path, env, *args, **extra):
    result = subprocess.run(
        ["bash", str(SCRIPT), "--remote", "r2:bucket", "--version", "v1", "--src", str(tmp_path / "src"), *args],
        env={**env, **extra}, capture_output=True, text=True,
    )
    log = (tmp_path / "log").read_text().splitlines() if (tmp_path / "log").exists() else []
    return result, log


def test_uploads_each_file_type_with_its_headers_then_verifies_then_switches_latest(tmp_path, env):
    result, log = upload(tmp_path, env)
    assert result.returncode == 0, result.stderr
    copies = [line for line in log if line.startswith("copy ")]
    assert len(copies) == 4
    by_type = {pattern: line for line in copies for pattern in ("*.geojson", "*.json", "*.csv", "*.gpkg") if f'--include {pattern}' in line}
    assert "Content-Type: application/geo+json" in by_type["*.geojson"] and "Content-Encoding: gzip" in by_type["*.geojson"]
    assert "Content-Type: application/json" in by_type["*.json"] and "Content-Encoding: gzip" in by_type["*.json"]
    assert "Content-Type: text/csv; charset=utf-8" in by_type["*.csv"] and "Content-Encoding" not in by_type["*.csv"]
    assert "Content-Type: application/geopackage+sqlite3" in by_type["*.gpkg"] and "Content-Disposition: attachment" in by_type["*.gpkg"]
    assert all("--immutable" in line and "max-age=31536000, immutable" in line and "r2:bucket/autoterm/v1" in line for line in copies)

    kinds = [line.split()[0] for line in log if not line.startswith("lsf")]
    assert kinds == ["copy", "copy", "copy", "copy", "check", "copyto"]  # latest.json is last, after the check
    assert "r2:bucket/autoterm/latest.json" in log[-1] and "max-age=60" in log[-1]


def test_refuses_to_overwrite_an_existing_version(tmp_path, env):
    result, log = upload(tmp_path, env, STUB_LSF="glaciers.json\n")
    assert result.returncode != 0 and "already exists" in result.stderr
    assert not any(line.startswith(("copy", "copyto")) for line in log)


def test_force_allows_an_existing_version(tmp_path, env):
    result, log = upload(tmp_path, env, "--force", STUB_LSF="glaciers.json\n")
    assert result.returncode == 0
    assert not any("--immutable" in line for line in log)  # overwriting is the point


def test_latest_is_not_switched_when_the_check_fails(tmp_path, env):
    result, log = upload(tmp_path, env, STUB_CHECK_EXIT="1")
    assert result.returncode != 0
    assert not any(line.startswith("copyto") for line in log)


def test_dry_run_changes_nothing(tmp_path, env):
    result, log = upload(tmp_path, env, "--dry-run")
    assert result.returncode == 0
    assert all("--dry-run" in line for line in log if line.split()[0] in ("copy", "copyto"))


def test_missing_build_folder_fails_before_calling_rclone(tmp_path, env):
    result = subprocess.run(
        ["bash", str(SCRIPT), "--remote", "r2:bucket", "--version", "v9", "--src", str(tmp_path / "src")],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode != 0 and "v9" in result.stderr
    assert not (tmp_path / "log").exists()
