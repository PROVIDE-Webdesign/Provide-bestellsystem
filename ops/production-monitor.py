#!/usr/bin/env python3
"""Check the four PROVIDE order-production services from outside Cloudflare."""
import concurrent.futures
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BASE = {service: f"https://{service}.provide-bestellen.de" for service in ("api", "shop", "dashboard")}
CHECKS = {
    "api": ("api", "/health", {"application": "api", "environment": "production"}),
    "database": ("api", "/health/database", {"database": "reachable"}),
    "shop": ("shop", "/api/health", {"application": "storefront", "environment": "production"}),
    "dashboard": ("dashboard", "/api/health", {"application": "dashboard", "environment": "production"}),
}
FAILURE_LIMIT = 2
BACKUP_STATUS = pathlib.Path("/var/lib/provide-bs-production-backup/status.json")


def backup_probe(path=BACKUP_STATUS, now=None):
    now = now or datetime.datetime.now(datetime.UTC)
    try:
        data = json.loads(path.read_text())
        checked = datetime.datetime.fromisoformat(data["checkedAt"])
        completed = datetime.datetime.fromisoformat(data["completedAt"])
        if data.get("environment") != "production":
            return "wrong_environment"
        if checked > now or now - checked > datetime.timedelta(minutes=20):
            return "backup_check_stale"
        if completed > now or now - completed > datetime.timedelta(hours=26):
            return "backup_stale"
        if data.get("backup") != "ok" or not isinstance(data.get("bytes"), int) or data["bytes"] <= 0:
            return "backup_invalid"
        return "ok"
    except (OSError, KeyError, ValueError, TypeError):
        return "backup_status_unavailable"



class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(check):
    service, path, expected = check
    command = [
        "/usr/bin/curl", "--silent", "--show-error", "--max-time", "10",
        "--max-filesize", "4096", "--proto", "=https", "--user-agent",
        "PROVIDE-Bestellsystem-Monitor/1.0", "--header", "Cache-Control: no-cache",
        "--header", "Accept: application/json", "--write-out", "\n%{http_code}",
        BASE[service] + path,
    ]
    credential_input = None
    if service == "api" and path == "/health/database":
        credential_directory = os.environ.get("CREDENTIALS_DIRECTORY")
        if not credential_directory:
            return "monitor_auth_unconfigured"
        try:
            token = pathlib.Path(credential_directory, "database-health-token").read_text().strip()
        except OSError:
            return "monitor_auth_unconfigured"
        if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token):
            return "monitor_auth_invalid"
        # curl reads the secret from stdin, keeping it out of process arguments and logs.
        command[-1:-1] = ["--config", "-"]
        credential_input = f'header = "Authorization: Bearer {token}"\n'.encode()
    try:
        response = subprocess.run(command, input=credential_input, capture_output=True, timeout=12, check=True)
        body, status = response.stdout.rsplit(b"\n", 1)
        if status != b"200":
            return f"http_{int(status)}"
        payload = json.loads(body)
        data = payload.get("data", payload)
        if data.get("status") != "ok" or any(data.get(key) != value for key, value in expected.items()):
            return "unexpected_health"
        return "ok"
    except (OSError, ValueError, AttributeError, subprocess.SubprocessError):
        return "probe_error"


def record(state_path, results):
    try:
        previous = json.loads(state_path.read_text())["consecutiveFailures"]
    except (FileNotFoundError, KeyError, ValueError):
        previous = {}
    counters = {
        name: 0 if result == "ok" else min(FAILURE_LIMIT, previous.get(name, 0) + 1)
        for name, result in results.items()
    }
    down = sorted(name for name, count in counters.items() if count >= FAILURE_LIMIT)
    report = {
        "checkedAt": datetime.datetime.now(datetime.UTC).isoformat(),
        "results": results,
        "consecutiveFailures": counters,
        "newIncidents": [name for name in down if previous.get(name, 0) < FAILURE_LIMIT],
        "recovered": sorted(name for name in counters if previous.get(name, 0) >= FAILURE_LIMIT and counters[name] == 0),
        "down": down,
    }
    with tempfile.NamedTemporaryFile(mode="w", dir=state_path.parent, delete=False) as temp:
        json.dump(report, temp)
    os.replace(temp.name, state_path)
    return report


def heartbeat(report):
    credentials = os.environ.get("CREDENTIALS_DIRECTORY")
    ping_file = pathlib.Path(credentials, "healthchecks-url") if credentials else None
    if ping_file is None or not ping_file.is_file():
        return "unconfigured"
    url = urllib.parse.urlsplit(ping_file.read_text().strip())
    if (
        url.scheme != "https" or url.netloc not in {"hc-ping.com", "healthchecks.io"}
        or not url.path.strip("/") or url.query or url.fragment
    ):
        return "invalid_configuration"
    suffix = "/fail" if report["down"] else ""
    try:
        opener = urllib.request.build_opener(NoRedirect())
        request = urllib.request.Request(
            url.geturl().rstrip("/") + suffix,
            data=json.dumps({"down": report["down"]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with opener.open(request, timeout=10) as response:
            return "reported" if response.status == 200 else "report_failed"
    except OSError:
        return "report_failed"


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(CHECKS)) as executor:
        results = dict(zip(CHECKS, executor.map(probe, CHECKS.values()), strict=True))
    results["backup"] = backup_probe()
    report = record(pathlib.Path(os.environ["STATE_DIRECTORY"], "status.json"), results)
    report["externalHeartbeat"] = heartbeat(report)
    print(json.dumps(report))
    return 1 if report["down"] or report["externalHeartbeat"] in {"invalid_configuration", "report_failed"} else 0


if __name__ == "__main__":
    sys.exit(main())
