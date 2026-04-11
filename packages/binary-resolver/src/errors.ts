import type { ResolveSource } from './types.js';

export interface CheckedLocation {
  source: ResolveSource;
  path: string;
  reason: string;
}

export interface BinaryNotFoundErrorInit {
  checkedLocations: readonly CheckedLocation[];
}

export class BinaryNotFoundError extends Error {
  public readonly checkedLocations: readonly CheckedLocation[];

  constructor(init: BinaryNotFoundErrorInit) {
    const message = buildMessage(init.checkedLocations);
    super(message);
    this.name = 'BinaryNotFoundError';
    this.checkedLocations = init.checkedLocations;
    Object.setPrototypeOf(this, BinaryNotFoundError.prototype);
  }
}

function buildMessage(locations: readonly CheckedLocation[]): string {
  const header = 'openplanet-lsp binary not found.';
  if (locations.length === 0) {
    return `${header} No resolution sources were attempted.`;
  }
  const lines = locations.map((loc) => `  - ${loc.source} (${loc.path}): ${loc.reason}`);
  return [`${header} Checked:`, ...lines].join('\n');
}
