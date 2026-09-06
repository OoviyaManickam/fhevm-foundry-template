import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    https: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@zama-fhe/relayer-sdk'],
  },
  resolve: {
    conditions: ['browser', 'module', 'import'],
  },
})
