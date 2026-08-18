# DepScope

Experimental CLI for comparing the public TypeScript declarations of two npm package versions.

The MVP deliberately supports a narrow set of high-confidence checks:

- named exported symbol removal
- single-signature exported callable parameter-count changes

It deliberately does **not** claim full TypeScript compatibility analysis. Unsupported or ambiguous cases are left unanalyzed instead of being guessed.

## Run

```bash
npm install
node src/cli.js compare <package> <from> <to>
```

Example:

```bash
node src/cli.js compare zod 3.22.4 4.0.0
```

JSON output:

```bash
node src/cli.js compare zod 3.22.4 4.0.0 --json
```

## MVP scope

Supported:

- package-level `types` / `typings` declaration entry
- root `index.d.ts` fallback
- named exports resolved by the TypeScript checker
- symbol disappearance
- parameter arity changes for a single call signature

Not analyzed yet:

- `@types/*` split packages
- default export semantics
- overload-set compatibility
- generic constraint compatibility
- semantic type narrowing/widening
- runtime behavior
- consumer-repository usage mapping

## Principle

Precision first. If DepScope cannot justify a result from declarations, it should say nothing rather than invent risk.
