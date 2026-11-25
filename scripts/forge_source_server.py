"""Local-only experimental Forge adapter service. No demo/stub inference path.
Run from the repository root after installing requirements-forge-source.txt.
"""
import argparse
import hashlib
import json
import math
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

CONTRACT = "forge-source-v1"
BASE_MODEL = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
SYSTEM_PROMPT = "You are Forge, a security expert that detects vulnerabilities in code."
USER_TEMPLATE = (
    "Analyze this function and answer exactly one line: "
    "'vulnerable: yes' or 'vulnerable: no'.\n\n```c\n{code}\n```"
)


def adapter_fingerprint(folder):
    folder = Path(folder).resolve(strict=True)
    config = json.loads((folder / "adapter_config.json").read_text(encoding="utf8"))
    if config.get("base_model_name_or_path") != BASE_MODEL:
        raise ValueError("Adapter base model does not match the trained Qwen Coder model")
    weights = sorted(folder.glob("adapter_model*.safetensors"))
    # Pickle .bin weights are deliberately not loaded by this service.
    if not weights or any(p.is_symlink() for p in weights):
        raise ValueError("Provide non-symlink adapter_model*.safetensors weights")
    digest = hashlib.sha256()
    for path in [folder / "adapter_config.json", *weights]:
        digest.update(path.name.encode("utf8"))
        with path.open("rb") as file:
            for block in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


def validate_request(data):
    if not isinstance(data, dict) or data.get("contract") != CONTRACT or data.get("language") != "c":
        raise ValueError("Unsupported request contract/language")
    if not isinstance(data.get("functionId"), str) or not 1 <= len(data["functionId"]) <= 128:
        raise ValueError("Missing function ID")
    code = data.get("code")
    if not isinstance(code, str) or not 1 <= len(code) <= 3500:
        raise ValueError("Empty/oversized function; input is never silently truncated")
    return code


def build_predictor(adapter_dir, device, max_tokens):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    fingerprint = adapter_fingerprint(adapter_dir)
    # The evaluated notebook used the base tokenizer, not an arbitrary adapter tokenizer.
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=False)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    yes_ids = tokenizer.encode(" yes", add_special_tokens=False)
    no_ids = tokenizer.encode(" no", add_special_tokens=False)
    if len(yes_ids) != 1 or len(no_ids) != 1:
        raise ValueError("yes/no tokenization differs from the expected single-token contract")
    load = dict(trust_remote_code=False, attn_implementation="sdpa", use_safetensors=True)
    if device == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("CUDA requested but unavailable; use --device cpu explicitly")
        load.update(
            quantization_config=BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16,
            ),
            torch_dtype=torch.float16, device_map={"": 0},
        )
    else:
        load.update(torch_dtype=torch.float32, device_map={"": "cpu"})
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, **load)
    model = PeftModel.from_pretrained(model, adapter_dir, is_trainable=False)
    model.eval()

    def predict(code):
        prompt = tokenizer.apply_chat_template(
            [{"role": "system", "content": SYSTEM_PROMPT},
             {"role": "user", "content": USER_TEMPLATE.format(code=code)}],
            tokenize=False, add_generation_prompt=True,
        ) + "vulnerable:"
        inputs = tokenizer(prompt, return_tensors="pt", truncation=False, add_special_tokens=False)
        if inputs["input_ids"].shape[1] > max_tokens:
            raise ValueError("Function exceeds token limit; not truncated")
        inputs = {key: value.to(model.device) for key, value in inputs.items()}
        # Only last-position vocabulary logits. Never materialize [tokens, vocabulary].
        with torch.inference_mode():
            logits = model(**inputs, logits_to_keep=1, use_cache=False).logits[0, -1].float()
        score = float((logits[yes_ids[0]] - logits[no_ids[0]]).item())
        if not math.isfinite(score):
            raise ValueError("Nonfinite score")
        return score

    return predict, fingerprint


def make_handler(predict, fingerprint):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(60)

        def log_message(self, *_args):
            pass  # No source code, prompts or raw model output in request logs.

        def do_POST(self):
            try:
                if self.path != "/predict":
                    self.send_error(404)
                    return
                # Require the numeric loopback Host. No browser CORS or Origin traffic.
                if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or self.headers.get("Origin") is not None:
                    self.send_error(403)
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 20000:
                    self.send_error(413)
                    return
                data = json.loads(self.rfile.read(length))
                code = validate_request(data)
                score = predict(code)
                body = json.dumps({
                    "contract": CONTRACT, "functionId": data["functionId"],
                    "modelId": BASE_MODEL + "+forge-adapter", "adapterSha256": fingerprint,
                    "score": score, "truncated": False,
                }, allow_nan=False).encode("utf8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, KeyError, TypeError):
                self.send_error(422, "Invalid or oversized inference request")
            except Exception:
                self.send_error(503, "Inference unavailable; no safety conclusion")

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--max-tokens", type=int, default=1024)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 64 <= args.max_tokens <= 4096:
        parser.error("port/token limit out of range")
    predict, fingerprint = build_predictor(args.adapter, args.device, args.max_tokens)
    server = HTTPServer(("127.0.0.1", args.port), make_handler(predict, fingerprint))
    server.timeout = 30
    print(f"Forge source adapter {fingerprint}: http://127.0.0.1:{args.port}/predict (loopback only)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
