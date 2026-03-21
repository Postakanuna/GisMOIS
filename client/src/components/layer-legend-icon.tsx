import { useState, useEffect } from "react";
import { isHeatNetworkStyle, getHeatNetworkIconUrl, type HeatNetworkPointStyle } from "@/lib/heat-network-icons";

const SIZE = 12;

function getSvgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function applyColorToSvg(svgContent: string, color: string, size: number): string {
  let svg = svgContent;
  const svgTagMatch = svg.match(/<svg([^>]*)>/i);
  if (svgTagMatch) {
    let attrs = svgTagMatch[1];
    if (!/viewBox/i.test(attrs)) {
      const wm = attrs.match(/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      const hm = attrs.match(/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);
      attrs += wm && hm ? ` viewBox="0 0 ${wm[1]} ${hm[1]}"` : ` viewBox="0 0 24 24"`;
    }
    attrs = attrs.replace(/\bwidth\s*=\s*["'][^"']*["']/gi, "");
    attrs = attrs.replace(/\bheight\s*=\s*["'][^"']*["']/gi, "");
    attrs += ` width="${size}" height="${size}"`;
    svg = svg.replace(/<svg[^>]*>/i, `<svg${attrs}>`);
  }
  svg = svg.replace(/\{color\}/g, color).replace(/currentColor/gi, color);
  return svg;
}

function BasicShapeIcon({ pointStyle, color }: { pointStyle: string; color: string }) {
  const s = SIZE;
  const c = s / 2;
  const r = s / 2 - 1;

  switch (pointStyle) {
    case "circle":
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <circle cx={c} cy={c} r={r} fill={color} />
        </svg>
      );
    case "square":
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width={s - 2} height={s - 2} fill={color} />
        </svg>
      );
    case "diamond":
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <polygon points={`${c},1 ${s - 1},${c} ${c},${s - 1} 1,${c}`} fill={color} />
        </svg>
      );
    case "triangle":
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <polygon points={`${c},1 ${s - 1},${s - 1} 1,${s - 1}`} fill={color} />
        </svg>
      );
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.45;
        pts.push(`${c + rad * Math.cos(angle)},${c + rad * Math.sin(angle)}`);
      }
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <polygon points={pts.join(" ")} fill={color} />
        </svg>
      );
    }
    case "cross":
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <rect x={c - 1.5} y="1" width="3" height={s - 2} fill={color} />
          <rect x="1" y={c - 1.5} width={s - 2} height="3" fill={color} />
        </svg>
      );
    case "hexagon": {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        pts.push(`${c + r * Math.cos(angle)},${c + r * Math.sin(angle)}`);
      }
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <polygon points={pts.join(" ")} fill={color} />
        </svg>
      );
    }
    case "pentagon": {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = (2 * Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${c + r * Math.cos(angle)},${c + r * Math.sin(angle)}`);
      }
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <polygon points={pts.join(" ")} fill={color} />
        </svg>
      );
    }
    default:
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
          <circle cx={c} cy={c} r={r} fill={color} />
        </svg>
      );
  }
}

function LineIcon({ lineStyle, color }: { lineStyle: string; color: string }) {
  const s = SIZE;
  const y = s / 2;
  let strokeDasharray: string | undefined;
  if (lineStyle === "dashed") strokeDasharray = "3,2";
  else if (lineStyle === "dotted") strokeDasharray = "1,2";

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1={y} x2={s} y2={y} stroke={color} strokeWidth="2" strokeDasharray={strokeDasharray} strokeLinecap="round" />
    </svg>
  );
}

function PolygonIcon({ color }: { color: string }) {
  const s = SIZE;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width={s - 2} height={s - 2} fill={color} fillOpacity="0.45" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function CustomIconImg({ iconId, color }: { iconId: number; color: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/custom-icons/${iconId}`)
      .then(r => r.json())
      .then((data: { svgContent?: string }) => {
        if (data?.svgContent) {
          const colored = applyColorToSvg(data.svgContent, color, SIZE);
          setSrc(getSvgDataUrl(colored));
        }
      })
      .catch(() => {});
  }, [iconId, color]);

  if (!src) {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} xmlns="http://www.w3.org/2000/svg">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} fill={color} />
      </svg>
    );
  }

  return <img src={src} width={SIZE} height={SIZE} alt="" style={{ display: "block" }} />;
}

interface LayerLegendIconProps {
  geometryType: string;
  color: string;
  pointStyle?: string;
  lineStyle?: string;
  styleConfig?: any;
  customIconId?: number | null;
}

export function LayerLegendIcon({ geometryType, color, pointStyle = "circle", lineStyle = "solid", styleConfig, customIconId }: LayerLegendIconProps) {
  const sc = styleConfig as any;
  const isSimple = !sc || sc.renderer === "single" || sc.renderer === "simple";

  let resolvedColor = color;
  let resolvedPointStyle = pointStyle;
  let resolvedCustomIconId = customIconId;

  if (!isSimple && sc?.categorizedClasses?.[0]) {
    const first = sc.categorizedClasses[0];
    resolvedColor = first.style?.color || color;
    resolvedPointStyle = first.style?.pointStyle || pointStyle;
    resolvedCustomIconId = first.style?.customIconId ?? customIconId;
  } else if (!isSimple && sc?.graduatedClasses?.[0]) {
    resolvedColor = sc.graduatedClasses[0].style?.color || color;
  }

  if (geometryType === "LineString") {
    return <LineIcon lineStyle={lineStyle} color={resolvedColor} />;
  }

  if (geometryType === "Polygon") {
    return <PolygonIcon color={resolvedColor} />;
  }

  if (resolvedCustomIconId) {
    return <CustomIconImg iconId={resolvedCustomIconId} color={resolvedColor} />;
  }

  if (resolvedPointStyle && isHeatNetworkStyle(resolvedPointStyle)) {
    const url = getHeatNetworkIconUrl(resolvedPointStyle as HeatNetworkPointStyle, resolvedColor);
    return <img src={url} width={SIZE} height={SIZE} alt="" style={{ display: "block" }} />;
  }

  return <BasicShapeIcon pointStyle={resolvedPointStyle} color={resolvedColor} />;
}
