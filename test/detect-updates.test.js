import assert from 'node:assert/strict';
import test from 'node:test';
import { detectUpdatesFromDocuments } from '../src/detect-updates.js';

function lock(entries) {
  return {
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(entries).map(([name, version]) => [`node_modules/${name}`, { version }])
    ),
  };
}

test('detects direct dependency updates from resolved lockfile versions', () => {
  const basePackage = {
    dependencies: { zod: '^3.23.8', chalk: '^4.0.0' },
  };
  const headPackage = {
    dependencies: { zod: '^4.0.0', chalk: '^4.0.0' },
  };

  const updates = detectUpdatesFromDocuments(
    basePackage,
    headPackage,
    lock({ zod: '3.23.8', chalk: '4.1.1' }),
    lock({ zod: '4.0.0', chalk: '4.1.2' })
  );

  assert.deepEqual(updates, [
    { package: 'chalk', from: '4.1.1', to: '4.1.2' },
    { package: 'zod', from: '3.23.8', to: '4.0.0' },
  ]);
});

test('detects lockfile-only upgrades even when package.json range is unchanged', () => {
  const packageJson = {
    dependencies: { chalk: '^4.0.0' },
  };

  const updates = detectUpdatesFromDocuments(
    packageJson,
    packageJson,
    lock({ chalk: '4.1.1' }),
    lock({ chalk: '4.1.2' })
  );

  assert.deepEqual(updates, [
    { package: 'chalk', from: '4.1.1', to: '4.1.2' },
  ]);
});

test('ignores changed transitive packages that are not direct dependencies', () => {
  const packageJson = {
    dependencies: { zod: '^3.23.8' },
  };

  const updates = detectUpdatesFromDocuments(
    packageJson,
    packageJson,
    lock({ zod: '3.23.8', transitive: '1.0.0' }),
    lock({ zod: '3.23.8', transitive: '2.0.0' })
  );

  assert.deepEqual(updates, []);
});

test('supports package-lock v1 dependency entries', () => {
  const packageJson = {
    devDependencies: { typescript: '^5.7.0' },
  };
  const baseLock = { lockfileVersion: 1, dependencies: { typescript: { version: '5.7.3' } } };
  const headLock = { lockfileVersion: 1, dependencies: { typescript: { version: '5.8.3' } } };

  assert.deepEqual(
    detectUpdatesFromDocuments(packageJson, packageJson, baseLock, headLock),
    [{ package: 'typescript', from: '5.7.3', to: '5.8.3' }]
  );
});
