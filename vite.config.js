import {defineConfig} from 'vite';

// 固定名にして Service Worker がビルド済みの全画面資産を確実にプリキャッシュする。
export default defineConfig({
  build:{
    rollupOptions:{
      output:{entryFileNames:'assets/index.js',chunkFileNames:'assets/[name].js',assetFileNames:'assets/[name][extname]'}
    }
  }
});
