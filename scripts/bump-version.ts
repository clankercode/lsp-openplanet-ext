import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): Version {
  if (!version || typeof version !== 'string') {
    throw new Error('Version must be a non-empty string');
  }
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(
      `Version must be semver MAJOR.MINOR.PATCH (got ${JSON.stringify(version)})`,
    );
  }
  const major = Number.parseInt(parts[0]!, 10);
  const minor = Number.parseInt(parts[1]!, 10);
  const patch = Number.parseInt(parts[2]!, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    throw new Error(
      `Version parts must be integers (got ${JSON.stringify(version)})`,
    );
  }
  return { major, minor, patch };
}

export function bumpVersion(
  version: string,
  level: 'major' | 'minor' | 'patch',
): string {
  const v = parseVersion(version);
  switch (level) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
}

export function updatePackageJson(content: string, newVersion: string): string {
  let pkg: unknown;
  try {
    pkg = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (typeof pkg !== 'object' || pkg === null) {
    throw new Error('package.json must be a JSON object');
  }
  const obj = pkg as Record<string, unknown>;
  obj.version = newVersion;

  // Try to preserve indentation from the input.
  let indent = 2;
  const match = content.match(/^(\s+)"/m);
  if (match) {
    indent = match[1]!.length;
  }
  return JSON.stringify(obj, null, indent) + '\n';
}

function collectPackageFiles(repoRoot: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  try {
    const rootPath = join(repoRoot, 'package.json');
    files.push({ path: 'package.json', content: readFileSync(rootPath, 'utf8') });
  } catch {
    // No root package.json
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
  const newVersion = args[0];
  if (!newVersion) {
    console.error('usage: bump-version.ts <version>');
    console.error('  Bumps all workspace package.json files to the given version.');
    console.error('  Example: bump-version.ts 0.1.0');
    process.exit(2);
  }

  // Validate the version format
  parseVersion(newVersion);

  const files = collectPackageFiles(process.cwd());
  console.log(`Updating ${files.length} package.json file(s) to version ${newVersion}...`);

  for (const file of files) {
    const updated = updatePackageJson(file.content, newVersion);
    writeFileSync(file.path, updated, 'utf8');
    console.log(`✓ ${file.path}`);
  }

  console.log(`\n✅ All package.json files updated to ${newVersion}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) main();
