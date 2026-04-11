import { describe, it, expect } from 'vitest';
import { extractSection } from '../extract-changelog.js';

const SAMPLE = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- A new widget.
- Another thing.

## [0.2.0] - 2026-05-01

### Added

- Second release.

### Fixed

- Something.

## [0.1.0] - 2026-04-12

First public release.

- binary-resolver
- build-binaries pipeline

## [0.0.1] - 2026-04-01

- initial
`;

describe('extractSection', () => {
  it('extracts the Unreleased section', () => {
    const section = extractSection(SAMPLE, 'Unreleased');
    expect(section.version).toBe('Unreleased');
    expect(section.body).toContain('A new widget.');
    expect(section.body).toContain('Another thing.');
    expect(section.body).not.toContain('Second release.');
  });

  it('extracts a versioned section with a date', () => {
    const section = extractSection(SAMPLE, '0.2.0');
    expect(section.version).toBe('0.2.0');
    expect(section.body).toContain('Second release.');
    expect(section.body).toContain('Fixed');
    expect(section.body).not.toContain('A new widget.');
    expect(section.body).not.toContain('First public release.');
  });

  it('extracts the last section in the file', () => {
    const section = extractSection(SAMPLE, '0.0.1');
    expect(section.version).toBe('0.0.1');
    expect(section.body).toContain('initial');
  });

  it('extracts a section with a paragraph followed by a list', () => {
    const section = extractSection(SAMPLE, '0.1.0');
    expect(section.body).toContain('First public release.');
    expect(section.body).toContain('binary-resolver');
    expect(section.body).not.toContain('Second release.');
  });

  it('throws when the requested version is missing', () => {
    expect(() => extractSection(SAMPLE, '9.9.9')).toThrow(/9\.9\.9/);
  });

  it('matches a section with no date suffix', () => {
    const changelog = `# Changelog

## [0.1.0]

body content
`;
    const section = extractSection(changelog, '0.1.0');
    expect(section.body).toContain('body content');
  });

  it('trims trailing whitespace from the body', () => {
    const section = extractSection(SAMPLE, '0.2.0');
    expect(section.body).not.toMatch(/\n{3,}$/);
    expect(section.body).not.toMatch(/\s+$/);
  });

  it('is case-insensitive for Unreleased', () => {
    const section = extractSection(SAMPLE, 'unreleased');
    expect(section.body).toContain('A new widget.');
  });
});
