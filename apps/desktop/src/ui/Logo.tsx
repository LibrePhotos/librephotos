/** The LibrePhotos mark (three stacked diamonds), drawn in the current text colour. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const diamond = (top: number) => `M650 ${top} L1146 ${top + 496} L650 ${top + 992} L154 ${top + 496} Z`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="100 30 1100 1240"
      fill="none"
      stroke="currentColor"
      strokeWidth={46}
      aria-hidden="true"
      focusable="false"
    >
      <path d={diamond(55)} />
      <path d={diamond(148)} />
      <path d={diamond(242)} />
    </svg>
  );
}
