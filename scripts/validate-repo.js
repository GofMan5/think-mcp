#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function addCheck(id, description, pass, evidence) {
  checks.push({ id, description, pass, evidence });
}

function main() {
  const pkg = readJson('package.json');
  const indexTs = readText('src/index.ts');
  const readme = readText('README.md');
  const publish = readText('.github/workflows/publish.yml');

  // 1) Required scripts exist.
  const requiredScripts = [
    'typecheck',
    'test',
    'build',
    'eval:local',
    'validate:repo',
    'security:audit',
    'validate:release',
  ];
  const missingScripts = requiredScripts.filter((s) => !pkg.scripts?.[s]);
  addCheck(
    'required-scripts',
    'Required validation scripts exist in package.json',
    missingScripts.length === 0,
    missingScripts.length === 0 ? 'all scripts present' : `missing: ${missingScripts.join(', ')}`
  );

  // 2) Tool registration completeness.
  const requiredTools = ['think', 'think_batch', 'think_done', 'think_recall', 'think_reset', 'think_logic'];
  const registeredTools = [...indexTs.matchAll(/registerTool\('([^']+)'/g)].map((m) => m[1]);
  const missingTools = requiredTools.filter((tool) => !registeredTools.includes(tool));
  addCheck(
    'tool-registration',
    'All required MCP tools are registered in src/index.ts',
    missingTools.length === 0,
    missingTools.length === 0 ? `registered: ${registeredTools.join(', ')}` : `missing: ${missingTools.join(', ')}`
  );

  // 3) README tool docs are present.
  const readmeMissingTools = requiredTools.filter((tool) => !readme.includes(`\`${tool}\``));
  addCheck(
    'readme-tools',
    'README documents all required tool names',
    readmeMissingTools.length === 0,
    readmeMissingTools.length === 0 ? 'all tool names found in README' : `missing in README: ${readmeMissingTools.join(', ')}`
  );

  // 4) Eval scenario inventory strictness.
  const evalDir = path.join(root, 'tests/evals/think-mcp');
  const requiredScenarioIds = [
    'state-integrity',
    'sequence-safety-gates',
    'session-persistence',
    'runtime-storage-consistency',
    'insights-consistency',
    'schema-readme-consistency',
    'quality-speed-optimization',
    'security-baseline',
  ];
  const scenarioFiles = fs
    .readdirSync(evalDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(evalDir, f));
  const scenarioIds = scenarioFiles.map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')).id).filter(Boolean);
  const scenarioSet = new Set(scenarioIds);
  const missingScenarioIds = requiredScenarioIds.filter((id) => !scenarioSet.has(id));
  const unexpectedScenarioIds = scenarioIds.filter((id) => !requiredScenarioIds.includes(id));
  const duplicateScenarioIds = scenarioIds.filter((id, idx) => scenarioIds.indexOf(id) !== idx);
  addCheck(
    'eval-scenario-inventory',
    'Eval scenarios match required set exactly once each',
    missingScenarioIds.length === 0 && unexpectedScenarioIds.length === 0 && duplicateScenarioIds.length === 0,
    [
      missingScenarioIds.length > 0 ? `missing: ${missingScenarioIds.join(', ')}` : '',
      unexpectedScenarioIds.length > 0 ? `unexpected: ${unexpectedScenarioIds.join(', ')}` : '',
      duplicateScenarioIds.length > 0 ? `duplicate: ${[...new Set(duplicateScenarioIds)].join(', ')}` : '',
    ].filter(Boolean).join(' | ') || 'inventory valid'
  );

  // 5) Publish workflow gates.
  const hasTagTrigger = /tags:\s*\n\s*-\s*'v\*'/.test(publish);
  const hasTypecheck = publish.includes('npm run typecheck');
  const hasTest = publish.includes('npm test');
  const hasBuild = publish.includes('npm run build');
  const hasEval = publish.includes('npm run eval:local');
  const hasAudit = publish.includes('npm run security:audit');
  addCheck(
    'publish-gates',
    'Publish workflow is tag-based and runs validation gates',
    hasTagTrigger && hasTypecheck && hasTest && hasBuild && hasEval && hasAudit,
    `tagTrigger=${hasTagTrigger}, typecheck=${hasTypecheck}, test=${hasTest}, build=${hasBuild}, eval=${hasEval}, audit=${hasAudit}`
  );

  // 6) Legacy command references removed from runtime.
  const runtimeText = [
    readText('src/index.ts'),
    readText('src/services/coaching.service.ts'),
    readText('src/services/consolidate.service.ts'),
    readText('src/services/stagnation.service.ts'),
    readText('src/services/thinking.service.ts'),
  ].join('\n');
  const hasLegacy = /extend_thought|sequentialthinking/.test(runtimeText);
  addCheck(
    'legacy-runtime-strings',
    'Legacy runtime command names are removed',
    !hasLegacy,
    hasLegacy ? 'found legacy runtime references' : 'no legacy runtime references'
  );

  // 7) Runtime storage docs/override contract.
  const storagePathsText = readText('src/utils/storage-paths.ts');
  const hasStorageEnv = storagePathsText.includes('THINK_MCP_DATA_DIR');
  const readmeMentionsStorageEnv = readme.includes('THINK_MCP_DATA_DIR');
  addCheck(
    'runtime-storage-contract',
    'Runtime storage env override exists in code and README',
    hasStorageEnv && readmeMentionsStorageEnv,
    `codeEnv=${hasStorageEnv}, readmeEnv=${readmeMentionsStorageEnv}`
  );

  // 8) Insights FIFO/pattern consistency guard.
  const insightsText = readText('src/services/insights.service.ts');
  const hasEvictionDecrement =
    /const evicted = this\.data!\.winningPaths\.shift\(\);[\s\S]*this\.decrementPatternCounts\(evicted\.keywords\)/.test(insightsText);
  const hasPatternRebuildOnLoad = /patterns:\s*this\.buildPatternCounts\(winningPaths\)/.test(insightsText);
  addCheck(
    'insights-fifo-consistency',
    'Insights FIFO eviction and load normalization keep pattern map consistent',
    hasEvictionDecrement && hasPatternRebuildOnLoad,
    `evictionDecrement=${hasEvictionDecrement}, rebuildOnLoad=${hasPatternRebuildOnLoad}`
  );

  const failed = checks.filter((c) => !c.pass);
  const status = failed.length === 0 ? 'PASS' : 'FAIL';

  console.log(`[${status}] Repository validation`);
  for (const check of checks) {
    const s = check.pass ? 'PASS' : 'FAIL';
    console.log(`- [${s}] ${check.id}: ${check.description}`);
    console.log(`  evidence: ${check.evidence}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main();
