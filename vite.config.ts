/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Must match VITE_REDIRECT_URI and the redirect URI registered on the Entra
    // app registration. Vite's default is 5173, so without this the sign-in
    // round-trip completes at Entra and then redirects the browser to
    // localhost:5175, where nothing is listening — ERR_CONNECTION_REFUSED with
    // a valid auth code sitting unusable in the URL fragment. The token is fine;
    // only the landing port is wrong, which makes it look like an auth failure
    // when it is a dev-server config failure.
    port: 5175,
    // Fail loudly rather than silently serving on 5176 when 5175 is taken.
    // Auto-incrementing reintroduces exactly the mismatch above, one port along,
    // and the resulting error points at Entra instead of at the busy port.
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
