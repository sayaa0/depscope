import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

export async function fetchPackageVersion(packageName, version) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'depscope-'));
  const packDir = path.join(tempRoot, 'pack');
  const extractDir = path.join(tempRoot, 'extract');
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(extractDir, { recursive: true });

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const spec = `${packageName}@${version}`;
  const { stdout } = await run(npmCommand, [
    'pack', spec,
    '--json',
    '--ignore-scripts',
    '--pack-destination', packDir,
  ]);

  let packed;
  try {
    packed = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse npm pack output for ${spec}: ${stdout}`);
  }

  const filename = packed?.[0]?.filename;
  if (!filename) throw new Error(`npm pack did not return a tarball for ${spec}`);

  const tarball = path.join(packDir, filename);
  await run('tar', ['-xzf', tarball, '-C', extractDir]);

  return {
    packageDir: path.join(extractDir, 'package'),
    cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
  };
}
