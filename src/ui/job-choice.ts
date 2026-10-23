// The choices from the start screen, kept for this sitting so the workflow that opens next
// uses them. Not a setting: the book file can still disagree, and the operator sees that.

export type JobOutput = 'standard-epub' | 'accessible-epub' | 'accessible-pdf'

export interface JobChoice {
  client: string
  output: JobOutput
}

let current: JobChoice | undefined

export const jobChoice = () => current
export const setJobChoice = (c: JobChoice) => {
  current = c
}

/** Standard and accessible EPUB set the book profile. Accessible PDF is a different workflow. */
export function profileFor(output: JobOutput | undefined): 'standard' | 'accessible' | undefined {
  if (output === 'standard-epub') return 'standard'
  if (output === 'accessible-epub') return 'accessible'
  return undefined
}
