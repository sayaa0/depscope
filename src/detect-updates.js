import fs from 'node:fs';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function directDependencyNames(packageJson) {
  const names = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(packageJson?.[field] || {})) names.add(name);
  }
  return names;
}

function lockVersion(lock, packageName) {
  const packageEntry = lock?.packages?.[`node_modules/${packageName}`];
  if (packageEntry?.version) return packageEntry.version;

  const legacyEntry = lock?.dependencies?.[packageName];
  if (legacyEntry?.version) return legacyEntry.version;

  return null;
}

export function detectUpdatesFromDocuments(basePackageJson, headPackageJson, baseLock, headLock) {
  if (!basePackageJson || !headPackageJson) {
    throw new Error('Auto detection requires package.json at both PR refs.');
  }
  if (!baseLock || !headLock) {
    throw new Error('Auto detection currently requires package-lock.json at both PR refs.');
  }

  const names = new Set([
    ...directDependencyNames(basePackageJson),
    ...directDependencyNames(headPackageJson),
  ]);

  const updates = [];
  for (const packageName of [...names].sort()) {
    const from = lockVersion(baseLock, packageName);
    const to = lockVersion(headLock, packageName);
    if (!from || !to || from === to) continue;
    updates.push({ package: packageName, from, to });
  }

  return updates;
}

function joinRepoPath(dir, file) {
  const cleanDir = String(dir || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return cleanDir && cleanDir !== '.' ? `${cleanDir}/${file}` : file;
}

async function fetchJsonAtRef({ repository, ref, path, token }) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const headers = {
    Accept: 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'depscope-action',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub contents request failed for ${path}@${ref}: HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${path}@${ref} as JSON: ${error.message}`);
  }
}

function readPullRequestContext(eventPath) {
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('Auto detection requires a GitHub pull_request event.');
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pullRequest = event.pull_request;
  if (!pullRequest?.base?.sha || !pullRequest?.head?.sha) {
    throw new Error('Auto detection requires a GitHub pull_request event with base/head SHAs.');
  }

  return {
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
  };
}

export async function detectPullRequestUpdates({
  repository = process.env.GITHUB_REPOSITORY,
  eventPath = process.env.GITHUB_EVENT_PATH,
  token = process.env.DEPSCOPE_GITHUB_TOKEN,
  manifestDir = '.',
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is unavailable.');

  const { baseSha, headSha } = readPullRequestContext(eventPath);
  const packagePath = joinRepoPath(manifestDir, 'package.json');
  const lockPath = joinRepoPath(manifestDir, 'package-lock.json');

  const [basePackageJson, headPackageJson, baseLock, headLock] = await Promise.all([
    fetchJsonAtRef({ repository, ref: baseSha, path: packagePath, token }),
    fetchJsonAtRef({ repository, ref: headSha, path: packagePath, token }),
    fetchJsonAtRef({ repository, ref: baseSha, path: lockPath, token }),
    fetchJsonAtRef({ repository, ref: headSha, path: lockPath, token }),
  ]);

  return detectUpdatesFromDocuments(basePackageJson, headPackageJson, baseLock, headLock);
}
