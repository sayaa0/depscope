#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyzePackageDeclarations, diffAnalyses } from './analyze.js';
import { fetchPackageVersion } from './fetch-package.js';
import { filterChangesByUsage, scanProjectUsage } from './usage.js';

function getInput(name, fallback = '') {
  const value = process.env[`DEPSCOPE_${name.toUpperCase()}`];
  return value === undefined || value === '' ? fallback : value;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function escapeMarkdown(text) {
  return String(text).replace(/([\\`*_{}\[\]()#+.!|-])/g, '\\$1');
}

function formatChange(change) {
  const files = (change.files || []).map(file => `\`${file}\``).join(', ') || '-';
  const label = change.compatibility === 'breaking' ? 'BREAKING' : 'COMPATIBLE';
  const lines = [`- **${label}** \`${change.symbol}\` — \`${change.type}\` — files: ${files}`];

  if (change.before || change.after) {
    const before = change.before
      ? `${change.before.requiredParams} required / ${change.before.totalParams} total${change.before.hasRest ? ' / rest' : ''}`
      : '-';
    const after = change.after
      ? `${change.after.requiredParams} required / ${change.after.totalParams} total${change.after.hasRest ? ' / rest' : ''}`
      : '-';
    lines.push(`  - signature: ${before} → ${after}`);
  }

  if (change.reasons?.length) {
    lines.push(`  - reason: ${change.reasons.map(escapeMarkdown).join(', ')}`);
  }

  return lines;
}

async function main() {
  const pkg = getInput('package');
  const from = getInput('from');
  const to = getInput('to');
  const projectDir = path.resolve(getInput('project_dir', '.'));
  const failOnBreaking = getInput('fail_on_breaking', 'false').toLowerCase() === 'true';

  if (!pkg || !from || !to) {
    throw new Error('package, from, and to inputs are required');
  }

  let oldPkg;
  let newPkg;

  try {
    [oldPkg, newPkg] = await Promise.all([
      fetchPackageVersion(pkg, from),
      fetchPackageVersion(pkg, to),
    ]);

    const before = analyzePackageDeclarations(oldPkg.packageDir);
    const after = analyzePackageDeclarations(newPkg.packageDir);
    const diff = diffAnalyses(before, after);
    const usage = scanProjectUsage(projectDir, pkg);
    const impact = filterChangesByUsage(diff, usage);

    writeOutput('breaking_count', impact.breakingChanges.length);
    writeOutput('compatible_count', impact.compatibleChanges.length);
    writeOutput('relevant_count', impact.affectedChanges.length);
    writeOutput('filtered_count', impact.unrelatedChanges.length);

    const lines = [
      '# DepScope dependency impact',
      '',
      `Package: \`${pkg}\` \`${from}\` → \`${to}\``,
      '',
      `- Detected package API paths: ${impact.importedSymbols.length}`,
      `- Relevant supported changes: ${impact.affectedChanges.length}`,
      `- **Breaking changes: ${impact.breakingChanges.length}**`,
      `- Compatible changes: ${impact.compatibleChanges.length}`,
      `- Filtered unrelated package changes: ${impact.unrelatedChanges.length}`,
      `- Unsupported usage patterns: ${impact.unsupportedUsage.length}`,
      '',
    ];

    if (impact.breakingChanges.length) {
      lines.push('## Breaking changes', '');
      for (const change of impact.breakingChanges) lines.push(...formatChange(change));
      lines.push('');
    }

    if (impact.compatibleChanges.length) {
      lines.push('## Relevant compatible changes', '');
      for (const change of impact.compatibleChanges) lines.push(...formatChange(change));
      lines.push('');
    }

    lines.push(
      impact.breakingChanges.length
        ? '> DepScope found supported breaking declaration changes that intersect API paths used by this repository.'
        : '> DepScope found no supported breaking declaration change intersecting detected API paths.',
      ''
    );

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
    } else {
      console.log(lines.join('\n'));
    }

    if (failOnBreaking && impact.breakingChanges.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([oldPkg?.cleanup?.(), newPkg?.cleanup?.()]);
  }
}

main().catch(error => {
  console.error(`depscope action: ${error.message}`);
  process.exitCode = 1;
});
