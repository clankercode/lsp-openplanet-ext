import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export interface ChangelogSection {
  version: string;
  body: string;
}

/**
 * Extracts one section from a Keep-a-Changelog file. `version` may be a
 * semver string like "0.1.0" or the literal "Unreleased" (case-insensitive).
 * Matches `## [version]` optionally followed by ` - date`, captures everything
 * up to the next `## ` at the start of a line (or end of file), and returns
 * the trimmed body.
 */
export function extractSection(changelog: string, version: string): ChangelogSection {
  const wantUnreleased = version.toLowerCase() === 'unreleased';
  const canonicalHeading = wantUnreleased ? 'Unreleased' : version;

  const lines = changelog.split(/\r?\n/);
  const headingRe = buildHeadingRegex(canonicalHeading);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (headingRe.test(line)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error(
      `Changelog section for "${canonicalHeading}" not found. Add a "## [${canonicalHeading}]" heading to CHANGELOG.md.`,
    );
  }

  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  const body = lines.slice(startIdx, endIdx).join('\n').replace(/\s+$/, '');
  return { version: canonicalHeading, body };
}

function buildHeadingRegex(heading: string): RegExp {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Accept `## [Heading]` with optional ` - YYYY-MM-DD` (or any trailing
  // metadata) and an optional missing-bracket form `## Heading`.
  return new RegExp(`^##\\s+(\\[${escaped}\\]|${escaped})(\\s+-\\s+.*)?\\s*$`, 'i');
}

function main(): void {
  const args = process.argv.slice(2);
  const version = args[0];
  if (!version) {
    console.error('usage: extract-changelog.ts <version|Unreleased> [path]');
    process.exit(2);
  }
  const path = args[1] ?? 'CHANGELOG.md';
  const content = readFileSync(path, 'utf8');
  try {
    const section = extractSection(content, version);
    process.stdout.write(section.body);
    if (!section.body.endsWith('\n')) process.stdout.write('\n');
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(1);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) main();
