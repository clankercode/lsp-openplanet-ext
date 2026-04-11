import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export interface ShapeResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_FIELDS = ['name', 'version', 'type', 'main', 'types', 'files', 'scripts'] as const;
const REQUIRED_SCRIPTS = ['test', 'typecheck'] as const;

export function verifyPackageShape(pkg: unknown, path: string): ShapeResult {
  const errors: string[] = [];
  if (typeof pkg !== 'object' || pkg === null) {
    return { ok: false, errors: [`${path}: not a JSON object`] };
  }
  const p = pkg as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in p)) {
      errors.push(`${path}: missing required field "${field}"`);
    }
  }

  if ('type' in p && p.type !== 'module') {
    errors.push(`${path}: "type" must be "module" (got ${JSON.stringify(p.type)})`);
  }

  const scripts = (p.scripts ?? {}) as Record<string, unknown>;
  for (const s of REQUIRED_SCRIPTS) {
    if (typeof scripts[s] !== 'string') {
      errors.push(`${path}: missing required script "scripts.${s}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function main(): void {
  const packagesDir = 'packages';
  let entries: string[];
  try {
    entries = readdirSync(packagesDir);
  } catch {
    console.log('no packages/ directory; nothing to verify');
    return;
  }

  let failed = false;
  for (const entry of entries) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    let stat;
    try {
      stat = statSync(pkgPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg: unknown = JSON.parse(raw);
    const result = verifyPackageShape(pkg, pkgPath);
    if (!result.ok) {
      failed = true;
      for (const err of result.errors) {
        console.error(`❌ ${err}`);
      }
    } else {
      console.log(`✅ ${pkgPath}`);
    }
  }
  if (failed) process.exit(1);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
