#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [];

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function addCheck(id, description, pass, evidence) {
  checks.push({ id, description, pass, evidence });
}

function main() {
  const pkg = JSON.parse(readText('package.json'));
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

  // 2) Publish workflow validation commands.
  const hasTypecheck = publish.includes('npm run typecheck');
  const hasTest = publish.includes('npm test');
  const hasBuild = publish.includes('npm run build');
  addCheck(
    'publish-validation-commands',
    'Publish workflow runs typecheck, tests, and build',
    hasTypecheck && hasTest && hasBuild,
    `typecheck=${hasTypecheck}, test=${hasTest}, build=${hasBuild}`
  );

  // 3) Legacy command references removed from runtime.
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

  // 4) Runtime storage docs/override contract.
  const storagePathsText = readText('src/utils/storage-paths.ts');
  const hasStorageEnv = storagePathsText.includes('THINK_MCP_DATA_DIR');
  const readmeMentionsStorageEnv = readme.includes('THINK_MCP_DATA_DIR');
  addCheck(
    'runtime-storage-contract',
    'Runtime storage env override exists in code and README',
    hasStorageEnv && readmeMentionsStorageEnv,
    `codeEnv=${hasStorageEnv}, readmeEnv=${readmeMentionsStorageEnv}`
  );

  // 5) Insights FIFO/pattern consistency guard.
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
