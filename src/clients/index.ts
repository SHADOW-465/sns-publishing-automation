// Client layers that ship with the tool, one JSON file each in the Layer shape (plus how the publisher's name matches).
// Add a client by adding a file here and one import line below: data, not code.
import bebra from './bebra.json' with { type: 'json' }
import type { ClientFile } from '../engine/spec/clients.ts'

export const CLIENT_FILES: ClientFile[] = [bebra as ClientFile]
