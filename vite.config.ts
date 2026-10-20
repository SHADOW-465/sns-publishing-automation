import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { epubcheckPlugin } from './server/epubcheck-service.mjs'
import { acePlugin } from './server/ace-service.mjs'

export default defineConfig({
  // EPUBCheck runs from the bundled JRE in tools/ and is offered to the app at /api/epubcheck, Ace from tools/ace at /api/ace (dev and preview)
  plugins: [react(), epubcheckPlugin(), acePlugin()],
  base: './', // relative asset paths so the build also runs from file:// inside a desktop shell
})
