# Think MCP Hard Quality Standard

Version: 1.0  
Source baseline: `NEED_ADD` hardening policies (`auto-gofman3-coder` eval contract)

This document is **release-gated**. Repository validation must fail if this policy is missing or materially drifted.

## 1) Autonomy Quality Loop

- Decompose work into dependency-safe units.
- Validate each increment before proceeding.
- Produce an iteration self-check report after meaningful steps.
- Stop when threshold is met (quality threshold: **90/100**).

## 2) Safety Gates

- Stop on build/test/eval failure (stop-on-failure).
- Report-first sequence: report error -> propose fix -> request approval -> apply fix.
- Do not auto-fix failures silently (no hidden auto-fix).

## 3) Bounded Retries and Escalation

- Max 3 self-improvement retries per component.
- Do not run unbounded retry loops.
- Escalate with a gap report when blocked by missing context/risk.

## 4) Quality and Speed Optimization Lock

- Validate input data at boundaries.
- Use single-purpose, composable modules and explicit dependencies.
- Throughput KPI tracking is required each iteration.
- Throughput optimization never overrides safety gates.
- Use shortest safe path and one discovery pass.
- Prefer delta-only progress and reject low-signal actions.

## 5) Execution Throttle

- Execution throttle (v3.1) is mandatory for low-complexity mode.
- Validation cannot be skipped due to budget.
- If execution reaches budget with unfinished required scope: stop, report delta, request re-approval.
