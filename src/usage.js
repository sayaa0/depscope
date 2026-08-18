import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

function walkSourceFiles(root) {
  const files = [];
  const stack = [path.resolve(root)];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
    }
  }

  return files;
}

function addUsage(usages, symbol, file) {
  if (!symbol) return;
  const set = usages.get(symbol) ?? new Set();
  set.add(file);
  usages.set(symbol, set);
}

function isTargetModule(specifier, packageName) {
  return specifier === packageName;
}

export function scanProjectUsage(projectRoot, packageName) {
  const root = path.resolve(projectRoot);
  const usages = new Map();
  const namespaceImports = new Map();
  const unsupported = [];

  for (const file of walkSourceFiles(root)) {
    const sourceText = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.ES2022,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const namespaces = new Set();

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        if (!isTargetModule(specifier, packageName)) continue;

        const clause = statement.importClause;
        if (!clause) continue;

        if (clause.name) {
          unsupported.push({ file, kind: 'default-import', local: clause.name.text });
        }

        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            addUsage(usages, element.propertyName?.text ?? element.name.text, file);
          }
        } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          namespaces.add(clause.namedBindings.name.text);
        }
      }

      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        if (!isTargetModule(specifier, packageName)) continue;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            addUsage(usages, element.propertyName?.text ?? element.name.text, file);
          }
        } else {
          unsupported.push({ file, kind: 'export-star' });
        }
      }
    }

    function visit(node) {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      ) {
        addUsage(usages, node.name.text, file);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);

    for (const local of namespaces) {
      namespaceImports.set(`${file}:${local}`, { file, local });
    }
  }

  return {
    root,
    usages,
    unsupported,
    namespaceImports: [...namespaceImports.values()],
  };
}

export function filterChangesByUsage(diff, usage) {
  const affectedChanges = [];
  const unrelatedChanges = [];

  for (const change of diff.changes) {
    const files = usage.usages.get(change.symbol);
    if (files?.size) {
      affectedChanges.push({
        ...change,
        files: [...files].map(file => path.relative(usage.root, file) || path.basename(file)),
      });
    } else {
      unrelatedChanges.push(change);
    }
  }

  return {
    affectedChanges,
    unrelatedChanges,
    unsupportedUsage: usage.unsupported,
    importedSymbols: [...usage.usages.keys()].sort(),
  };
}
