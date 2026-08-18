import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzePackageDeclarations, diffAnalyses } from '../src/analyze.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('detects named export removal and function parameter change', () => {
  const oldAnalysis = analyzePackageDeclarations(path.join(here, 'fixtures', 'old'));
  const newAnalysis = analyzePackageDeclarations(path.join(here, 'fixtures', 'new'));
  const result = diffAnalyses(oldAnalysis, newAnalysis);

  assert.deepEqual(
    result.changes.map(x => x.type).sort(),
    ['function-arity-change', 'removed-symbol']
  );

  const parse = result.changes.find(x => x.symbol === 'parse');
  assert.equal(parse.before.requiredParams, 1);
  assert.equal(parse.after.requiredParams, 2);

  const removed = result.changes.find(x => x.symbol === 'removed');
  assert.equal(removed.confidence, 1);
});
