#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..', '..');
const resultsDir = path.join(__dirname, 'results');
const resultPath = path.join(resultsDir, 'latest.json');

const REQUIRED_SCENARIO_IDS = [
  'state-integrity',
  'sequence-safety-gates',
  'session-persistence',
  'runtime-storage-consistency',
  'insights-consistency',
  'adaptive-cycle-gate',
  'think-interop-fallback',
  'autonomy-quality',
  'safety-gates',
  'bounded-retries',
  'schema-readme-consistency',
  'quality-speed-optimization',
  'security-baseline',
];

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getScenarioFiles() {
  return fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(__dirname, name));
}

function validateScenarioInventory(scenarios) {
  const ids = scenarios.map((scenario) => scenario.id).filter(Boolean);
  const idSet = new Set(ids);

  const missing = REQUIRED_SCENARIO_IDS.filter((id) => !idSet.has(id));
  const unexpected = ids.filter((id) => !REQUIRED_SCENARIO_IDS.includes(id));
  const duplicate = ids.filter((id, index) => ids.indexOf(id) !== index);

  const checks = [
    {
      id: 'required-present',
      description: 'All required scenario IDs are present',
      pass: missing.length === 0,
      evidence: missing.length === 0 ? 'all required scenarios present' : `missing: ${missing.join(', ')}`,
    },
    {
      id: 'no-unexpected',
      description: 'No unexpected scenario IDs exist',
      pass: unexpected.length === 0,
      evidence: unexpected.length === 0 ? 'no unexpected scenarios' : `unexpected: ${unexpected.join(', ')}`,
    },
    {
      id: 'unique-ids',
      description: 'Scenario IDs are unique',
      pass: duplicate.length === 0,
      evidence: duplicate.length === 0 ? 'all ids unique' : `duplicates: ${[...new Set(duplicate)].join(', ')}`,
    },
  ];

  return {
    id: 'scenario-inventory',
    title: 'Scenario inventory matches required set',
    pass: checks.every((check) => check.pass),
    checks,
  };
}

