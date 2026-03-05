# think-mcp Local Eval Scenarios

This directory contains repository-local scenario definitions and a strict local validation harness for `think-mcp`.

## Run

```bash
npm run eval:local
```

## Output

- Machine-readable report: `tests/evals/think-mcp/results/latest.json`
- Exit code:
  - `0` if all suites pass
  - non-zero if any suite fails

## Required scenario IDs

- `state-integrity`
- `sequence-safety-gates`
- `session-persistence`
- `runtime-storage-consistency`
- `insights-consistency`
- `schema-readme-consistency`
- `quality-speed-optimization`
- `security-baseline`

Missing, duplicate, or unexpected scenario IDs fail the validation.
