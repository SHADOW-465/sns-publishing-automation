// Client layers that ship with the tool, one JSON file each in the Layer shape (plus how the publisher's name matches).
// Add a client by dropping a file in this folder: Vite bundles every *.json here. BeBra is imported by name as well,
// because Node (the tests) has no import.meta.glob.
import bebra from './bebra.json' with { type: 'json' }
import type { ClientFile } from '../engine/spec/clients.ts'

const globbed = (import.meta as { glob?: (p: string, o: object) => Record<string, ClientFile> }).glob?.('./*.json', { eager: true, import: 'default' }) ?? {}
export const CLIENT_FILES: ClientFile[] = [...new Map([bebra as ClientFile, ...Object.values(globbed)].map((f) => [f.match, f])).values()]
