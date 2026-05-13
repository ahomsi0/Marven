interface MarvenLogoProps {
  size?: number;
  className?: string;
}

/**
 * Marven logo — single hexagon ring with a Y-shaped neural node inside.
 * Matches the app icon exactly.
 */
export function MarvenLogo({ size = 24, className = "" }: MarvenLogoProps) {
  // Pointy-top hexagon vertices (vertex at 12 o'clock)
  const R = 13;   // hex radius
  const cx = 16, cy = 16;
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  });
  const hexStr = hexPts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

  // Y-shape nodes — sit comfortably inside the hex
  const nodes = [
    [cx - 5.8, cy - 5.2],   // top-left
    [cx + 5.8, cy - 5.2],   // top-right
    [cx,       cy + 7.2],   // bottom
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Marven"
    >
      {/* Single hexagon ring */}
      <polygon
        points={hexStr}
        stroke="#5b9cf6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
        opacity="0.85"
      />

      {/* Arms from centre to each node */}
      {nodes.map(([nx, ny], i) => (
        <line
          key={i}
          x1={cx} y1={cy}
          x2={nx} y2={ny}
          stroke="#5b9cf6"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.9"
        />
      ))}

      {/* Node dots */}
      {nodes.map(([nx, ny], i) => (
        <circle key={i} cx={nx} cy={ny} r="1.8" fill="#5b9cf6" opacity="0.95" />
      ))}

      {/* Centre dot */}
      <circle cx={cx} cy={cy} r="1.8" fill="#5b9cf6" opacity="0.95" />
    </svg>
  );
}
