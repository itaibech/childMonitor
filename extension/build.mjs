import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/background.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  outfile: 'dist/background.js',
});
await cp('manifest.json', 'dist/manifest.json');
