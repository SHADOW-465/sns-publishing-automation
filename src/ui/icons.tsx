// One line-icon set (24px grid, 1.75 stroke, round joins), drawn inline so the app works offline.
import type { SVGProps } from 'react'

const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h14V9M10 20v-6h4v6',
  indesign: 'M4 4h16v16H4zM9 8v8M13 8h2a3 3 0 0 1 0 6h-2V8',
  pdf: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h4',
  access: 'M12 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M5 8l7 1.5L19 8M12 9.5V14l-3 7M12 14l3 7',
  check: 'M4 12.5 9.5 18 20 6.5',
  shield: 'M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6zM8.5 12l2.5 2.5 4.5-5',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  file: 'M6 3h9l5 5v13H6zM14 3v6h6',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 11v5M12 8v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
}
export type IconName = keyof typeof paths

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  )
}
