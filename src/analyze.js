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

function resolveAlias(checker, symbol) {
  if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

function getDeclaration(symbol, fallback) {
  return symbol.valueDeclaration ?? symbol.declarations?.[0] ?? fallback?.declarations?.[0] ?? null;
}

function callableShape(checker, symbol, declaration) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signatures = type.getCallSignatures();

  if (signatures.length === 0) {
    return { kind: 'symbol', callable: null, overloads: 0 };
  }

  if (signatures.length !== 1) {
    return { kind: 'function', callable: null, overloads: signatures.length };
  }

  const signature = signatures[0];
  const params = signature.getParameters();
  let required = 0;
  let hasRest = false;

  for (const param of params) {
    const decl = param.valueDeclaration ?? param.declarations?.[0];
    if (!decl || !ts.isParameter(decl)) {
      return { kind: 'function', callable: null, overloads: 1 };
    }

    if (decl.dotDotDotToken) hasRest = true;
    const optional = Boolean(decl.questionToken || decl.initializer || decl.dotDotDotToken);
    if (!optional) required += 1;
  }

  return {
    kind: 'function',
    callable: {
      requiredParams: required,
      totalParams: params.length,
      hasRest,
    },
    overloads: 1,
  };
}

function getOneLevelMembers(checker, symbol, declaration) {
  let candidates = [];

  if (symbol.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)) {
    try {
      candidates = checker.getExportsOfModule(symbol);
    } catch {
      candidates = [];
    }
  } else if (symbol.flags & ts.SymbolFlags.Value) {
    try {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      candidates = type.getProperties();
    } catch {
      candidates = [];
    }
  }

  const members = new Map();
  for (const candidate of candidates) {
    const memberName = candidate.getName();
    if (memberName === 'default' || memberName === 'export=') continue;

    const target = resolveAlias(checker, candidate);
    const memberDeclaration = getDeclaration(target, candidate);
    if (!memberDeclaration) continue;

    const shape = callableShape(checker, target, memberDeclaration);
    members.set(memberName, {
      name: memberName,
      ...shape,
    });
  }

  return members;
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

    const target = resolveAlias(checker, exported);
    const declaration = getDeclaration(target, exported);
    if (!declaration) continue;

    const shape = callableShape(checker, target, declaration);
    const members = getOneLevelMembers(checker, target, declaration);

    symbols.set(name, {
      name,
      ...shape,
      members,
    });
  }

  return { entry, symbols };
}

function callableChanged(before, after) {
  return (
    before.requiredParams !== after.requiredParams ||
    before.totalParams !== after.totalParams ||
    before.hasRest !== after.hasRest
  );
}

export function classifyCallableCompatibility(before, after) {
  const reasons = [];

  if (after.requiredParams > before.requiredParams) {
    reasons.push('required-parameter-added');
  }
  if (after.totalParams < before.totalParams) {
    reasons.push('accepted-parameter-removed');
  }
  if (before.hasRest && !after.hasRest) {
    reasons.push('rest-parameter-removed');
  }

  if (reasons.length) {
    return { compatibility: 'breaking', reasons };
  }

  return {
    compatibility: 'compatible',
    reasons: ['call-domain-not-narrowed'],
  };
}

function compareCallable(path, before, after, changeType, changes, notAnalyzed) {
  if (before.kind !== 'function' || after.kind !== 'function') return;

  if (!before.callable || !after.callable) {
    notAnalyzed.push({
      symbol: path,
      reason: 'unsupported-call-signature',
      beforeOverloads: before.overloads,
      afterOverloads: after.overloads,
    });
    return;
  }

  if (callableChanged(before.callable, after.callable)) {
    const classification = classifyCallableCompatibility(before.callable, after.callable);
    changes.push({
      type: changeType,
      confidence: 0.99,
      symbol: path,
      before: before.callable,
      after: after.callable,
      ...classification,
    });
  }
}

export function diffAnalyses(oldAnalysis, newAnalysis) {
  const changes = [];
  const notAnalyzed = [];

  for (const [name, before] of oldAnalysis.symbols) {
    const after = newAnalysis.symbols.get(name);
    if (!after) {
      changes.push({
        type: 'removed-symbol',
        confidence: 1,
        compatibility: 'breaking',
        reasons: ['exported-symbol-removed'],
        symbol: name,
      });
      continue;
    }

    compareCallable(name, before, after, 'function-arity-change', changes, notAnalyzed);

    for (const [memberName, beforeMember] of before.members) {
      const afterMember = after.members.get(memberName);
      const memberPath = `${name}.${memberName}`;

      if (!afterMember) {
        changes.push({
          type: 'removed-member',
          confidence: 1,
          compatibility: 'breaking',
          reasons: ['exported-member-removed'],
          symbol: memberPath,
          parent: name,
          member: memberName,
        });
        continue;
      }

      compareCallable(memberPath, beforeMember, afterMember, 'member-arity-change', changes, notAnalyzed);
    }
  }

  return {
    changes,
    breakingChanges: changes.filter(change => change.compatibility === 'breaking'),
    compatibleChanges: changes.filter(change => change.compatibility === 'compatible'),
    notAnalyzed,
  };
}
