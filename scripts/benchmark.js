import fs from 'node:fs/promises';
import { analyzePackageDeclarations, diffAnalyses } from '../src/analyze.js';
import { fetchPackageVersion } from '../src/fetch-package.js';

const cases = [
  ['zod', '3.22.4', '4.0.0'],
  ['chalk', '4.1.2', '5.0.0'],
  ['uuid', '8.3.2', '9.0.0'],
  ['commander', '9.5.0', '10.0.0'],
  ['axios', '0.27.2', '1.0.0'],
];

const rows = [];

for (const [pkg, from, to] of cases) {
  let oldPkg;
  let newPkg;
  try {
    [oldPkg, newPkg] = await Promise.all([
      fetchPackageVersion(pkg, from),
      fetchPackageVersion(pkg, to),
    ]);

    const before = analyzePackageDeclarations(oldPkg.packageDir);
    const after = analyzePackageDeclarations(newPkg.packageDir);
    const result = diffAnalyses(before, after);

    const removed = result.changes.filter(c => c.type === 'removed-symbol').length;
    const arity = result.changes.filter(c => c.type === 'function-arity-change').length;

    rows.push({
      package: pkg,
      from,
      to,
      status: 'ok',
      oldSymbols: before.symbols.size,
      newSymbols: after.symbols.size,
      removed,
      arity,
      changes: result.changes.length,
      notAnalyzed: result.notAnalyzed.length,
    });
  } catch (error) {
    rows.push({
      package: pkg,
      from,
      to,
      status: 'error',
      error: String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 220),
    });
  } finally {
    await Promise.allSettled([oldPkg?.cleanup?.(), newPkg?.cleanup?.()]);
  }
}

console.log(JSON.stringify(rows, null, 2));

const header = [
  '# DepScope real-package benchmark',
  '',
  '| package | upgrade | status | old exports | new exports | removed | arity changes | not analyzed |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
];

const table = rows.map(r => {
  if (r.status === 'error') {
    return `| ${r.package} | ${r.from} → ${r.to} | error | - | - | - | - | - |`;
  }
  return `| ${r.package} | ${r.from} → ${r.to} | ok | ${r.oldSymbols} | ${r.newSymbols} | ${r.removed} | ${r.arity} | ${r.notAnalyzed} |`;
});

const errors = rows
  .filter(r => r.status === 'error')
  .map(r => `- **${r.package} ${r.from} → ${r.to}:** ${r.error}`);

const markdown = [...header, ...table, '', ...(errors.length ? ['## Errors', '', ...errors] : [])].join('\n') + '\n';

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}

await fs.writeFile('benchmark.json', JSON.stringify(rows, null, 2) + '\n');

if (!rows.some(r => r.status === 'ok')) {
  throw new Error('No benchmark package could be analyzed.');
}
