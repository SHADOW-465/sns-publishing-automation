import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The client's real example books (inputs and finished outputs) are large and belong to the client, so they are not in git.
// They live in fixtures/reference/Automation (git-ignored), or wherever SNS_AUTOMATION points. Tests that need them skip when absent.
export const AUTOMATION = process.env.SNS_AUTOMATION
  ? resolve(process.env.SNS_AUTOMATION)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/reference/Automation')
export const INDD = resolve(AUTOMATION, 'Indesin-to-EPUB-Automation')
export const has = (p: string) => existsSync(p)
export const read = (p: string) => new Uint8Array(readFileSync(p))
