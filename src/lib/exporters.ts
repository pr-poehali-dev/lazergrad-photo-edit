// ── DXF & LBRN2 exporters (pure browser, no deps) ────────────────────────

export interface ExportOptions {
  widthMm: number;
  heightMm: number;
  dpi: number;
  power: number;
  speed: number;
  passes: number;
  bitDepth: 1 | 8;
  threshold: number;
  material: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function downloadText(content: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getCanvasPixels(canvas: HTMLCanvasElement): { pixels: Uint8ClampedArray; w: number; h: number } {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: imageData.data, w: canvas.width, h: canvas.height };
}

function pxToMm(px: number, dpi: number) {
  return (px / dpi) * 25.4;
}

// ── DXF Generator ─────────────────────────────────────────────────────────
// Generates a DXF R12 file with polyline runs for dark pixels (engraving paths)

export function exportDXF(canvas: HTMLCanvasElement, opts: ExportOptions): void {
  const { pixels, w, h } = getCanvasPixels(canvas);
  const mmW = opts.widthMm || pxToMm(w, opts.dpi);
  const mmH = opts.heightMm || pxToMm(h, opts.dpi);
  const scaleX = mmW / w;
  const scaleY = mmH / h;
  const threshold = opts.bitDepth === 1 ? opts.threshold : 128;

  const lines: string[] = [];

  // DXF header
  lines.push(
    '0\nSECTION',
    '2\nHEADER',
    '9\n$ACADVER',
    '1\nAC1009',
    '9\n$INSUNITS',
    '70\n4',
    '0\nENDSEC',
    '0\nSECTION',
    '2\nTABLES',
    '0\nTABLE',
    '2\nLAYER',
    '70\n2',
    '0\nLAYER',
    '2\nENGRAVE',
    '70\n0',
    '62\n7',
    '6\nCONTINUOUS',
    '0\nLAYER',
    '2\nCUT',
    '70\n0',
    '62\n1',
    '6\nCONTINUOUS',
    '0\nENDTAB',
    '0\nENDSEC',
    '0\nSECTION',
    '2\nENTITIES',
  );

  // Scan each row — emit horizontal line segments for dark pixels
  for (let row = 0; row < h; row++) {
    let segStart = -1;
    for (let col = 0; col <= w; col++) {
      const idx = (row * w + col) * 4;
      const lum = col < w
        ? Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2])
        : 256;
      const isDark = lum < threshold;

      if (isDark && segStart === -1) {
        segStart = col;
      } else if (!isDark && segStart !== -1) {
        const x1 = +(segStart * scaleX).toFixed(4);
        const x2 = +(col * scaleX).toFixed(4);
        const y = +((h - row) * scaleY).toFixed(4); // flip Y for DXF coords
        lines.push(
          '0\nLINE',
          '8\nENGRAVE',
          `10\n${x1}`,
          `20\n${y}`,
          `30\n0.0`,
          `11\n${x2}`,
          `21\n${y}`,
          `31\n0.0`,
        );
        segStart = -1;
      }
    }
  }

  // Bounding box cut rectangle
  lines.push(
    '0\nLINE', '8\nCUT', `10\n0.0`, `20\n0.0`, `30\n0.0`, `11\n${mmW.toFixed(4)}`, `21\n0.0`, `31\n0.0`,
    '0\nLINE', '8\nCUT', `10\n${mmW.toFixed(4)}`, `20\n0.0`, `30\n0.0`, `11\n${mmW.toFixed(4)}`, `21\n${mmH.toFixed(4)}`, `31\n0.0`,
    '0\nLINE', '8\nCUT', `10\n${mmW.toFixed(4)}`, `20\n${mmH.toFixed(4)}`, `30\n0.0`, `11\n0.0`, `21\n${mmH.toFixed(4)}`, `31\n0.0`,
    '0\nLINE', '8\nCUT', `10\n0.0`, `20\n${mmH.toFixed(4)}`, `30\n0.0`, `11\n0.0`, `21\n0.0`, `31\n0.0`,
  );

  lines.push('0\nENDSEC', '0\nEOF');

  downloadText(lines.join('\n'), 'lazergrad_export.dxf', 'application/dxf');
}

// ── LBRN2 Generator ───────────────────────────────────────────────────────
// Generates a LightBurn project file (.lbrn2) with an image layer

