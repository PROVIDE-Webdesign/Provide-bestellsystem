import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("production_monitor", Path(__file__).with_name("production-monitor.py"))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorAuthenticationTests(unittest.TestCase):
    def test_database_probe_requires_credential_before_sending(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(monitor.subprocess, "run") as run:
            self.assertEqual(monitor.probe(monitor.CHECKS["database"]), "monitor_auth_unconfigured")
            run.assert_not_called()

    def test_credential_is_sent_only_to_database_probe_and_not_in_arguments(self):
        token = "synthetic-monitor-token-0123456789-0123456789-0123456789"
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "database-health-token").write_text(token)
            response = subprocess.CompletedProcess([], 0, b'{"data":{"database":"reachable","status":"ok"}}\n200', b"")
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": folder}), patch.object(monitor.subprocess, "run", return_value=response) as run:
                self.assertEqual(monitor.probe(monitor.CHECKS["database"]), "ok")
                command = run.call_args.args[0]
                self.assertNotIn(token, " ".join(command))
                self.assertIn("--config", command)
                self.assertIn(token.encode(), run.call_args.kwargs["input"])
            response = subprocess.CompletedProcess([], 0, json.dumps({"status":"ok", "application":"api", "environment":"production"}).encode()+b"\n200", b"")
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": folder}), patch.object(monitor.subprocess, "run", return_value=response) as run:
                self.assertEqual(monitor.probe(monitor.CHECKS["api"]), "ok")
                self.assertIsNone(run.call_args.kwargs["input"])

    def test_malformed_credential_cannot_inject_curl_options(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "database-health-token").write_text('bad"\nurl="https://unrelated.invalid')
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": folder}), patch.object(monitor.subprocess, "run") as run:
                self.assertEqual(monitor.probe(monitor.CHECKS["database"]), "monitor_auth_invalid")
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
