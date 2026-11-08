/**
 * The application logo.
 *
 * The SVG is the same artwork the application icon is generated from
 * (build/assets/logo.svg). Two variants exist:
 *
 *  - `tile` — the full icon: the dark tile with the glowing rim and the
 *    emblem inside. This is what the header shows, because the emblem
 *    alone is unreadable at 22 px;
 *  - `emblem` — the emblem without the tile, for bigger placements.
 *
 * The artwork is inline, so the renderer needs no image file at runtime.
 */
export interface LogoProps {
  /** The size of the square, in pixels. */
  size?: number
  /** Which part of the artwork to draw. */
  variant?: 'tile' | 'emblem'
}

export function Logo({ size = 22, variant = 'tile' }: LogoProps) {
  const uid = `logo-${variant}`

  if (variant === 'emblem') {
    return (
      <svg
        className="logo"
        width={size}
        height={size}
        viewBox="126 98 250 250"
        role="img"
        aria-label="ReliquarySSH"
      >
        <defs>
          <linearGradient
            id={`${uid}-fill`}
            x1="135"
            y1="0"
            x2="367"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#A04CF0" />
            <stop offset="0.55" stopColor="#6860E6" />
            <stop offset="1" stopColor="#2586EB" />
          </linearGradient>
        </defs>

        <path
          d="M 143 151 L 244 96 C 250 92.8, 256 92.4, 262 96 L 359 153
             C 363 155.5, 366 160, 365.5 165 L 364 220 L 335 202 L 324 181 L 261 142
             C 256 139.3, 251 139.8, 246 142.7 L 183 181 C 179 183.6, 177 188, 177 193
             L 178 313 L 136 291 L 135 167 C 135 160.5, 137.2 154.6, 143 151 Z"
          fill={`url(#${uid}-fill)`}
        />
        <path
          d="M 203 278 L 244 301 C 250 304.5, 255 304.7, 261 301 L 326 263 L 365 286
             C 368 287.7, 367 291, 363.5 292.5 L 260 351 C 256 353.4, 250 354, 245.5 351
             L 205 327 C 202.8 325.6, 202 323.5, 202 320.5 Z"
          fill={`url(#${uid}-fill)`}
        />
        <path
          d="M 232 192 L 268 226 L 232 260"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="19"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="282" y="248" width="46" height="14" rx="3.5" fill="#EFF2C6" />
      </svg>
    )
  }

  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="ReliquarySSH"
    >
      <defs>
        <linearGradient id={`${uid}-tile`} x1="247" y1="44" x2="247" y2="390" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0A0F1E" />
          <stop offset="0.55" stopColor="#070B18" />
          <stop offset="1" stopColor="#030711" />
        </linearGradient>
        <linearGradient id={`${uid}-rim`} x1="70" y1="380" x2="420" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7A2BC8" />
          <stop offset="0.48" stopColor="#4A45B8" />
          <stop offset="1" stopColor="#173653" />
        </linearGradient>
        <linearGradient id={`${uid}-fill`} x1="135" y1="0" x2="367" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A04CF0" />
          <stop offset="0.55" stopColor="#6860E6" />
          <stop offset="1" stopColor="#2586EB" />
        </linearGradient>
      </defs>

      {/* The tile is shifted so it sits in the middle of the canvas. */}
      <g transform="translate(9.5 39)">
        <rect x="64" y="44" width="365" height="346" rx="78" fill={`url(#${uid}-tile)`} />
        <rect
          x="64"
          y="44"
          width="365"
          height="346"
          rx="78"
          fill="none"
          stroke={`url(#${uid}-rim)`}
          strokeWidth="4"
        />

      <path
        d="M 143 151 L 244 96 C 250 92.8, 256 92.4, 262 96 L 359 153
           C 363 155.5, 366 160, 365.5 165 L 364 220 L 335 202 L 324 181 L 261 142
           C 256 139.3, 251 139.8, 246 142.7 L 183 181 C 179 183.6, 177 188, 177 193
           L 178 313 L 136 291 L 135 167 C 135 160.5, 137.2 154.6, 143 151 Z"
        fill={`url(#${uid}-fill)`}
      />
      <path
        d="M 203 278 L 244 301 C 250 304.5, 255 304.7, 261 301 L 326 263 L 365 286
           C 368 287.7, 367 291, 363.5 292.5 L 260 351 C 256 353.4, 250 354, 245.5 351
           L 205 327 C 202.8 325.6, 202 323.5, 202 320.5 Z"
        fill={`url(#${uid}-fill)`}
      />
      <path
        d="M 220 202 L 246.5 224.5 L 220 248"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="13.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="259" y="244.5" width="38" height="10.5" rx="2.5" fill="#EFF2C6" />
      </g>
    </svg>
  )
}
