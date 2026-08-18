#!/usr/bin/env node
import { analyzePackageDeclarations, diffAnalyses } from './analyze.js';
import { fetchPackageVersion } from './fetch-package.js';

function usage() {
  console.log(`depscope 0.0.1\n\nUsage:\n  depscope compare <package> <from> <to> [--json]\n\nExample:\n  depscope compare zod 3.22.4 4.0.0\n`);
}

function formatHuman(pkg, from, to, result) {
  console.log(`DepScope: ${pkg} ${from} -> ${to}`);
  console.log('');

  if (result.changes.length === 0) {
    console.log('No supported breaking API changes detected.');
  } else {
    console.log('Confirmed / high-confidence changes:');
    for (const change of result.changes) {
      if (change.type === 'removed-symbol') {
        console.log(`  [CONFIRMED] ${change.symbol}: exported symbol removed`);
      } else if (change.type === 'function-arity-change') {
        const b = change.before;
        const a = change.after;
        console.log(
          `  [REVIEW] ${change.symbol}: params required ${b.requiredParams}->${a.requiredParams}, ` +
          `total ${b.totalParams}->${a.totalParams}${b.hasRest !== a.hasRest ? ', rest changed' : ''}`
        );
      }
    }
  }

  if (result.notAnalyzed.length) {
    console.log('');
    console.log(`Not analyzed: ${result.notAnalyzed.length} symbol(s)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const [command, pkg, from, to] = args;
  const json = args.includes('--json');
  if (command !== 'compare' || !pkg || !from || !to) {
    usage();
    process.exitCode = 2;
    return;
  }

  let oldPkg;
  let newPkg;
  try {
    [oldPkg, newPkg] = await Promise.all([
      fetchPackageVersion(pkg, from),
      fetchPackageVersion(pkg, to),
    ]);

    const oldAnalysis = analyzePackageDeclarations(oldPkg.packageDir);
    const newAnalysis = analyzePackageDeclarations(newPkg.packageDir);
    const result = diffAnalyses(oldAnalysis, newAnalysis);

    if (json) {
      console.log(JSON.stringify({ package: pkg, from, to, ...result }, null, 2));
    } else {
      formatHuman(pkg, from, to, result);
    }
  } finally {
    await Promise.allSettled([oldPkg?.cleanup?.(), newPkg?.cleanup?.()]);
  }
}

main().catch(error => {
  console.error(`depscope: ${error.message}`);
  process.exitCode = 1;
});
