#!/usr/bin/env node
import { analyzePackageDeclarations, diffAnalyses } from './analyze.js';
import { fetchPackageVersion } from './fetch-package.js';
import { filterChangesByUsage, scanProjectUsage } from './usage.js';

function usage() {
  console.log(`depscope 0.0.1\n\nUsage:\n  depscope compare <package> <from> <to> [--json]\n  depscope impact <package> <from> <to> [projectDir] [--json]\n\nExamples:\n  depscope compare zod 3.22.4 4.0.0\n  depscope impact zod 3.22.4 4.0.0 .\n`);
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

function formatImpact(pkg, from, to, impact) {
  console.log(`DepScope impact: ${pkg} ${from} -> ${to}`);
  console.log(`Imported named symbols: ${impact.importedSymbols.length}`);
  console.log(`Relevant supported changes: ${impact.affectedChanges.length}`);
  console.log('');

  if (!impact.affectedChanges.length) {
    console.log('No supported package changes intersect detected named imports.');
  } else {
    for (const change of impact.affectedChanges) {
      const files = change.files.join(', ');
      if (change.type === 'removed-symbol') {
        console.log(`  [CONFIRMED] ${change.symbol}: removed; used in ${files}`);
      } else if (change.type === 'function-arity-change') {
        console.log(`  [REVIEW] ${change.symbol}: call signature arity changed; used in ${files}`);
      }
    }
  }

  console.log('');
  console.log(`Filtered out unrelated package changes: ${impact.unrelatedChanges.length}`);
  if (impact.unsupportedUsage.length) {
    console.log(`Unsupported usage patterns: ${impact.unsupportedUsage.length}`);
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
  if (!['compare', 'impact'].includes(command) || !pkg || !from || !to) {
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

    if (command === 'compare') {
      if (json) {
        console.log(JSON.stringify({ package: pkg, from, to, ...result }, null, 2));
      } else {
        formatHuman(pkg, from, to, result);
      }
      return;
    }

    const projectDir = args[4] && !args[4].startsWith('--') ? args[4] : '.';
    const projectUsage = scanProjectUsage(projectDir, pkg);
    const impact = filterChangesByUsage(result, projectUsage);

    if (json) {
      console.log(JSON.stringify({ package: pkg, from, to, projectDir, ...impact }, null, 2));
    } else {
      formatImpact(pkg, from, to, impact);
    }
  } finally {
    await Promise.allSettled([oldPkg?.cleanup?.(), newPkg?.cleanup?.()]);
  }
}

main().catch(error => {
  console.error(`depscope: ${error.message}`);
  process.exitCode = 1;
});
