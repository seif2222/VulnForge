"""Contract-only tests, no model weights or torch imported."""
import http.client
import json
import tempfile
import threading
import unittest
from http.server import HTTPServer
from pathlib import Path

from forge_source_server import (
    BASE_MODEL, adapter_fingerprint, make_handler, validate_request,
)


class SourceContractTests(unittest.TestCase):
    def request(self, data, headers=None, path="/predict"):
        server = HTTPServer(("127.0.0.1", 0), make_handler(lambda code: 0.75, "a" * 64))
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            client.request("POST", path, json.dumps(data), headers or {})
            response = client.getresponse()
            return response.status, response.read()
        finally:
            client.close()
            thread.join(timeout=5)
            server.server_close()

    def payload(self):
        return {"contract": "forge-source-v1", "language": "c", "functionId": "abc", "code": "int f(){return 0;}"}

    def test_prediction_contract(self):
        status, body = self.request(self.payload())
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertEqual(result["functionId"], "abc")
        self.assertEqual(result["score"], 0.75)
        self.assertFalse(result["truncated"])
        self.assertNotIn("code", result)

    def test_browser_origin_rejected(self):
        status, _ = self.request(self.payload(), {"Origin": "https://example.com"})
        self.assertEqual(status, 403)

    def test_bad_host_rejected(self):
        status, _ = self.request(self.payload(), {"Host": "evil.test"})
        self.assertEqual(status, 403)

    def test_invalid_language_rejected(self):
        data = self.payload()
        data["language"] = "python"
        self.assertEqual(self.request(data)[0], 422)

    def test_path_rejected(self):
        self.assertEqual(self.request(self.payload(), path="/other")[0], 404)

    def test_oversized_function_rejected(self):
        data = self.payload()
        data["code"] = "x" * 3501
        with self.assertRaises(ValueError):
            validate_request(data)

    def test_no_weights_is_not_base_model_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "adapter_config.json").write_text(json.dumps({"base_model_name_or_path": BASE_MODEL}))
            with self.assertRaises(ValueError):
                adapter_fingerprint(directory)

    def test_fingerprint_changes_with_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "adapter_config.json").write_text(json.dumps({"base_model_name_or_path": BASE_MODEL}))
            weights = path / "adapter_model.safetensors"
            weights.write_bytes(b"mock-test-weights-not-real")
            first = adapter_fingerprint(directory)
            weights.write_bytes(b"different-mock-weights")
            self.assertNotEqual(first, adapter_fingerprint(directory))
            self.assertEqual(len(first), 64)


if __name__ == "__main__":
    unittest.main()
