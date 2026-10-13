// One problem count for the screen and the command-line run.
// The checker and the conversion notes sometimes describe the same picture or the same ISBN.
// Those notes are shown once, with the checker's finding, so the headline is not the sum of both lists.
import type { CheckReport } from './epub.ts'
import type { ReviewItem } from '../epub/package.ts'

const SAME = [
  { note: /needs a description|picture description|no description|alt text|alternativtext/i, report: /no description|not a real description|needs approval|alt text|alternativtext/i },
  { note: /isbn/i, report: /isbn/i },
  { note: /page marker/i, report: /page marker/i },
  // A measured cover image is not the same fact as "no cover was uploaded".
  { note: /no cover uploaded|blank placeholder/i, report: /no cover|not declared|blank placeholder/i },
]

/** A conversion note the checker already reports, so it must not be counted again. */
export function alreadyReported(msg: string, reportText: string): boolean {
  return SAME.some((s) => s.note.test(msg) && s.report.test(reportText))
}

function reportText(report: CheckReport): string {
  return report.groups.flatMap((g) => g.findings.map((f) => f.msg)).join('\n')
}

/** Conversion notes that are not already in the quality check. */
export function extraReview(report: CheckReport, review: ReviewItem[] = []): ReviewItem[] {
  const text = reportText(report)
  return review.filter((r) => (r.level === 'error' || r.level === 'warn') && !alreadyReported(r.msg, text))
}

export function deliveryCounts(report: CheckReport, review: ReviewItem[] = []): { errors: number; warnings: number } {
  let errors = report.errors
  let warnings = report.warnings
  for (const r of extraReview(report, review)) {
    if (r.level === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}
