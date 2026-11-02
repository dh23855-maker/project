import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 개발 중에는 /api 요청을 서버(127.0.0.1:8000)로 넘긴다.
// 화면과 서버가 같은 주소처럼 보여서 로그인 쿠키가 그대로 동작한다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
