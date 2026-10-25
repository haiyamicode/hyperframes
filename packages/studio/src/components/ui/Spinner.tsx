import type { SVGProps } from "react";

/** A plain ring with a turning arc; takes its colour from `currentColor`. */
export function Spinner(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
