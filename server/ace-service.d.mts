import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
export function acePath(): string | null
export function aceFindings(report: unknown): { errors: string[]; warnings: string[] }
export function runAce(epub: Uint8Array): Promise<{ errors: string[]; warnings: string[] } | null>
export function aceHandler(req: IncomingMessage, res: ServerResponse): void
export function acePlugin(): Plugin
