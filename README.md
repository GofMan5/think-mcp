# 🧠 Think MCP v4.0

[![npm version](https://badge.fury.io/js/%40gofman3%2Fthink-mcp.svg)](https://www.npmjs.com/package/@gofman3/think-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP Server for structured sequential thinking. Helps LLMs break down complex problems into manageable steps with **Burst Thinking**, branching, revisions, and fuzzy recall.

## ✨ Features

- **Sequential Thinking** — Step-by-step reasoning with confidence tracking
- **🆕 Burst Thinking (v4.0)** — Submit up to 30 thoughts in one call for complex analysis
- **Branching & Revisions** — Explore alternatives, fix mistakes
- **Dead Ends Tracking** — Remember rejected paths to avoid circular thinking
- **Proactive Coach** — Nudges for better thinking (low confidence, missing critique)
- **Strategic Lenses** — Innovation, optimization, polish extensions
- **Fuzzy Recall** — Search through thought history with Fuse.js
- **Session Persistence** — Auto-save/restore thinking sessions

## 🚀 Quick Start

### Using npx (recommended)

```bash
npx @gofman3/think-mcp
```

### Install globally

```bash
npm install -g @gofman3/think-mcp
think-mcp
```

## ⚙️ MCP Configuration

Add to your MCP config (`mcp.json`):

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

## 🛠️ Tools

### `sequentialthinking`
Primary tool for step-by-step reasoning.

```typescript
{
  thought: string,           // Your current reasoning step
  thoughtNumber: number,     // Sequential: 1, 2, 3...
  totalThoughts: number,     // Estimate (auto-adjusts)
  nextThoughtNeeded: boolean,
  confidence?: number,       // 1-10
  goal?: string,             // Session goal (set in first thought)
  subSteps?: string[],       // Micro-plan (max 5)
  alternatives?: string[],   // Quick comparison (max 5)
  isRevision?: boolean,
  revisesThought?: number,
  branchFromThought?: number,
  branchId?: string,
  quickExtension?: {         // Inline critique/elaboration
    type: 'critique' | 'elaboration' | ...,
    content: string,
    impact?: 'low' | 'medium' | 'high' | 'blocker'
  }
}
```

### `submit_thinking_session` 🆕
**Burst Thinking** — Submit a complete reasoning chain in one call.

```typescript
{
  goal: string,              // Session goal (min 10 chars)
  thoughts: [{               // Array of 1-30 thoughts
    thoughtNumber: number,
    thought: string,         // Min 50 chars
    confidence?: number,
    subSteps?: string[],
    alternatives?: string[],
    extensions?: [{
      type: 'critique' | 'optimization' | ...,
      content: string,
      impact?: 'blocker' | 'high' | 'medium' | 'low'
    }],
    isRevision?: boolean,
    revisesThought?: number,
    branchFromThought?: number,
    branchId?: string
  }],
  consolidation?: {          // Optional final validation
    winningPath: number[],   // Key thoughts: [1, 2, 4, 6]
    summary: string,
    verdict: 'ready' | 'needs_more_work'
  }
}
```

**Validation:**
- Sequence check: thought numbers must be sequential
- Stagnation check: < 60% similarity between adjacent thoughts
- Entropy check: vocabulary diversity > 0.25
- Blocker check: blockers require revision or exclusion from path
- Path gaps: WARNING (not error) — allows selective key thoughts

### `extend_thought`
Deep-dive into a specific thought without advancing.

```typescript
{
  targetThoughtNumber: number,
  extensionType: 'critique' | 'elaboration' | 'correction' | 
                 'alternative_scenario' | 'assumption_testing' |
                 'innovation' | 'optimization' | 'polish',
  content: string,
  impactOnFinalResult: 'low' | 'medium' | 'high' | 'blocker'
}
```

**Strategic Lenses:**
- `innovation` — Find gaps, propose new features (include 2-3 proposals)
- `optimization` — Performance, memory, code reduction (include Before/After)
- `polish` — Edge cases, typing, docs, SOLID/DRY (include checklist)

### `consolidate_and_verify`
Final validation before answering.

```typescript
{
  winningPath: number[],     // e.g., [1, 2, 5, 8]
  summary: string,
  verdict: 'ready' | 'needs_more_work',
  constraintCheck?: string,  // Optional
  potentialFlaws?: string    // Optional
}
```

### `recall_thought`
Fuzzy search through thought history.

```typescript
{
  query: string,
  scope?: 'current' | 'all',
  searchIn?: 'thoughts' | 'extensions' | 'alternatives' | 'all',
  limit?: number,            // Default: 3
  threshold?: number         // 0-1, lower = stricter (default: 0.4)
}
```

### `reset_session`
Clear all thoughts and start fresh.

### `export_session`
Export session as Markdown or JSON with optional Mermaid diagram.

```typescript
{
  format?: 'markdown' | 'json',
  includeMermaid?: boolean
}
```

## 📊 Complexity Budget

| Task Type | Thoughts | Recommended Tool |
|-----------|----------|------------------|
| Simple    | 0-2      | Direct answer or single `sequentialthinking` |
| Medium    | 3-7      | `sequentialthinking` step-by-step |
| Complex   | 8-30     | `submit_thinking_session` (Burst) |

## 🔄 Changelog

### v4.0.1
- **Fix:** Path discontinuity changed from ERROR to WARNING — allows selective key thoughts in `winningPath`

### v4.0.0
- **New:** `submit_thinking_session` — Burst Thinking for complex analysis
- **New:** Atomic validation (sequence, stagnation, entropy, blockers)
- **New:** Session metrics (avgConfidence, avgEntropy, stagnationScore)

### v3.4.0
- **New:** `recall_thought` — Fuzzy search with Fuse.js
- **New:** Dead ends tracking
- **New:** Session TTL (24h auto-reset)

## 📄 License

MIT

