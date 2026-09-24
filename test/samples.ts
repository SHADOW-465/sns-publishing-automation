import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUTOMATION = resolve(dirname(fileURLToPath(import.meta.url)), '../../Automation')
export const INDD = resolve(AUTOMATION, 'Indesin-to-EPUB-Automation')
export const has = (p: string) => existsSync(p)
export const read = (p: string) => new Uint8Array(readFileSync(p))
