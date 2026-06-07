// ============================================================
// Réelgram — Icons (stroke, premium, consistent 1.7 weight)
// Ported verbatim from design-reference/project/data.jsx.
// ============================================================
import type { CSSProperties, ReactNode, SVGProps } from 'react';

export interface IcoProps extends SVGProps<SVGSVGElement> {
  d?: string;
  size?: number;
  sw?: number;
  fill?: string;
  children?: ReactNode;
}

const Ico = ({ d, size = 24, sw = 1.7, fill = 'none', children, ...p }: IcoProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

export type IconProps = Omit<IcoProps, 'd' | 'children'> & { style?: CSSProperties };

export const Icons = {
  search: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </Ico>
  ),
  plus: (p: IconProps) => <Ico d="M12 5v14M5 12h14" {...p} />,
  link: (p: IconProps) => (
    <Ico {...p}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </Ico>
  ),
  play: (p: IconProps) => (
    <Ico fill="currentColor" stroke="none" {...p}>
      <path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.5-6.5a1 1 0 0 0 0-1.72L9.52 4.64A1 1 0 0 0 8 5.5z" />
    </Ico>
  ),
  pause: (p: IconProps) => (
    <Ico fill="currentColor" stroke="none" {...p}>
      <rect x="7" y="5" width="3.4" height="14" rx="1.2" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1.2" />
    </Ico>
  ),
  back: (p: IconProps) => <Ico d="M15 5l-7 7 7 7" {...p} />,
  chevron: (p: IconProps) => <Ico d="M9 6l6 6-6 6" {...p} />,
  close: (p: IconProps) => <Ico d="M6 6l12 12M18 6L6 18" {...p} />,
  library: (p: IconProps) => (
    <Ico {...p}>
      <rect x="3" y="4" width="18" height="14" rx="3" />
      <path d="M3 9h18" />
      <path d="M8 18v2M16 18v2" />
    </Ico>
  ),
  grid: (p: IconProps) => (
    <Ico {...p}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </Ico>
  ),
  tag: (p: IconProps) => (
    <Ico {...p}>
      <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 11.5z" />
      <circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
    </Ico>
  ),
  trash: (p: IconProps) => (
    <Ico {...p}>
      <path d="M4 7h16" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </Ico>
  ),
  edit: (p: IconProps) => (
    <Ico {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Ico>
  ),
  check: (p: IconProps) => <Ico d="M5 12.5l4.5 4.5L19 7" {...p} />,
  retry: (p: IconProps) => (
    <Ico {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
      <path d="M3 14.5V19h4.5" />
    </Ico>
  ),
  sparkle: (p: IconProps) => (
    <Ico {...p}>
      <path d="M12 3l1.8 4.9L19 9.7l-4.2 1.8L12 16l-1.8-4.5L6 9.7l5.2-1.8z" />
      <path d="M19 15l.7 1.9L21.5 18l-1.8.7L19 21l-.7-2.3L16.5 18l1.8-.7z" />
    </Ico>
  ),
  insta: (p: IconProps) => (
    <Ico {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </Ico>
  ),
  clock: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Ico>
  ),
  volume: (p: IconProps) => (
    <Ico {...p}>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </Ico>
  ),
  expand: (p: IconProps) => (
    <Ico {...p}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    </Ico>
  ),
  more: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Ico>
  ),
  signal: (p: IconProps) => (
    <Ico fill="currentColor" stroke="none" {...p}>
      <rect x="2" y="11" width="3" height="6" rx="1" />
      <rect x="7" y="8" width="3" height="9" rx="1" />
      <rect x="12" y="5" width="3" height="12" rx="1" />
      <rect x="17" y="2.5" width="3" height="14.5" rx="1" />
    </Ico>
  ),
} satisfies Record<string, (p: IconProps) => ReactNode>;

export type IconName = keyof typeof Icons;
