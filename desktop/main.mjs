// Desktop shell: serves the built app and the local EPUBCheck service on 127.0.0.1 and opens a window on it.
// Nothing leaves the machine: EPUBCheck runs from the JRE and jar packaged next to the app (see server/epubcheck-service.mjs).
//   Self test (no window):  "<app>.exe" --epubcheck-selftest <book.epub> <result.json>
import { app, BrowserWindow, shell } from 'electron'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { epubcheckHandler, runEpubcheck, toolPaths } from '../server/epubcheck-service.mjs'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm' }

// ponytail: main() is started, not awaited. With an ES-module main, Electron waits for the module to finish before it
// emits "ready", so awaiting app.whenReady() at the top level would never return.
async function main() {
  const i = process.argv.indexOf('--epubcheck-selftest')
  if (i > 0) {
    const [book, out] = process.argv.slice(i + 1)
    const r = await runEpubcheck(new Uint8Array(await readFile(book)))
    await writeFile(out, JSON.stringify({ tools: toolPaths(), resourcesPath: process.resourcesPath, packaged: app.isPackaged, result: r }, null, 1))
    return app.exit(r && !r.errors.length ? 0 : 1)
  }
  const root = join(app.getAppPath(), 'dist')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/epubcheck') return epubcheckHandler(req, res)
    const file = join(root, normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)))
    if (!file.startsWith(root)) return void res.writeHead(403).end()
    try {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file))
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const win = new BrowserWindow({ width: 1280, height: 860, title: 'Automation', webPreferences: { contextIsolation: true } })
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(({ url }) => (shell.openExternal(url), { action: 'deny' }))
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`)
  app.on('window-all-closed', () => app.quit())
}
app.whenReady().then(main)
