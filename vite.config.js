import { defineConfig } from 'vite'

export default defineConfig({
  base: '/YouTubeVideoSelector/',

  build:{
    rollupOptions:{
      output:{entryFileNames:'assets/index.js',chunkFileNames:'assets/[name].js',assetFileNames:'assets/[name][extname]'}
    }
  }
});
