// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://boda-pablo-maria-2026.vercel.app',
  vite: {
    plugins: [tailwindcss()]
  }
});