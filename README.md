# DepScope

DepScope is an experimental GitHub Action and CLI that asks a narrow question about an npm dependency upgrade:

> Which supported declaration changes actually intersect APIs used by this TypeScript repository?

It is deliberately precision-first. Unsupported or ambiguous TypeScript patterns are left unanalyzed instead of being guessed.

## GitHub Action: PR auto-detection

For npm projects using `package-lock.json`, DepScope can infer direct dependency version changes from the pull request base/head. You do not need to specify the package name or versions.

```yaml
name: dependency-impact

on:
  pull_request:

permissions:
  contents: read

jobs:
  depscope:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: sayaa0/depscope@main
        with:
          fail_on_breaking: 'true'
```

During the current experimental phase, `@main` is used. A stable version tag should be used once the first release is published.

The Action:

1. reads `package.json` and `package-lock.json` at the PR base/head through the GitHub API;
2. identifies changed direct dependency versions;
3. compares supported public TypeScript declaration shapes between the old/new npm package versions;
4. scans the checked-out consumer repository for matching API usage;
5. reports only supported changes that intersect detected usage;
6. optionally fails the job when a supported breaking change is found.

Multiple direct dependency updates can be detected in one PR. Packages outside the current declaration-analysis scope are reported as unsupported rather than guessed.

## Monorepo / nested package

```yaml
- uses: sayaa0/depscope@main
  with:
    manifest_dir: apps/web
    project_dir: apps/web
    fail_on_breaking: 'true'
```

Auto-detection currently requires `package-lock.json` at both PR refs.

## Manual Action mode

You can still provide an explicit package/version pair:

```yaml
- uses: sayaa0/depscope@main
  with:
    package: zod
    from: 3.23.8
    to: 4.0.0
    project_dir: .
```

## Outputs

- `detected_update_count`
- `analyzed_update_count`
- `unsupported_update_count`
- `breaking_count`
- `compatible_count`
- `relevant_count`
- `filtered_count`
- `updates_json`

## CLI

```bash
npm install
node src/cli.js compare <package> <from> <to>
node src/cli.js impact <package> <from> <to> <project-dir>
```

Example:

```bash
node src/cli.js impact zod 3.23.8 4.0.0 .
```

Use `--json` for machine-readable output.

## Current supported scope

Declaration analysis currently covers a deliberately small set of high-confidence cases:

- package-level `types` / `typings` declaration entry;
- root `index.d.ts` fallback;
- named exports resolved by the TypeScript checker;
- one-level exported members such as `z.object`;
- exported symbol/member removal;
- single-call-signature arity changes;
- consumer named imports;
- one-level property access from imported namespace-like APIs.

Breaking classification currently treats these as breaking candidates:

- exported symbol removal;
- exported member removal;
- required parameter addition;
- accepted positional parameter removal when no rest parameter remains;
- rest parameter removal.

Call-domain relaxation, such as reducing the number of required parameters, is reported as compatible rather than breaking.

## Not analyzed yet

- `@types/*` split-package resolution;
- default-export semantics;
- overload-set compatibility;
- generic constraint compatibility;
- semantic parameter/return-type narrowing and widening;
- arbitrary-depth fluent API chains;
- runtime behavior changes;
- non-npm lockfile formats.

## Early validation

The repository includes real-consumer tests rather than fixture-only tests.

In one known Zod 3 → Zod 4 consumer, DepScope predicted 27 breaking API names in a specific source file. After forcing that repository onto Zod 4 and running `tsc --noEmit`, all 27 predicted leaf API names appeared in the compiler error log. This is one validation case, not a general precision claim.

A separate real consumer using `z.object()` produced one relevant declaration change, which DepScope classified as compatible and therefore reported zero supported breaking changes.

There is also an end-to-end pull-request integration fixture where no package/from/to inputs are supplied; DepScope infers `zod 3.23.8 → 4.0.0` from the PR and detects the expected breaking usage.

## Privacy / trust boundary

There is currently no DepScope application server. Consumer source scanning and package declaration comparison run inside the GitHub Actions runner. PR auto-detection reads only the repository's package metadata (`package.json` and `package-lock.json`) at the base/head refs using the workflow's GitHub token.

## Principle

Precision first. A missing warning is preferable to a confident warning that DepScope cannot justify from the supported declaration and usage model.
