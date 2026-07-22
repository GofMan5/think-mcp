<div align="center">

# Think MCP

**Structured reasoning tools for MCP-compatible LLM clients**

[![npm version](https://img.shields.io/npm/v/@gofman3/think-mcp?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@gofman3/think-mcp)
[![license](https://img.shields.io/badge/license-MIT-f5c542?style=flat-square)](https://opensource.org/licenses/MIT)
[![mcp](https://img.shields.io/badge/MCP-compatible-111827?style=flat-square)](https://modelcontextprotocol.io/)
[![release gates](https://img.shields.io/badge/release-validated-1f7a5c?style=flat-square)](#quality-and-release-gates)

Reason step by step, branch when needed, block weak finals, and keep useful memory across sessions.

[Install](#install) | [Tools](#toolset) | [think_cycle](#think_cycle) | [Quality Gates](#quality-and-release-gates) | [Changelog](#changelog)

</div>

---

## Why this exists

Most LLM workflows fail in predictable ways:

- They answer too early.
- They stay linear when the task needs alternatives or critique.
- They lose earlier insights between steps.
- They finish with confidence that is not backed by verification.

Think MCP adds an external reasoning layer for those failures. It does not replace the model's intelligence. It constrains and structures the way that intelligence is used.

## What is in 5.6.0

- Added explicit coaching, completion blockers, and deterministic next-action routing for models.
- Made finalized cycles terminal, restart-safe, and idempotent, including insight retries.
- Rejected blank summaries and disconnected winning paths before state or insights are committed.
- Kept omitted confidence optional instead of inventing false low-confidence failures.
- Strengthened deep logic guidance with source evidence and an attempted refutation.
- Replaced title-only regex evals with executable MCP and cycle behavioral tests.

## Core model

Think MCP combines three layers:

| Layer | Role | Outcome |
| :--- | :--- | :--- |
| `think` / `think_batch` | Capture incremental or prebuilt reasoning | Better decomposition, branching, revisions |
| `think_cycle` | Enforce adaptive depth and hard final gate | Blocks shallow or weak final answers |
| Recall + coaching + validation | Preserve useful context and warn on weak patterns | Better consistency and fewer dead-end sessions |

## Install

### Run directly

```bash
npx -y @gofman3/think-mcp
```

### MCP config

```json
{
  "mcpServers": {
    "think": {
      "command": "npx",
      "args": ["-y", "@gofman3/think-mcp"]
    }
  }
}
```

### Local development

```bash
npm install
npm run build
npm test
```

## Toolset

| Tool | Purpose | Best use |
| :--- | :--- | :--- |
| `think` | Add one structured reasoning step | Medium-complexity tasks that need guided progression |
| `think_batch` | Submit one already-built reasoning chain | Fast validation of a complete prebuilt chain |
| `think_cycle` | Adaptive reasoning state machine with a hard process gate | High-risk or high-complexity tasks |
| `think_logic` | Return a read-only analysis checklist | Choosing methodology before doing an audit |
| `think_recall` | Search the active scope or stored insights | Reuse patterns, avoid repeating dead ends |
| `think_done` | Finalize a `think` or `think_batch` scope | Controlled non-cycle completion |
| `think_reset` | Clear the active scope state | Hard context shift only |

## `think_cycle`

`think_cycle` is the main depth-control tool in the current release.

It runs a session as a state machine:

`start -> step -> status -> finalize`

If the reasoning process is incomplete, `finalize` does not silently pass. It blocks completion and returns one concrete next action plus the required minimum of additional thoughts.

### Key behavior

- Adaptive required depth based on goal complexity and risk markers.
- Hard gate for phase coverage: `decompose`, `alternative`, `critique`, `synthesis`, `verification`.
- Structural quality score with penalties for repetition, weak verification, and unstable confidence. It does not pretend to judge semantic truth.
- Confidence is optional; stability is reported only after two scored steps instead of inventing missing data.
- Explicit `constraintCheck` before finalizing a session that started with constraints.
- Terminal completion: a completed cycle keeps its approved answer, rejects new steps, and retries a failed deduplicated insight save safely.
- Fallback interop with the regular `think` backend when `backendMode=auto`.
- Loop budget control to avoid infinite cost and latency growth.

### Input shape

```ts
{
  action: 'start' | 'step' | 'status' | 'finalize' | 'reset',
  sessionId?: string,
  scopeId?: string,
  goal?: string,
  context?: string,
  constraints?: string[],
  thought?: string,
  thoughtType?: 'decompose' | 'alternative' | 'critique' | 'synthesis' | 'verification' | 'revision',
  confidence?: number,
  finalAnswer?: string,
  constraintCheck?: string,
  backendMode?: 'auto' | 'independent' | 'think',
  maxLoops?: number,
  showTrace?: boolean,
  exportReport?: 'markdown' | 'json',
  includeMermaid?: boolean
}
```

### Output shape

```ts
{
  status: 'in_progress' | 'blocked' | 'ready' | 'completed' | 'error',
  sessionId: string,
  scopeId?: string,
  loop: { current: number, max: number, required: number, remaining: number },
  quality: {
    overall: number,
    coverage: number,
    critique: number,
    verification: number,
    diversity: number,
    confidenceStability?: number
  },
  gate: { passed: boolean, reasonCodes: string[] },
  requiredMoreThoughts: number,
  nextPrompts: string[],
  shortTrace?: string[],
  finalApprovedAnswer?: string
}
```

### Example flow

```ts
// 1. Start
{
  action: 'start',
  goal: 'Design a safe migration from Redis session cache to Postgres-backed sessions',
  constraints: ['zero logout spike', 'rollback in under 5 minutes'],
  backendMode: 'auto'
}

// 2. Add steps
{
  action: 'step',
  sessionId: 'cycle_xxx',
  thought: 'Break the migration into dual-write, read-fallback, rollout metrics, and rollback paths.'
}

// 3. Try to finalize
{
  action: 'finalize',
  sessionId: 'cycle_xxx',
  finalAnswer: 'We should migrate in phases and monitor it carefully...'
}
```

Typical blocked response:

```ts
{
  status: 'blocked',
  gate: { passed: false, reasonCodes: ['MISSING_PHASE_VERIFICATION'] },
  requiredMoreThoughts: 1,
  nextPrompts: [
    'Next: think_cycle step with thoughtType="verification" — define tests, metrics, and rollback triggers.'
  ]
}
```

## Other tools

### `think`

Use when you want incremental reasoning with revisions, branches, substeps, and quick extensions.

`scopeId` is optional and accepted only on `thoughtNumber=1`. If omitted on the first thought, a new active scope is created.

```ts
{
  thought: 'The bug likely comes from stale branch state after retry.',
  thoughtNumber: 1,
  totalThoughts: 3,
  nextThoughtNeeded: true,
  confidence: 6,
  quickExtension: {
    type: 'critique',
    content: 'Verify whether retry state is recreated or reused.'
  }
}
```

### `think_batch`

Use only when the complete chain is already built and you want to validate it atomically in one call.

`scopeId` is optional. If omitted, batch submission creates a new active scope.

```ts
{
  goal: 'Audit deployment rollback flow',
  thoughts: [
    { thoughtNumber: 1, thought: 'Identify every entry point that can change rollout state and ownership.' },
    { thoughtNumber: 2, thought: 'Trace rollback triggers, timeout behavior, and observable recovery evidence.' }
  ]
}
```

### `think_logic`

Use for strict methodology generation before an audit. It returns instructions, not findings; `deep` adds an evidence-and-disconfirmation gate.

```ts
{
  target: 'Review the payment retry pipeline for consistency and failure isolation',
  depth: 'deep',
  focus: ['reliability', 'performance', 'data-flow']
}
```

### `think_recall`

Use before starting a familiar class of problem. Session recall searches the full active scope across the active `think` state and every attached `think_cycle` session. You can also pass an explicit `scopeId`.

```ts
{
  query: 'rollback strategy cache migration',
  scope: 'insights',
  limit: 5
}
```

### `think_done`

By default, `think_done` finalizes the active think scope. Pass `scopeId` to finalize an inactive think scope explicitly. A cycle-only scope has no think history, so finalize it with `think_cycle` action `finalize` instead.

## Quality and release gates

Release verification is built into the repo:

```bash
npm run validate:release
```

Main checks:

- TypeScript typecheck
- Unit and behavioral MCP tests (`npm test`; focused: `npm run eval:local`)
- Repo structure validation
- Security audit
- Hard quality baseline in `docs/quality/HARD_QUALITY_STANDARD.md`

## Runtime storage

- Default data directory: `~/.think-mcp`
- Override with `THINK_MCP_DATA_DIR`
- `think_cycle` sessions persist in runtime storage with TTL cleanup
- Shared scope metadata persists in `runtime_state.json`

## Package links

- npm: [@gofman3/think-mcp](https://www.npmjs.com/package/@gofman3/think-mcp)
- repo: [GofMan5/think-mcp](https://github.com/GofMan5/think-mcp)

## Changelog

### v5.6.0

- Added actionable model guidance and deterministic tool routing.
- Hardened cycle completion, persistence, retries, confidence scoring, and state integrity.
- Added real stdio and cycle behavioral evaluation while simplifying the build and package.

### v5.5.1

- Fixed broken mojibake output in runtime coaching strings.
- Rebuilt and refreshed README for the current toolset and quality model.
- Released documentation and packaging cleanup on top of `5.5.0`.

### v5.5.0

- Added `think_cycle` for adaptive external reasoning with hard quality gates.
- Added release-gated hard quality policy based on `NEED_ADD`.
- Added eval scenarios for cycle gating, fallback behavior, autonomy quality, safety gates, and bounded retries.

### v5.1.0

- Switched prompt style toward imperative IF/THEN instructions.
- Reduced token overhead significantly for common reasoning flows.

### v5.0.0

- Added `think_logic` methodology generation.

---

<div align="center">
Built for controlled reasoning, not blind verbosity.
</div>
