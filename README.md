# DepScope

Experimental GitHub Action and CLI for finding TypeScript dependency changes that actually intersect APIs used by a consumer repository.

DepScope is intentionally conservative. It currently analyzes a narrow set of declaration changes with high confidence instead of attempting full TypeScript compatibility analysis.

## What it does

For two npm package versions, DepScope:

1. extracts supported public declaration changes from the old and new package,
2. scans a TypeScript consumer repository for package API usage,
3. filters out package changes unrelated to detected usage,
4. classifies supported changes as breaking or compatible,
5. reports the affected files.

Current supported high-confidence checks include:

- named exported symbol removal
- one-level exported member removal
- single-signature callable arity changes
- required-parameter additions
- accepted-parameter removals
- rest-parameter removal

Unsupported or ambiguous cases are left unanalyzed rather than guessed.

## GitHub Action

Current experimental usage:

```yaml
- uses: sayaa0/depscope@main
  id: depscope
  with:
    package: zod
    from: 3.23.8
    to: 4.0.0
    project_dir: .
    fail_on_breaking: 'false'
```

The Action writes a dependency-impact report to the GitHub Actions Step Summary and exposes:

- `breaking_count`
- `compatible_count`
- `relevant_count`
- `filtered_count`

Set `fail_on_breaking: 'true'` if supported breaking changes should fail the workflow.

The current Action still requires explicit package/from/to versions. Automatic extraction from dependency-update PRs is not implemented yet.

## CLI

```bash
npm install
node src/cli.js compare <package> <from> <to>
node src/cli.js impact <package> <from> <to> [projectDir]
```

Examples:

```bash
node src/cli.js compare zod 3.22.4 4.0.0
node src/cli.js impact zod 3.23.8 4.0.0 ./my-project
```

JSON output:

```bash
node src/cli.js impact zod 3.23.8 4.0.0 ./my-project --json
```

## Current validation

The repository includes CI checks against real npm packages and real public TypeScript consumers.

One known-breaking Zod 3 consumer is forcibly upgraded to Zod 4 in CI and compared against `tsc --noEmit`. In the current fixture, all 27 DepScope leaf-level breaking predictions appear in the TypeScript compiler error log for the predicted file.

This is an early proof-of-concept result, not a general precision claim.

## MVP scope

Supported declaration entry points:

- package-level `types` / `typings`
- root `index.d.ts` fallback

Not analyzed yet:

- `@types/*` split packages
- default export semantics
- overload-set compatibility
- generic constraint compatibility
- semantic type narrowing/widening
- deep chained API usage
- runtime behavior changes
- automatic package/version extraction from Dependabot or Renovate PRs

## Principle

Precision first. If DepScope cannot justify a result from declarations and detected consumer usage, it should remain silent rather than invent risk.
