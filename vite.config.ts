import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { epubcheckPlugin } from './server/epubcheck-service.mjs'

export default defineConfig({
  // EPUBCheck runs from the bundled JRE in tools/ and is offered to the app at /api/epubcheck (dev and preview)
  plugins: [react(), epubcheckPlugin()],
  base: './', // relative asset paths so the build also runs from file:// inside a desktop shell
})
