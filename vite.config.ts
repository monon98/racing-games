import { defineConfig } from 'vite';

export default defineConfig({
  // 本地开发用相对路径；GitHub Actions 部署时根据仓库名生成 /<repo>/ 子路径
  base: process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : './',
  server: {
    host: true,
  },
});
