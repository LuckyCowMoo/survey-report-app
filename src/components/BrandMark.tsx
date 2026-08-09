interface Props {
  className?: string;
  title?: string;
}

/** Clean vector trace of the DampMaster mountain / pulse mark. */
export default function BrandMark({ className, title = "DampMaster" }: Props) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 150"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <path
        d="M24 86
           C48 52 66 44 86 64
           C98 78 104 98 122 90
           C150 76 160 18 202 16
           C244 14 252 58 270 82
           C286 102 312 90 338 72"
        stroke="currentColor"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
