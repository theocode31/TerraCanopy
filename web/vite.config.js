import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relative : le site marche aussi dans un sous-dossier (GitHub Pages par exemple)
export default defineConfig({
  plugins: [react()],
  base: './',
});
