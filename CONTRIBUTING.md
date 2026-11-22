# Contributing

VulnForge is a graduation-project workspace. Keep changes small enough for another
team member to review and distinguish implemented features from experiments.

## Local setup

Use Node.js 22 LTS and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

The default branch is `main`. Create a feature branch and open a pull request;
do not force-push to the shared default branch. Include a short explanation,
verification output, and screenshots for visible UI changes.

## Project rules

- Preserve the boundary between OSV evidence and optional AI text. Never create
  vulnerabilities, severities, or reachability claims from an LLM response.
- Keep coverage gaps explicit. An unsupported or unresolved input is not clean.
- Add regression tests for parsing, state transitions, or network behavior you
  change. Use recorded fixtures or injected clients for deterministic tests.
- Keep network concurrency bounded and respect cancellation and timeouts.
- Use the shared design tokens. Do not add arbitrary color literals; run
  `pnpm hex-audit` and regenerate derived token files when changing the tokens.
- Inspect UI changes in a real browser at useful viewport sizes. Test the whole
  path from starting a scan through opening its results.
- Do not commit credentials, generated dashboard bundles, model weights,
  checkpoints, notebook outputs containing private data, or local scan reports.
- Do not change project or third-party license terms without team agreement.

## Documentation and research claims

Show the exact model, dataset, split, decision rule, and evaluation limitations
when adding metrics. Do not report an exploratory best threshold as an unbiased
test result. Keep planned work visibly separate from supported behavior.

Historical gate reports under `reports/` record what was tested at the time.
They are not a substitute for inspecting current code.

## Reporting problems

For normal bugs, include the operating system, Node/pnpm versions, command,
expected and actual behavior, and a sanitized reproduction. Never include keys,
private source code, or a complete private dependency inventory in a public issue.
For sensitive findings, follow [SECURITY.md](SECURITY.md).
