# Experimental Forge source detector

## Scope and current status

Opt-in `source` command, independent from `scan`, TUI and dashboard. The existing
OSV report schema, CVE counts and `--fail-on` are unchanged. Output goes to a
separate JSON report. The HTTP pipeline is testable with mocks. Tests using a
mock do not measure Forge accuracy.

Adapter status (Nov 25, 2026): the real adapter has been received and
structurally verified (see below). The service prompt is byte-identical to the
recorded eval prompt and the fingerprint validator accepts the folder. Actual
model loading, GPU memory, latency and score equivalence with the notebook are
still NOT verified; that needs a real hardware rehearsal.

Only bounded C functions in `.c` files are supported. Extraction is a conservative
brace-matching heuristic, not a C parser or dataflow analysis. C++, headers,
macros, conditionals, cross-function context, Python and JavaScript are not
supported by this first source classifier. npm/Python dependency scans remain
separate and are not source-classifier benchmarks.

## Windows PowerShell, after this branch is supplied

Use Python 3.11 in a separate environment and install a suitable PyTorch build
for the selected CPU/CUDA device. Package ranges are a starting point, not a
hardware-tested lockfile. Freeze exact versions after rehearsal.

```powershell
cd E:\VulnForge
py -3.11 -m venv .venv-forge
.\.venv-forge\Scripts\python -m pip install -r scripts\requirements-forge-source.txt
.\.venv-forge\Scripts\python scripts\forge_source_server.py --adapter E:\Forge\adapter --device cpu
```

In a second terminal:

```powershell
cd E:\VulnForge
pnpm install --frozen-lockfile
pnpm build
$env:VULNFORGE_SOURCE_ENDPOINT = 'http://127.0.0.1:8765/predict'
node packages\cli\dist\bin.js source E:\MyCProject --out forge-source-report.json
```

CUDA mode uses `--device cuda`, NF4 double quantization, fp16 compute and batch 1.
It is a candidate for the previously reported RTX A2000 4 GB, not a memory or
latency guarantee. Ask for current GPU/VRAM, free RAM and Python/CUDA versions.
CPU mode is explicit float32, uses more RAM, is slower, and can differ numerically
from the evaluated 4-bit model. No automatic fallback or different base occurs.
The default token cap is 1024; oversized functions are rejected, not truncated.

## Verified adapter (received Nov 25, 2026)

Source: user-shared view-only Google Drive folder `runs/qwen15b-diversevul-v6`,
subfolder `adapter/`. Received files: `adapter_config.json`,
`adapter_model.safetensors` (73,911,112 bytes, sha256
`0dc2e078dbaeb3fccf0f293af60fc2de39e96cc800c5556eac4b4d9e9c90dca3`),
`chat_template.jinja`, `tokenizer_config.json`, `tokenizer.json`, `README.md`.

Verified structure: PEFT LoRA (`peft_type: LORA`, peft 0.21.2), base
`Qwen/Qwen2.5-Coder-1.5B-Instruct`, rank 16, alpha 32, dropout 0.05, targeting
q/k/v/o/gate/up/down projections. 392 tensors = 28 layers x 7 modules x
lora_A/lora_B, all float32, safetensors format `pt`, data section byte-exact.
No pickle `.bin` weights are used. The service fingerprint (sha256 over config
and weights, see `adapter_fingerprint`) for this folder is
`43d5c1c7efd8bf33acbc4ac740409f776e87974d5502f6f68a4e5b6e85f83b6c`; the server
prints its computed fingerprint at startup for comparison.

Training record (`run-config.json`, `train-metrics.json`): DiverseVul
(`claudios/DiverseVul`), 3,000 train + 500 eval functions per class, max 3,500
chars/function, max_length 1024, one epoch, seed 42, trained with TRL 1.18.2,
transformers 5.22.1, torch 2.14.1+cu130, peft 0.21.2.

