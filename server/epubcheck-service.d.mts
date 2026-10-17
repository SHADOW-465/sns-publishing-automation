import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
export function toolDirs(): string[]
export function toolPaths(): { java: string; jar: string; dir: string } | null
export function runEpubcheck(epub: Uint8Array): Promise<{ errors: string[]; warnings: string[] } | null>
export function epubcheckHandler(req: IncomingMessage, res: ServerResponse): void
export function epubcheckPlugin(): Plugin
