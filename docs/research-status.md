# Research status and reproducibility

The Forge research experiment and the dependency-scanning runtime are distinct.
The runtime uses an optional OpenAI-compatible client to explain OSV-backed
findings. It does not currently run the trained adapter as a code detector.

## Completed experiment

| Setting                                             | Recorded value                                           |
| --------------------------------------------------- | -------------------------------------------------------- |
| Base model                                          | `Qwen/Qwen2.5-Coder-1.5B-Instruct`                       |
| Method                                              | QLoRA adapter fine-tuning                                |
| Dataset mirror                                      | `claudios/DiverseVul`, split named `test`                |
| Task                                                | Function-level C/C++ binary vulnerability classification |
| Training subset                                     | 3,000 functions per class, 6,000 total                   |
| Held-out subset                                     | 500 functions per class, 1,000 total                     |
| Seed                                                | 42                                                       |
| Maximum code characters in evaluation configuration | 3,500                                                    |
| Hardware                                            | One Colab Tesla T4                                       |

The mirror's split name is not the experiment's train/test assignment. The
experiment builds its own held-out subset from that source. A held-out function
split is not evidence of a project-disjoint split.

## Recorded evaluation

The README metrics were transcribed from the completed evaluation notebook
export reviewed for this documentation update, rather than estimated from a
chart. The key confusion matrices are:

| Mode                 | True negative | False positive | False negative | True positive |
| -------------------- | ------------- | -------------- | -------------- | ------------- |
| Adapter, generation  | 354           | 146            | 210            | 290           |
| Adapter, logits at 0 | 352           | 148            | 203            | 297           |

Generation: accuracy 0.644, precision 0.665, recall 0.580, F1 0.620.
Logits at threshold 0: accuracy 0.649, precision 0.667, recall 0.594,
F1 0.629, ROC-AUC 0.705. Base-model ROC-AUC: 0.589. The base model's
all-positive predictions make its apparent F1 of 0.667 an unsuitable single-number
claim of useful detection.

The exploratory threshold sweep reaches F1 0.691 at -0.641. Because the threshold
was selected on this same evaluation subset, an independent validation/test
procedure is needed before treating it as a final operating point.

## What is not included here

The trained adapter, final evaluation notebook, raw per-function predictions,
training configuration export, and training/evaluation PDFs are not committed
in this repository. Readers cannot fully reproduce the reported run from this
checkout alone. The project team should decide which artifacts it has rights to
publish and supply stable versioned links before claiming a reproducible model
release. No private Drive locations or access links are required to run the
current dependency scanner.

## Before a model release

- Publish the exact training and evaluation scripts with pinned dependencies.
- Record the dataset revision, filters, deduplication, split identifiers, and
  provenance without redistributing material beyond its license.
- Publish adapter metadata and a model card after model/dataset license review.
- Keep threshold selection separate from the final test set.
- Evaluate project-disjoint data and external real-code examples.
- Compare against relevant baselines on the same task and inputs.
- Keep any experimental source findings distinct from OSV advisory matches.
