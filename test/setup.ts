import { JSDOM } from 'jsdom'
const { window } = new JSDOM('')
Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer })
