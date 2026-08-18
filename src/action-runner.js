#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyzePackageDeclarations, diffAnalyses } from './analyze.js';
import { detectPullRequestUpdates } from './detect-updates.js';
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

async function analyzeUpdate(update, projectDir) {
  let oldPkg;
  let newPkg;

  try {
    [oldPkg, newPkg] = await Promise.all([
      fetchPackageVersion(update.package, update.from),
      fetchPackageVersion(update.package, update.to),
    ]);

    const before = analyzePackageDeclarations(oldPkg.packageDir);
    const after = analyzePackageDeclarations(newPkg.packageDir);
    const diff = diffAnalyses(before, after);
    const usage = scanProjectUsage(projectDir, update.package);
    const impact = filterChangesByUsage(diff, usage);

    return { ...update, impact };
  } finally {
    await Promise.allSettled([oldPkg?.cleanup?.(), newPkg?.cleanup?.()]);
  }
}

function appendResult(lines, result) {
  const { package: pkg, from, to, impact } = result;
  lines.push(
    `## \`${pkg}\` \`${from}\` → \`${to}\``,
    '',
    `- Detected package API paths: ${impact.importedSymbols.length}`,
    `- Relevant supported changes: ${impact.affectedChanges.length}`,
    `- **Breaking changes: ${impact.breakingChanges.length}**`,
    `- Compatible changes: ${impact.compatibleChanges.length}`,
    `- Filtered unrelated package changes: ${impact.unrelatedChanges.length}`,
    `- Unsupported usage patterns: ${impact.unsupportedUsage.length}`,
    ''
  );

  if (impact.breakingChanges.length) {
    lines.push('### Breaking changes', '');
    for (const change of impact.breakingChanges) lines.push(...formatChange(change));
    lines.push('');
  }

  if (impact.compatibleChanges.length) {
    lines.push('### Relevant compatible changes', '');
    for (const change of impact.compatibleChanges) lines.push(...formatChange(change));
    lines.push('');
  }
}

async function main() {
  const pkg = getInput('package');
  const from = getInput('from');
  const to = getInput('to');
  const projectDir = path.resolve(getInput('project_dir', '.'));
  const manifestDir = getInput('manifest_dir', '.');
  const failOnBreaking = getInput('fail_on_breaking', 'false').toLowerCase() === 'true';

  const manualCount = [pkg, from, to].filter(Boolean).length;
  if (manualCount !== 0 && manualCount !== 3) {
    throw new Error('Provide package, from, and to together, or omit all three for PR auto-detection.');
  }

  const mode = manualCount === 3 ? 'manual' : 'pull-request auto-detection';
  const updates = manualCount === 3
    ? [{ package: pkg, from, to }]
    : await detectPullRequestUpdates({ manifestDir });

  const results = [];
  const unsupported = [];

  for (const update of updates) {
    try {
      results.push(await analyzeUpdate(update, projectDir));
    } catch (error) {
      if (manualCount === 3) throw error;
      unsupported.push({ ...update, error: error.message });
    }
  }

  const breakingCount = results.reduce((sum, result) => sum + result.impact.breakingChanges.length, 0);
  const compatibleCount = results.reduce((sum, result) => sum + result.impact.compatibleChanges.length, 0);
  const relevantCount = results.reduce((sum, result) => sum + result.impact.affectedChanges.length, 0);
  const filteredCount = results.reduce((sum, result) => sum + result.impact.unrelatedChanges.length, 0);

  writeOutput('detected_update_count', updates.length);
  writeOutput('analyzed_update_count', results.length);
  writeOutput('unsupported_update_count', unsupported.length);
  writeOutput('breaking_count', breakingCount);
  writeOutput('compatible_count', compatibleCount);
  writeOutput('relevant_count', relevantCount);
  writeOutput('filtered_count', filteredCount);
  writeOutput('updates_json', JSON.stringify(updates));

  const lines = [
    '# DepScope dependency impact',
    '',
    `Mode: **${mode}**`,
    '',
    `- Dependency updates detected: ${updates.length}`,
    `- Updates analyzed: ${results.length}`,
    `- Unsupported updates: ${unsupported.length}`,
    `- **Breaking changes: ${breakingCount}**`,
    `- Compatible relevant changes: ${compatibleCount}`,
    '',
  ];

  if (updates.length === 0) {
    lines.push('> No direct npm dependency version change was detected in this pull request.', '');
  }

  for (const result of results) appendResult(lines, result);

  if (unsupported.length) {
    lines.push('## Updates not analyzed', '');
    for (const item of unsupported) {
      lines.push(`- \`${item.package}\` \`${item.from}\` → \`${item.to}\`: ${escapeMarkdown(item.error)}`);
    }
    lines.push('');
  }

  if (updates.length) {
    lines.push(
      breakingCount
        ? '> DepScope found supported breaking declaration changes intersecting API paths used by this repository.'
        : '> DepScope found no supported breaking declaration change intersecting detected API paths.',
      ''
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  } else {
    console.log(lines.join('\n'));
  }

  if (failOnBreaking && breakingCount > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`depscope action: ${error.message}`);
  process.exitCode = 1;
});
