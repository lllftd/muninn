/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { quoteProxyPlugin } from './server/quote-proxy.ts'

export default defineConfig({
  plugins: [react(), quoteProxyPlugin()],
  server: { port: 43127, strictPort: true },
  preview: { port: 43127 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
