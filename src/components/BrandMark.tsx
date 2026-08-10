interface Props {
  className?: string;
  title?: string;
  /** When true, include stroke layer used by the intro animation. */
  intro?: boolean;
}

const LOGO_PATH =
  "m0,36.5s.96-.02,3.09-1.18c3.39-1.86,13.01-8.02,15.76-9.31s4.09-2.08,6.06-1.91,2.69.22,3.42,1.85.9,3.14,1.23,4.77.29,1.59.38,1.97c.03.11.19.32.19.32,0,0,.29-.03.42-.06.45-.12.64-.23,1.64-1.81s3.72-5.91,4.96-7.85,8.23-13.89,12.97-18S57.18,0,61.79,0s9.28,2.59,11.08,4.97c2.3,3.05,10.73,16.54,13.38,19.2s6.6,7.26,8.37,8.48,3.15,1.53,4.35,1.54c3.86.01,5.92-2.94,8.57-5.28s5.43-4.23,8.59-4.17,6.51,2.08,8.65,4.61,4.19,5.11,4.86,7.9c.43,1.77.21,2.27.21,2.27-.11,0-.61-.26-.7-.32-.39-.23-2.91-2.18-3.72-2.98s-3.02-2.94-4.13-3.71-2.14-1.65-4.01-1.72c-2.44-.09-5.01,3.28-7.22,5.82s-7.17,5.89-11.79,6.08c-6.81.28-13.09-4.89-17.05-8.61s-13.36-16.22-15.77-18.86c-1.38-1.51-2.09-2.55-3.72-2.52-2.01.04-4.47,2.12-8.65,7.11s-7.74,10.55-11,14.21-7.91,9.17-11.86,8.94-5.44-1.78-6.42-4.99-1.25-4.62-1.45-5.59c-.12-.59-.24-.56-.38-.52-.46.1-10.31,4.37-13.58,5.09s-4.74,1.45-6.41.97c-1.21-.35-1.67-.77-2-1.43Z";

/** Official DampMaster mark (from DM logo.svg). */
export default function BrandMark({
  className,
  title = "DampMaster",
  intro = false
}: Props) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 129.92 42.97"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      {/* Same path as the solid mark — used as a stroked loader, then drawn out.
          Keeping one geometry avoids a spinner→logo “LOD” pop. */}
      {intro && (
        <path
          className="intro-mark-stroke"
          d={LOGO_PATH}
          fill="none"
          stroke="#d12d26"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength="1"
        />
      )}

      <g className={intro ? "intro-mark-solid" : undefined}>
        <path fill="#d12d26" d={LOGO_PATH} />
        <rect fill="#d12d26" x="56.4" y="27.14" width="3.69" height="4.22" />
        <rect
          className={intro ? "intro-window-pane intro-window-portal" : undefined}
          fill="#c8c8c8"
          x="61.84"
          y="27.14"
          width="3.82"
          height="4.22"
        />
        <rect
          className={intro ? "intro-window-pane" : undefined}
          fill="#c8c8c8"
          x="56.4"
          y="32.61"
          width="3.69"
          height="4.22"
        />
        <rect
          className={intro ? "intro-window-pane" : undefined}
          fill="#c8c8c8"
          x="61.84"
          y="32.61"
          width="3.82"
          height="4.22"
        />
      </g>
    </svg>
  );
}
