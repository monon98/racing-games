/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // 本地开发用相对路径；GitHub Actions 部署时根据仓库名生成 /<repo>/ 子路径
  base: process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : './',
  server: {
    host: true,
  },
  build: {
    // 代码分割：three / cannon-es 独立 vendor 包（浏览器并行下载 + 长缓存，
    // 主入口不再超 500kB 警告线；rolldown 配置用高级分块 API）。
    // vendor-three ≈666kB（gzip 169kB）是 three.js 本体体量，独立成包后该警告无 actionable 意义，调高阈值。
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor-three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vendor-cannon', test: /[\\/]node_modules[\\/]cannon-es[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