export function exportLBRN2(canvas: HTMLCanvasElement, opts: ExportOptions): void {
  const { w, h } = getCanvasPixels(canvas);
  const mmW = opts.widthMm || pxToMm(w, opts.dpi);
  const mmH = opts.heightMm || pxToMm(h, opts.dpi);

  // Embed image as base64 PNG
  const pngDataUrl = canvas.toDataURL('image/png');
  const base64 = pngDataUrl.split(',')[1];

  const powerPct = opts.power / 100;
  const speedMms = opts.speed;
  const dpi = opts.dpi;
  const passes = opts.passes;

  // LBRN2 is XML-based
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.7.00" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
  <Thumbnail Source="${pngDataUrl}" />
  <VariableText>
    <Start value="0" />
    <End value="9" />
    <Current value="0" />
    <Step value="1" />
    <Kind value="0" />
    <AutoAdvance value="False" />
  </VariableText>
  <UIPrefs>
    <Optimize_ByLayer value="True" />
    <Optimize_ByGroup value="True" />
    <Optimize_ByPriority value="True" />
    <Optimize_WhitespaceRemoval value="True" />
    <Optimize_InnerToOuter value="True" />
    <Optimize_AllDirections value="False" />
    <Optimize_CrossingReduction value="False" />
    <Optimize_ByDirection value="False" />
    <Optimize_OptimalDirection value="False" />
  </UIPrefs>
  <CutSetting type="Image">
    <index value="0" />
    <name value="ENGRAVE — ${opts.material}" />
    <priority value="0" />
    <runLinkPath value="" />
    <minPower value="${Math.round(powerPct * 0.8 * 100)}" />
    <maxPower value="${Math.round(powerPct * 100)}" />
    <minPower2 value="${Math.round(powerPct * 0.8 * 100)}" />
    <maxPower2 value="${Math.round(powerPct * 100)}" />
    <speed value="${speedMms}" />
    <passes value="${passes}" />
    <zStep value="0" />
    <dotMode value="False" />
    <dotTime value="1" />
    <dotSpacing value="0" />
    <useAir value="False" />
    <zOffset value="0" />
    <perforate value="False" />
    <perforateDist value="0" />
    <perforateOn value="0" />
    <negative value="False" />
    <linkPath value="False" />
    <OutputMode value="1" />
    <biDir value="True" />
    <overScan value="2" />
    <overScanMode value="0" />
    <dpi value="${dpi}" />
    <scanAngle value="0" />
    <doOutput value="True" />
    <Show value="True" />
    <tabCount value="0" />
    <tabSize value="3" />
  </CutSetting>
  <CutSetting type="Cut">
    <index value="1" />
    <name value="CUT — border" />
    <priority value="1" />
    <minPower value="80" />
    <maxPower value="100" />
    <speed value="20" />
    <passes value="1" />
    <doOutput value="False" />
    <Show value="True" />
  </CutSetting>
  <Shape type="Bitmap" CutIndex="0">
    <XForm>1 0 0 1 ${(mmW / 2).toFixed(4)} ${(mmH / 2).toFixed(4)}</XForm>
    <GroupId value="-1" />
    <W value="${mmW.toFixed(4)}" />
    <H value="${mmH.toFixed(4)}" />
    <StretchX value="1" />
    <StretchY value="1" />
    <Src>${base64}</Src>
    <Gamma value="1" />
    <EnhanceAmount value="0" />
    <EnhanceRadius value="0" />
    <EnhanceDenoise value="0" />
    <Passthrough value="False" />
    <DitheringMode value="${opts.bitDepth === 1 ? 1 : 0}" />
    <UseGamma value="False" />
  </Shape>
  <Shape type="Rect" CutIndex="1">
    <XForm>1 0 0 1 ${(mmW / 2).toFixed(4)} ${(mmH / 2).toFixed(4)}</XForm>
    <GroupId value="-1" />
    <W value="${mmW.toFixed(4)}" />
    <H value="${mmH.toFixed(4)}" />
    <Cr value="0" />
  </Shape>
  <Notes HasNotes="True" OpenNotes="False">LAZERGRAD Export | DPI:${dpi} | Power:${opts.power}% | Speed:${speedMms}mm/s | Material:${opts.material} | Passes:${passes}</Notes>
</LightBurnProject>`;

  downloadText(xml, 'lazergrad_export.lbrn2', 'application/xml');
}
