/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { quoteProxyPlugin } from './server/quote-proxy.ts'

export default defineConfig(({ mode }) => {
  // 把 .env（无前缀）并入 process.env，供服务端行情 provider 读取 ALPACA key。
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), quoteProxyPlugin()],
    server: { port: 43127, strictPort: true },
    preview: { port: 43127 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
