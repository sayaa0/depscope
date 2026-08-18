import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzePackageDeclarations, diffAnalyses } from '../src/analyze.js';
import { filterChangesByUsage, scanProjectUsage } from '../src/usage.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('filters package changes to symbols actually used by the project', () => {
  const oldAnalysis = analyzePackageDeclarations(path.join(here, 'fixtures', 'old'));
  const newAnalysis = analyzePackageDeclarations(path.join(here, 'fixtures', 'new'));
  const diff = diffAnalyses(oldAnalysis, newAnalysis);

  const usage = scanProjectUsage(path.join(here, 'fixtures', 'project'), 'fixture-package');
  const impact = filterChangesByUsage(diff, usage);

  assert.deepEqual(impact.importedSymbols, ['parse', 'removed', 'stable']);
  assert.deepEqual(
    impact.affectedChanges.map(change => change.symbol).sort(),
    ['parse', 'removed']
  );
  assert.equal(impact.unrelatedChanges.length, 0);
  assert.ok(impact.affectedChanges.every(change => change.files.includes('index.ts')));
});
