import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function findDeclarationEntry(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${packageDir}`);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const declared = pkg.types || pkg.typings;
  const candidates = [
    declared && path.resolve(packageDir, declared),
    path.join(packageDir, 'index.d.ts'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  throw new Error(
    `No supported declaration entry found for ${pkg.name ?? packageDir}. ` +
    'MVP supports package.json "types"/"typings" or root index.d.ts.'
  );
}

function signatureShape(checker, symbol, declaration) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signatures = type.getCallSignatures();

  if (signatures.length !== 1) return null;

  const signature = signatures[0];
  const params = signature.getParameters();
  let required = 0;
  let hasRest = false;

  for (const param of params) {
    const decl = param.valueDeclaration ?? param.declarations?.[0];
    if (!decl || !ts.isParameter(decl)) return null;

    if (decl.dotDotDotToken) hasRest = true;
    const optional = Boolean(decl.questionToken || decl.initializer || decl.dotDotDotToken);
    if (!optional) required += 1;
  }

  return {
    requiredParams: required,
    totalParams: params.length,
    hasRest,
  };
}

export function analyzePackageDeclarations(packageDir) {
  const entry = findDeclarationEntry(packageDir);
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    allowJs: false,
  };

  const program = ts.createProgram([entry], options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`Could not load declaration entry ${entry}`);

  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`Could not resolve module symbol for ${entry}`);

  const exports = checker.getExportsOfModule(moduleSymbol);
  const symbols = new Map();

  for (const exported of exports) {
    const name = exported.getName();
    if (name === 'default' || name === 'export=') continue;

    let target = exported;
    if (exported.flags & ts.SymbolFlags.Alias) {
      try {
        target = checker.getAliasedSymbol(exported);
      } catch {
        target = exported;
      }
    }

    const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? exported.declarations?.[0];
    if (!declaration) continue;

    const callable = signatureShape(checker, target, declaration);
    symbols.set(name, {
      name,
      kind: callable ? 'function' : 'symbol',
      callable,
    });
  }

  return { entry, symbols };
}

export function diffAnalyses(oldAnalysis, newAnalysis) {
  const changes = [];
  const notAnalyzed = [];

  for (const [name, before] of oldAnalysis.symbols) {
    const after = newAnalysis.symbols.get(name);
    if (!after) {
      changes.push({ type: 'removed-symbol', confidence: 1, symbol: name });
      continue;
    }

    if (before.kind === 'function' && after.kind === 'function') {
      if (!before.callable || !after.callable) {
        notAnalyzed.push({ symbol: name, reason: 'unsupported-call-signature' });
        continue;
      }

      const b = before.callable;
      const a = after.callable;
      if (
        b.requiredParams !== a.requiredParams ||
        b.totalParams !== a.totalParams ||
        b.hasRest !== a.hasRest
      ) {
        changes.push({
          type: 'function-arity-change',
          confidence: 0.99,
          symbol: name,
          before: b,
          after: a,
        });
      }
    }
  }

  return { changes, notAnalyzed };
}