function parseVersion(raw) {
  const m = String(raw || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gteVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function getSignals() {
  const indexTs = readText('src/index.ts');
  const thinkingTs = readText('src/services/thinking.service.ts');
  const cycleTs = readText('src/services/cycle.service.ts');
  const insightsTs = readText('src/services/insights.service.ts');
  const validationTs = readText('src/services/validation.service.ts');
  const storagePathsTs = readText('src/utils/storage-paths.ts');
  const readme = readText('README.md');
  const qualityStandard = readText('docs/quality/HARD_QUALITY_STANDARD.md');
  const publish = readText('.github/workflows/publish.yml');
  const pkg = readJson('package.json');

  const requiredTools = ['think', 'think_batch', 'think_done', 'think_recall', 'think_reset', 'think_cycle', 'think_logic'];
  const registeredTools = [...indexTs.matchAll(/registerTool\('([^']+)'/g)].map((m) => m[1]);

  return {
    indexTs,
    thinkingTs,
    cycleTs,
    insightsTs,
    validationTs,
    storagePathsTs,
    readme,
    qualityStandard,
    publish,
    pkg,
    requiredTools,
    registeredTools,
  };
}

function validateScenario(scenario, signals) {
  const checksByScenario = {
    'state-integrity': [
      {
        id: 'reset-before-session-id',
        description: 'Batch flow resets state before creating new session id and goal',
        pass: /this\.reset\(\);\s*this\.currentSessionId = new Date\(\)\.toISOString\(\);\s*this\.sessionGoal = goal;/.test(signals.thinkingTs),
      },
      {
        id: 'records-use-current-session-id',
        description: 'Committed batch thoughts use active currentSessionId',
        pass: /toThoughtRecord\(t,\s*thoughts\.length,\s*this\.currentSessionId\)/.test(signals.thinkingTs),
      },
    ],
    'sequence-safety-gates': [
      {
        id: 'validation-hard-reject',
        description: 'Invalid sequence validation triggers hard reject in think flow',
        pass: /if \(!validation\.valid\) \{/.test(signals.thinkingTs),
      },
      {
        id: 'mainline-counter-guard',
        description: 'Mainline sequence counter ignores revisions and branches',
        pass: /if \(!input\.isRevision && !input\.branchFromThought\) \{\s*this\.lastThoughtNumber = input\.thoughtNumber;/.test(signals.thinkingTs),
      },
      {
        id: 'sequence-error-code',
        description: 'Sequence validator emits stable error code',
        pass: /\[ERR_SEQUENCE\]/.test(signals.validationTs),
      },
    ],
    'session-persistence': [
      {
        id: 'atomic-write',
        description: 'Session save uses temp file then rename',
        pass: /const tempFile = `\$\{SESSION_FILE\}\.tmp`[\s\S]*fs\.writeFile\(tempFile[\s\S]*fs\.rename\(tempFile,\s*SESSION_FILE\)/.test(signals.thinkingTs),
      },
      {
        id: 'ttl-guard',
        description: 'Session load enforces TTL expiration guard',
        pass: /hoursOld > SESSION_TTL_HOURS/.test(signals.thinkingTs),
      },
    ],
    'runtime-storage-consistency': [
      {
        id: 'storage-utils-exist',
        description: 'Storage utility exposes data-dir override env variable',
        pass: /THINK_MCP_DATA_DIR/.test(signals.storagePathsTs),
      },
      {
        id: 'session-migration',
        description: 'Thinking service migrates legacy session file into runtime data dir',
        pass: /migrateLegacyFile\(LEGACY_SESSION_FILE,\s*SESSION_FILE\)/.test(signals.thinkingTs),
      },
      {
        id: 'insights-migration',
        description: 'Insights service migrates legacy insights file into runtime data dir',
        pass: /migrateLegacyFile\(LEGACY_INSIGHTS_FILE,\s*INSIGHTS_FILE\)/.test(signals.insightsTs),
      },
      {
        id: 'readme-env-doc',
        description: 'README documents THINK_MCP_DATA_DIR override',
        pass: /THINK_MCP_DATA_DIR/.test(signals.readme),
      },
    ],
    'insights-consistency': [
      {
        id: 'schema-v2',
        description: 'Insights persistence uses schema version 2',
        pass: /INSIGHTS_SCHEMA_VERSION = 2/.test(signals.insightsTs),
      },
      {
        id: 'fifo-eviction-decrement',
        description: 'FIFO eviction decrements pattern counters',
        pass: /const evicted = this\.data!\.winningPaths\.shift\(\);[\s\S]*this\.decrementPatternCounts\(evicted\.keywords\)/.test(signals.insightsTs),
      },
      {
        id: 'rebuild-patterns-on-load',
        description: 'Loaded patterns are rebuilt from winning paths for integrity',
        pass: /patterns:\s*this\.buildPatternCounts\(winningPaths\)/.test(signals.insightsTs),
      },
    ],
    'adaptive-cycle-gate': [
      {
        id: 'cycle-service-exists',
        description: 'Cycle service is implemented',
        pass: /export class CycleService/.test(signals.cycleTs),
      },
      {
        id: 'hard-quality-threshold',
        description: 'Cycle quality gate threshold is enforced at 0.75',
        pass: /QUALITY_GATE_THRESHOLD = 0\.75/.test(signals.cycleTs),
      },
      {
        id: 'adaptive-required-thoughts',
        description: 'Required thoughts are calculated adaptively and clamped to 10-20',
        pass: /8 \+ Math\.round\(complexityScore \* 4\)/.test(signals.cycleTs) && /CYCLE_REQUIRED_MIN/.test(signals.cycleTs) && /CYCLE_REQUIRED_MAX/.test(signals.cycleTs),
      },
      {
        id: 'min-10-more-thoughts',
        description: 'Failed finalize asks for at least 10 more thoughts when budget allows',
        pass: /Math\.max\(10, baseNeed, weakBoost\)/.test(signals.cycleTs),
      },
      {
        id: 'all-required-phases',
        description: 'Gate requires decompose/alternative/critique/synthesis/verification coverage',
        pass: /'decompose',\s*'alternative',\s*'critique',\s*'synthesis',\s*'verification'/.test(signals.cycleTs),
      },
    ],
    'think-interop-fallback': [
      {
        id: 'auto-fallback-flag',
        description: 'Auto mode sets interop fallback flag on backend failure',
        pass: /session\.interopFallback = true/.test(signals.cycleTs),
      },
      {
        id: 'think-strict-no-fallback',
        description: 'Think mode returns interop backend error without fallback',
        pass: /session\.backendMode === 'think'/.test(signals.cycleTs) && /INTEROP_BACKEND_ERROR/.test(signals.cycleTs),
      },
      {
        id: 'tool-registered',
        description: 'think_cycle tool is registered in server index',
        pass: /registerTool\('think_cycle'/.test(signals.indexTs),
      },
    ],
    'autonomy-quality': [
      {
        id: 'decomposition-policy',
        description: 'Hard quality standard requires dependency-safe decomposition',
        pass: /decompose work into dependency-safe units/i.test(signals.qualityStandard),
      },
      {
        id: 'incremental-validation-policy',
        description: 'Hard quality standard requires increment-level validation',
        pass: /validate each increment/i.test(signals.qualityStandard),
      },
      {
        id: 'self-check-policy',
        description: 'Hard quality standard requires iteration self-check report',
        pass: /iteration self-check report/i.test(signals.qualityStandard),
      },
      {
        id: 'threshold-policy',
        description: 'Hard quality standard defines quality threshold stop condition',
        pass: /quality threshold:\s*\*\*90\/100\*\*/i.test(signals.qualityStandard),
      },
    ],
    'safety-gates': [
      {
        id: 'stop-on-failure-policy',
        description: 'Hard quality standard enforces stop-on-failure',
        pass: /stop-on-failure/i.test(signals.qualityStandard),
      },
      {
        id: 'report-first-policy',
        description: 'Hard quality standard enforces report-first recovery sequence',
        pass: /report error -> propose fix -> request approval -> apply fix/i.test(signals.qualityStandard),
      },
      {
        id: 'no-hidden-autofix-policy',
        description: 'Hard quality standard forbids hidden auto-fix',
        pass: /no hidden auto-fix/i.test(signals.qualityStandard),
      },
    ],
    'bounded-retries': [
      {
        id: 'retry-bound-policy',
        description: 'Hard quality standard sets per-component retry bound',
        pass: /max 3 self-improvement retries per component/i.test(signals.qualityStandard),
      },
      {
        id: 'anti-loop-policy',
        description: 'Hard quality standard forbids unbounded retry loops',
        pass: /do not run unbounded retry loops/i.test(signals.qualityStandard),
      },
      {
        id: 'escalation-policy',
        description: 'Hard quality standard requires escalation with gap report',
        pass: /escalate with a gap report/i.test(signals.qualityStandard),
      },
      {
        id: 'cycle-max-loops-enforced',
        description: 'Cycle service enforces max loop limit',
        pass: /CYCLE_MIN_MAX_LOOPS = 10/.test(signals.cycleTs) && /CYCLE_MAX_MAX_LOOPS = 30/.test(signals.cycleTs),
      },
    ],
    'schema-readme-consistency': [
      {
        id: 'all-tools-registered',
        description: 'All required tools are registered in src/index.ts',
        pass: signals.requiredTools.every((tool) => signals.registeredTools.includes(tool)),
      },
      {
        id: 'all-tools-documented',
        description: 'All required tools are referenced in README',
        pass: signals.requiredTools.every((tool) => signals.readme.includes(`\`${tool}\``)),
      },
    ],
    'quality-speed-optimization': [
      {
        id: 'show-tree-forwarded-think',
        description: 'showTree is forwarded to processThought',
        pass: /showTree: args\.showTree as boolean \| undefined/.test(signals.indexTs),
      },
      {
        id: 'show-tree-forwarded-batch',
        description: 'showTree is forwarded to submitSession',
        pass: /showTree: args\.showTree as boolean \| undefined/.test(signals.indexTs),
      },
      {
        id: 'lazy-batch-tree',
        description: 'Batch tree generation is conditional',
        pass: /thoughtTree: showTree \? this\.generateAsciiTree\(\) : undefined/.test(signals.thinkingTs),
      },
      {
        id: 'lazy-export-mermaid',
        description: 'Mermaid generation is skipped when includeMermaid is false',
        pass: /mermaidDiagram: includeMermaid \? this\.generateMermaid\(\) : undefined/.test(signals.thinkingTs),
      },
    ],
    'security-baseline': [
      {
        id: 'sdk-version-floor',
        description: 'MCP SDK dependency uses patched baseline >=1.27.1',
        pass: (() => {
          const parsed = parseVersion(signals.pkg.dependencies?.['@modelcontextprotocol/sdk']);
          return parsed ? gteVersion(parsed, [1, 27, 1]) : false;
        })(),
      },
      {
        id: 'publish-audit-gate',
        description: 'Publish workflow runs security audit gate',
        pass: signals.publish.includes('npm run security:audit'),
      },
      {
        id: 'tag-based-publish',
        description: 'Publish workflow is tag-based',
        pass: /tags:\s*\n\s*-\s*'v\*'/.test(signals.publish),
      },
    ],
  };

  const mapped = checksByScenario[scenario.id] || [];
  const checks = mapped.map((check) => ({
    ...check,
    evidence: check.pass ? 'pass' : 'missing condition in source',
  }));

  if (checks.length === 0) {
    return {
      id: scenario.id || path.basename(scenario.__file || 'unknown'),
      title: scenario.title || 'Unnamed scenario',
      pass: false,
      checks: [
        {
          id: 'unsupported-scenario',
          description: 'Scenario id has matcher implementation',
          pass: false,
          evidence: `no matcher mapping for scenario id '${scenario.id}'`,
        },
      ],
    };
  }

  return {
    id: scenario.id,
    title: scenario.title,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const signals = getSignals();

  const scenarioFiles = getScenarioFiles();
  const scenarios = scenarioFiles.map((filePath) => {
    const scenario = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    scenario.__file = path.relative(root, filePath).replace(/\\/g, '/');
    return scenario;
  });

  const inventorySuite = validateScenarioInventory(scenarios);
  const scenarioSuites = scenarios.map((scenario) => validateScenario(scenario, signals));
  const allSuites = [inventorySuite, ...scenarioSuites];
  const failedSuites = allSuites.filter((suite) => !suite.pass);

  const result = {
    generated_at: startedAt,
    tool: 'run-local-validation.js',
    project: 'think-mcp',
    summary: {
      total_suites: allSuites.length,
      passed_suites: allSuites.length - failedSuites.length,
      failed_suites: failedSuites.length,
      pass: failedSuites.length === 0,
    },
    suites: allSuites,
  };

  ensureDir(resultsDir);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

  const status = result.summary.pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] think-mcp local validation`);
  console.log(`Result: ${path.relative(root, resultPath).replace(/\\/g, '/')}`);
  console.log(`Suites: ${result.summary.passed_suites}/${result.summary.total_suites} passed`);
  for (const suite of allSuites) {
    console.log(`- [${suite.pass ? 'PASS' : 'FAIL'}] ${suite.id}: ${suite.title}`);
  }

  process.exit(result.summary.pass ? 0 : 1);
}

main();
