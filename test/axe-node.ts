// axe-core in Node: each page in a jsdom window, through the same axeIn the browser's iframe runner uses.
import axe from '@daisy/axe-core-for-ace'
import { JSDOM } from 'jsdom'
import { axeIn, withoutScripts, type AxeRunner } from '../src/engine/check/axe.ts'

export const jsdomAxe: AxeRunner = async (xhtml) => {
  const dom = new JSDOM(withoutScripts(xhtml), { contentType: 'application/xhtml+xml', runScripts: 'outside-only', pretendToBeVisual: true })
  try {
    return await axeIn(dom.window as never, axe.source, (code) => dom.window.eval(code))
  } finally {
    dom.window.close()
  }
}