Recorded final eval (`eval-results.json`, 2026-11-24T23:17 UTC, 1,000 held-out
functions): fine-tuned generation accuracy 0.644 / F1 0.620; logits at
threshold 0 accuracy 0.649 / F1 0.629; best swept threshold -0.640625 gives
recall 0.896 at precision 0.563 / F1 0.691. The base model answered yes to
everything (accuracy 0.500). The artifact records `roc_auc: null` for the
fine-tuned model; an ROC-AUC figure of 0.705 quoted earlier is not present in
this run's artifacts, so treat it as unconfirmed. The `eval-ckpt-*` files are
intermediate checkpoint outputs (all scores positive), not the final adapter.

## Required adapter files

Minimum: `adapter_config.json` and `adapter_model.safetensors` (both received
and verified, see above). If sharded, include all `adapter_model*.safetensors`
plus the index. The recovered eval used the base tokenizer; the service does
too. No base weights, dataset or Google credentials are needed. If only `.bin`
exists, re-export safetensors in the user's notebook; this service refuses
pickle adapter weights.

The service loads Qwen/Qwen2.5-Coder-1.5B-Instruct plus the supplied PEFT adapter.
It fails on missing/incompatible weights. It never substitutes the existing
Ollama qwen2.5:1.5b and calls that the trained Forge. GGUF/Ollama conversion needs
a separate equivalence check and is not implemented here.

## Inference contract and interpretation

POST `/predict`: contract `forge-source-v1`, deterministic functionId, language
`c`, code. Server returns the same contract/id, modelId, adapterSha256, finite
score and `truncated: false`. The client bounds response size, refuses redirects,
validates every field, rejects changed model identity and stops on inference
failure. Missing predictions are not classified as negative.

The service uses the recovered training system/user prompt, model chat template
and forced `vulnerable:` prefix. Score is logit(` yes`) minus logit(` no`), using
last-position logits only. It refuses non-single-token yes/no labels. It does not
generate a free-form explanation or execute model output.

Default threshold: **0**, inclusive. `--threshold <finite margin>` overrides it.
This means yes is at least as likely as no in the label comparison, NOT calibrated
confidence. The recorded eval (above) shows F1 0.629 at this default and a
high-recall tradeoff at -0.640625; neither establishes a reliable production
cutoff. Select thresholds on a separate validation set, not the held-out test
set. Preserve false alarms and misses.

Every prediction is labelled `unconfirmed-model-prediction`, severity `unknown`,
with raw score and candidate flag. No CVE, CWE, exploitability or remediation is
invented. Negative predictions are not proof of safety. Metadata includes file,
function, line bounds and the adapter fingerprint. Code is not saved in reports.

Status completed/partial/unavailable describes this bounded classification pass,
not project security. Exit 5 signals gaps/unavailability, never a clean project.
Limits: 100 C files, 200 functions, 3500 characters/function, 256 KiB/file, 10,000
entries and depth 20. Hidden/dependency/build directories and symlinks are
excluded. Files with preprocessing macros/conditionals are skipped. Some unusual
C syntax may remain unsupported. Review extracted function bounds.

Run on a trusted, quiescent checkout. Filesystem races are not an isolation
boundary. This local-only service is not hardened for multiple untrusted users.

## Colab and privacy

The client only accepts numeric loopback HTTP IP endpoints without credentials,
queries or redirects. The service binds 127.0.0.1, rejects browser Origin traffic
and unexpected Host headers, and logs no source. This branch sends no source to
Colab or hosted providers and opens no tunnels.

If local rehearsal fails, run inference in the user's own Colab runtime and scan
sample functions there. A future remote connection requires explicit approval to
send project source, authentication, private transport and bounded requests.
Free Colab availability/persistence is not guaranteed. Do not expose this service
publicly or create an unauthenticated tunnel.

## Before a defense

1. DONE (Nov 25, 2026): adapter received, base/config/hash verified, training
   package versions recorded. Still open: rehearsal device and package freeze.
2. Compare service scores with the eval notebook on identical C functions,
   tokenization and precision. Record differences.
3. Rehearse vulnerable and bounded examples, keep false negatives visible,
   including the earlier strcpy miss if it recurs. Never prewrite results.
4. Re-run OSV demos separately and explain the different evidence sources.
5. Only then consider dashboard integration or merging. No PR is created here.

## References

- https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct
- https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint
- https://huggingface.co/docs/transformers/main/en/quantization/bitsandbytes
