#!/usr/bin/env node
// Mimics `openplanet-lsp --version`.
// Prints unconditionally because tests invoke this via `node <path>` without
// forwarding additional flags; the script's sole purpose is to produce mock
// version output.
process.stdout.write('openplanet-lsp 0.2.0\n');
process.exit(0);
