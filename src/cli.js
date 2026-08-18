#!/usr/bin/env node
import { analyzePackageDeclarations, diffAnalyses } from './analyze.js';
import { fetchPackageVersion } from './fetch-package.js';
import { filterChangesByUsage, scanProjectUsage } from './usage.js';

function usage() {
  console.log(`ts-upgrade-impact 0.1.0\n\nUsage:\n  ts-upgrade-impact compare <package> <from> <to> [--json]\n  ts-upgrade-impact impact <package> <from> <to> [projectDir] [--json]\n\nExamples:\n  ts-upgrade-impact compare zod 3.22.4 4.0.0\n  ts-upgrade-impact impact zod 3.22.4 4.0.0 .\n`);
}

function formatSignature(shape) {
  return `${shape.requiredParams} required / ${shape.totalParams} total${shape.hasRest ? ' / rest' : ''}`;
}

function formatChange(change, files = null) {
  const label = change.compatibility === 'breaking' ? 'BREAKING' : 'COMPATIBLE';
  const location = files?.length ? `; used in ${files.join(', ')}` : '';

  if (change.type === 'removed-symbol' || change.type === 'removed-member') {
    return `  [${label}] ${change.symbol}: removed${location}`;
  }

  if (change.before && change.after) {
    return (
      `  [${label}] ${change.symbol}: ${formatSignature(change.before)} -> ` +
      `${formatSignature(change.after)}${location}`
    );
  }

  return `  [${label}] ${change.symbol}: ${change.type}${location}`;
}

function formatHuman(pkg, from, to, result) {
  console.log(`TS Upgrade Impact: ${pkg} ${from} -> ${to}`);
  console.log(`Breaking supported changes: ${result.breakingChanges.length}`);
  console.log(`Compatible supported changes: ${result.compatibleChanges.length}`);
  console.log('');

  if (result.changes.length === 0) {
    console.log('No supported API-shape changes detected.');
  } else {
    for (const change of result.changes) {
      console.log(formatChange(change));
    }
  }

  if (result.notAnalyzed.length) {
    console.log('');
    console.log(`Not analyzed: ${result.notAnalyzed.length} symbol(s)`);
  }
}

function formatImpact(pkg, from, to, impact) {
  console.log(`TS Upgrade Impact: ${pkg} ${from} -> ${to}`);
  console.log(`Detected package API paths: ${impact.importedSymbols.length}`);
  console.log(`Relevant supported changes: ${impact.affectedChanges.length}`);
  console.log(`Relevant breaking changes: ${impact.breakingChanges.length}`);
  console.log(`Relevant compatible changes: ${impact.compatibleChanges.length}`);
  console.log('');

  if (!impact.affectedChanges.length) {
    console.log('No supported package changes intersect detected API paths.');
  } else {
    for (const change of impact.affectedChanges) {
      console.log(formatChange(change, change.files));
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
  console.error(`ts-upgrade-impact: ${error.message}`);
  process.exitCode = 1;
});
