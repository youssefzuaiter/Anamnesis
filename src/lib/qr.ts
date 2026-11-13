import qrcode from "qrcode-generator";

/**
 * A QR code as an inline SVG: dark modules on a white square with a four-module quiet zone, in fixed
 * colours, because scanners need dark on light even when the page is in dark mode. Pure.
 */
export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const quiet = 4;
  const total = size + quiet * 2;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const safe = label.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${safe}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}
