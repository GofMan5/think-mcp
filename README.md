# 🧠 Think MCP v4.6.2

[![npm version](https://badge.fury.io/js/%40gofman3%2Fthink-mcp.svg)](https://www.npmjs.com/package/@gofman3/think-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP Server for structured sequential thinking. Helps LLMs break down complex problems into manageable steps with branching, revisions, cross-session learning, and proactive nudges.

> 📝 **Base Prompt:** [pastebin.com/EJcJ3fJF](https://pastebin.com/EJcJ3fJF)

## ✨ Features

- **5 Streamlined Tools** — `think`, `think_batch`, `think_done`, `think_recall`, `think_reset`
- **Burst Thinking** — Submit up to 30 thoughts in one call
- **Cross-Session Learning** — Insights from past sessions via `think_recall(scope:insights)`
- **Proactive Nudges** — Short prompts for self-reflection when patterns detected
- **Branching & Revisions** — Explore alternatives, fix mistakes
- **Dead Ends Tracking** — Remember rejected paths
- **Fuzzy Recall** — Search through thought history with Fuse.js
- **Session Persistence** — Auto-save/restore with 24h TTL

## 🚀 Quick Start

```bash
npx @gofman3/think-mcp
```

### MCP Configuration

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

### `think`
Add a single thought to the reasoning chain.

```typescript
{
  thought: string,
  thoughtNumber: number,
  totalThoughts: number,
  nextThoughtNeeded: boolean,
  confidence?: number,        // 1-10
  goal?: string,              // Set in first thought
  subSteps?: string[],        // Micro-plan (max 5)
  alternatives?: string[],    // Quick comparison (max 5)
  quickExtension?: {
    type: 'critique' | 'elaboration' | 'correction' | 'innovation' | 'optimization' | 'polish',
    content: string,
    impact?: 'low' | 'medium' | 'high' | 'blocker'
  },
  isRevision?: boolean,
  revisesThought?: number,
  branchFromThought?: number,
  branchId?: string
}
```

### `think_batch`
Submit complete reasoning chain in one call (1-30 thoughts).

```typescript
{
  goal: string,               // Min 10 chars
  thoughts: [{
    thoughtNumber: number,
    thought: string,          // Min 50 chars
    confidence?: number,
    subSteps?: string[],
    alternatives?: string[],
    extensions?: [{ type, content, impact }]
  }],
  consolidation?: {
    winningPath: number[],
    summary: string,
    verdict: 'ready' | 'needs_more_work'
  }
}
```

### `think_done`
Finish session with verification and optional export.

```typescript
{
  winningPath: number[],
  summary: string,
  verdict: 'ready' | 'needs_more_work',
  exportReport?: 'markdown' | 'json',
  includeMermaid?: boolean
}
```

### `think_recall`
Search current session or past insights.

```typescript
{
  query: string,
  scope?: 'session' | 'insights',  // Default: session
  searchIn?: 'thoughts' | 'extensions' | 'alternatives' | 'all',
  limit?: number,
  threshold?: number
}
```

### `think_reset`
Clear session and start fresh.

## 💡 Nudge System (v4.6)

When no warnings are present, the server returns short prompts based on detected patterns:

| Pattern | Nudge |
|---------|-------|
| confidence < 5 | "Low confidence. Validate assumptions?" |
| 3+ thoughts without alternatives | "No alternatives explored. Tunnel vision?" |
| Complex goal without subSteps | "Complex goal, no breakdown. Decompose?" |
| Unresolved blocker | "Blocker unresolved. Address before continuing?" |

Nudges appear only when there's no other systemAdvice — avoiding noise.

## 📊 Complexity Budget

| Task | Thoughts | Tool |
|------|----------|------|
| Simple | 0-2 | Skip or `think` |
| Medium | 3-7 | `think` step-by-step |
| Complex | 8-30 | `think_batch` |

## 🔄 Changelog

### v4.6.0
- **New:** NudgeService — proactive micro-prompts for self-reflection
- **New:** Nudge field in response (💡 icon)
- **Improved:** Nudges only appear when no other warnings present

### v4.5.0
- **Breaking:** Renamed tools (`sequentialthinking` → `think`, etc.)
- **New:** Cross-session insights via `think_recall(scope:insights)`
- **Improved:** Compact output, lazy tree generation

### v4.1.0
- **New:** `submit_thinking_session` (Burst Thinking)
- **New:** Atomic validation (sequence, stagnation, entropy)

### v3.4.0
- **New:** Fuzzy recall with Fuse.js
- **New:** Dead ends tracking
- **New:** Session TTL (24h)

## 📄 License

MIT

---

## 🎯 How to Use (for humans)

### Simple task — DON'T USE TOOLS
```
You: "Add console.log for debugging"
AI: *just does it, no thinking needed*
```

### Medium/Complex task — FULL WORKFLOW

**Example prompt:**
```
Working directory: C:/Projects/my-backend

1. Study folders src/auth/ and src/utils/
2. use think_batch — analyze architecture and edge cases
3. use task_spec — create specification with tasks

Goal: "Build robust password validation backend logic"

Requirements:
- Minimum 8 characters
- At least 1 digit, 1 special character
- Check against leaked passwords (haveibeenpwned API)
- Rate limiting on validation
```

**What happens:**
1. AI studies specified folders
2. `think_batch` — thinks through edge cases (what if API is down? what about unicode passwords?)
3. `task_spec` — creates spec with tasks in `.gofman3/specs/password-validation/`
4. You'll see files:
   - `requirements.md` — what we're building
   - `design.md` — how we're building  
   - `tasks.md` — progress (auto-updates!)

### Track progress
```
Show task_board
```
AI shows Kanban board — what's done, in progress, blocked.

### If AI is stuck
```
use think_recall query: "password validation" scope: insights
```
Searches past sessions for similar solutions.
