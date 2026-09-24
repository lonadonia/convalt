import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Optional media (posters, motion studies) are detected at build/dev-server start so the app never
 * requests files that are not there. Restart the dev server after adding files to public/media/.
 */
function listMedia(): string[] {
  const dir = path.resolve(import.meta.dirname, 'public/media');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(webp|avif|jpe?g|png|mp4|webm)$/i.test(f));
}

export default defineConfig({
  plugins: [react()],
  define: {
    __MEDIA_FILES__: JSON.stringify(listMedia()),
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // three.js + R3F live in the lazily imported StoryCanvas chunk, so text and links render
    // before the 3D code downloads.
    chunkSizeWarningLimit: 1000,
  },
});
