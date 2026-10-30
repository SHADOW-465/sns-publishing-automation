// The instruction on disk (T21): `instruction.txt` in the job folder, and the compile cache of a batch run. Node only: the browser keeps
// the instruction in the Spec step (instruction.ts has no node imports).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { InstructionCache } from './instruction.ts'

/** The text of the book's instruction: `instruction.txt` in the job folder, else `<book>.instruction.txt` beside the PDF. Empty or missing: none. */
export function readInstruction(jobDir: string, pdf: string): string | undefined {
  const stem = basename(pdf, extname(pdf))
  for (const f of [join(jobDir, 'instruction.txt'), join(dirname(pdf), `${stem}.instruction.txt`)]) {
    if (!existsSync(f)) continue
    const t = readFileSync(f, 'utf8').replace(/^﻿/, '').trim()
    if (t) return t
  }
  return undefined
}

/** `<dir>/<key>.json`, one file per compiled text */
export function fileCache(dir: string): InstructionCache {
  const file = (k: string) => join(dir, `${k}.json`)
  return {
    get(k) {
      try {
        return JSON.parse(readFileSync(file(k), 'utf8'))
      } catch {
        return undefined
      }
    },
    put(k, e) {
      mkdirSync(dir, { recursive: true })
      const tmp = file(k) + '.tmp'
      writeFileSync(tmp, JSON.stringify(e, null, 2))
      renameSync(tmp, file(k))
    },
  }
}
