import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  analyzePackageDeclarations,
  classifyCallableCompatibility,
  diffAnalyses,
} from '../src/analyze.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('detects named export removal and breaking function parameter change', () => {
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
  assert.equal(parse.compatibility, 'breaking');
  assert.ok(parse.reasons.includes('required-parameter-added'));

  const removed = result.changes.find(x => x.symbol === 'removed');
  assert.equal(removed.confidence, 1);
  assert.equal(removed.compatibility, 'breaking');

  assert.equal(result.breakingChanges.length, 2);
  assert.equal(result.compatibleChanges.length, 0);
});

test('classifies relaxed call arity as compatible', () => {
  const before = { requiredParams: 1, totalParams: 2, hasRest: false };
  const after = { requiredParams: 0, totalParams: 2, hasRest: false };

  assert.deepEqual(classifyCallableCompatibility(before, after), {
    compatibility: 'compatible',
    reasons: ['call-domain-not-narrowed'],
  });
});

test('classifies parameter removal and rest removal as breaking', () => {
  assert.equal(
    classifyCallableCompatibility(
      { requiredParams: 1, totalParams: 3, hasRest: false },
      { requiredParams: 1, totalParams: 2, hasRest: false }
    ).compatibility,
    'breaking'
  );

  assert.equal(
    classifyCallableCompatibility(
      { requiredParams: 1, totalParams: 1, hasRest: true },
      { requiredParams: 1, totalParams: 1, hasRest: false }
    ).compatibility,
    'breaking'
  );
});
