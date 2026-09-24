// pdf.js for the browser: parsing runs in a worker so the page stays responsive.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { readPrintPages } from '../engine/pdf/pages.ts'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export const printPagesOf = (data: Uint8Array) => readPrintPages(pdfjs as never, data)
