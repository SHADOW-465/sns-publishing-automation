// Test cleanup only: removing a temp folder must never fail a test. Windows can hold a file
// open for a moment after a child process (Java, a server) exits, which gives EPERM or EBUSY.
import { rmSync } from 'node:fs'

export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EBUSY') throw e
  }
}
