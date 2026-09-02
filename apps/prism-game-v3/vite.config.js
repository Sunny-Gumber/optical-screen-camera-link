import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        editor: resolve(process.cwd(), 'index.html'),
        stage6: resolve(process.cwd(), 'stage6.html'),
        game: resolve(process.cwd(), 'game.html')
      }
    }
  }
});
