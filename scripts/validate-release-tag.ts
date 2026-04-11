import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SEMVER_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export interface TagInfo {
  raw: string;
  version: string;
  baseVersion: string;
  isDry: boolean;
  prerelease: string | null;
}

export function parseTag(raw: string): TagInfo {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Release tag must be a non-empty string');
  }
  if (!raw.startsWith('v')) {
    throw new Error(`Release tag must start with "v" (got ${JSON.stringify(raw)})`);
  }
  const m = SEMVER_RE.exec(raw);
  if (!m) {
    throw new Error(
      `Release tag must be semver vMAJOR.MINOR.PATCH[-PRERELEASE] (got ${JSON.stringify(raw)})`,
    );
  }
  const [, major, minor, patch, prerelease] = m;
  const core = `${major}.${minor}.${patch}`;
  const version = prerelease ? `${core}-${prerelease}` : core;

  if (!prerelease) {
    return { raw, version, baseVersion: core, isDry: false, prerelease: null };
  }

  const parts = prerelease.split('.');
  if (parts[0] === 'dry') {
    return {
      raw,
      version,
      baseVersion: core,
      isDry: true,
      prerelease,
    };
  }

  return {
    raw,
    version,
    baseVersion: version,
    isDry: false,
    prerelease,
  };
}

export interface PkgFile {
  path: string;
  content: string;
}

export interface VersionCheckResult {
  ok: boolean;
  errors: string[];
  matchedFiles: string[];
}

export function checkAllVersionsMatch(baseVersion: string, files: PkgFile[]): VersionCheckResult {
  const errors: string[] = [];
  const matched: string[] = [];
  for (const f of files) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(f.content);
    } catch (e) {
      errors.push(`${f.path}: invalid JSON: ${(e as Error).message}`);
      continue;
    }
    if (typeof pkg !== 'object' || pkg === null) {
      errors.push(`${f.path}: not a JSON object`);
      continue;
    }
    const version = (pkg as Record<string, unknown>).version;
    if (typeof version !== 'string') {
      errors.push(`${f.path}: no "version" field`);
      continue;
    }
    if (version !== baseVersion) {
      errors.push(
        `${f.path}: version ${JSON.stringify(version)} does not match tag version ${JSON.stringify(baseVersion)}`,
      );
      continue;
    }
    matched.push(f.path);
  }
  return { ok: errors.length === 0, errors, matchedFiles: matched };
}

export function collectPackageFiles(repoRoot: string): PkgFile[] {
  const files: PkgFile[] = [];
  try {
    const rootPath = join(repoRoot, 'package.json');
    files.push({ path: 'package.json', content: readFileSync(rootPath, 'utf8') });
  } catch {
    // No root package.json; caller will get an empty set.
  }
  const packagesDir = join(repoRoot, 'packages');
  let entries: string[] = [];
  try {
    entries = readdirSync(packagesDir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    try {
      const s = statSync(pkgPath);
      if (!s.isFile()) continue;
      files.push({
        path: `packages/${entry}/package.json`,
        content: readFileSync(pkgPath, 'utf8'),
      });
    } catch {
      continue;
    }
  }
  return files;
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const raw = args.find((a) => !a.startsWith('--'));
  if (!raw) {
    console.error('usage: validate-release-tag.ts <tag> [--json]');
    process.exit(2);
  }
  let info: TagInfo;
  try {
    info = parseTag(raw);
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(1);
  }
  const files = collectPackageFiles(process.cwd());
  const result = checkAllVersionsMatch(info.baseVersion, files);
  if (!result.ok) {
    console.error(`❌ Version mismatch for tag ${info.raw}:`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(info));
    return;
  }
  const label = info.isDry ? 'dry-run, ' : '';
  console.log(
    `✅ tag ${info.raw} (${label}base version ${info.baseVersion}) matches ${result.matchedFiles.length} package.json file(s)`,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) main();
