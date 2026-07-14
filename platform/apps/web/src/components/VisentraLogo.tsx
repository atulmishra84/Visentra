import { useId } from "react";

type VisentraLogoProps = {
  size?: number;
  className?: string;
  title?: string;
};

/** Visentra mark — V + visibility arc. */
export function VisentraLogo({ size = 40, className = "", title = "Visentra" }: VisentraLogoProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `visentra-grad-${uid}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#63F6E6" />
          <stop offset="1" stopColor="#41D6C3" />
        </linearGradient>
      </defs>
      <path
        d="M32 10c12.15 0 22 9.85 22 22"
        stroke={`url(#${gradId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M32 16c8.837 0 16 7.163 16 16"
        stroke={`url(#${gradId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx="48" cy="32" r="2.6" fill="#63F6E6" />
      <path
        d="M18 18 L32 48 L46 18"
        stroke={`url(#${gradId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="3.2" fill="#041018" stroke="#63F6E6" strokeWidth="1.6" />
    </svg>
  );
}
