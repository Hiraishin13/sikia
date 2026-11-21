const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5v.01M10.3 4.2L2.8 17.5a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
  hand: 'M8 13V6.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V12M14 12V6a1.5 1.5 0 013 0v8.5c0 3.6-2.4 6-5.5 6-2.2 0-3.7-1-4.8-2.7L5 14.2a1.5 1.5 0 012.4-1.7L8 13.5',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  person: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20c0-3.6 3-6 7-6s7 2.4 7 6',
  flip: 'M4 12a8 8 0 0113.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.6L4 15.5M4 20v-4.5h4.5',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  translate: 'M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  record: 'M12 20a8 8 0 100-16 8 8 0 000 16zM12 15a3 3 0 100-6 3 3 0 000 6z',
  flask: 'M9 3h6M10 3v6L4.8 18.2A2 2 0 006.5 21h11a2 2 0 001.7-2.8L14 9V3M7.5 15h9',
  lock:'M7 11V8a5 5 0 0110 0v3M5.5 11h13a1 1 0 011 1v7.5a1 1 0 01-1 1h-13a1 1 0 01-1-1V12a1 1 0 011-1z',
  copy: 'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM16 9V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3',
} as const

export type IconName = keyof typeof PATHS

/** Icônes au trait, héritent de la couleur du texte. Toujours accompagnées d'un libellé. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Marque : une personne vue de face sur une pastille terracotta, comme dans la maquette. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent-strong)" />
      <circle cx="16" cy="10.5" r="3.5" fill="#fffefb" />
      <path d="M8 24.5a8 6.5 0 0116 0z" fill="#fffefb" />
    </svg>
  )
}
