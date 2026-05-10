import { useState, useRef, useCallback, useEffect } from 'react';
import Icon from '@/components/ui/icon';
import { exportDXF, exportLBRN2 } from '@/lib/exporters';
import { processImage, renderHeightMapPreview, cropCanvas, type HeightMapPreset, type DitheringMode, type GravureStyle, type ProcessorParams } from '@/lib/imageProcessor';

// ── Types ──────────────────────────────────────────────────────────────────
type Material = 'plywood' | 'wood' | 'steel' | 'ceramic' | 'glass' | 'leather';
type ExportFormat = 'PNG' | 'BMP' | 'DXF' | 'LBRN2';
type Tab = 'editor' | 'retouch' | 'gravure' | 'heightmap' | 'preview' | 'settings' | 'export';
type PreviewMode = 'result' | 'heatmap';

interface CropRect { x: number; y: number; w: number; h: number }
interface CropDrag { startX: number; startY: number; active: boolean }

// ── Constants ─────────────────────────────────────────────────────────────
const MATERIALS: { id: Material; label: string; color: string; texture: string }[] = [
  { id: 'plywood',  label: 'Фанера',      color: '#c8a96e', texture: 'repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(0,0,0,0.08) 3px,rgba(0,0,0,0.08) 4px)' },
  { id: 'wood',     label: 'Дерево',      color: '#8b5e3c', texture: 'repeating-linear-gradient(10deg,transparent,transparent 4px,rgba(0,0,0,0.12) 4px,rgba(0,0,0,0.12) 5px)' },
  { id: 'steel',    label: 'Нержавейка',  color: '#9aa0a6', texture: 'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 1px,transparent 1px,transparent 4px)' },
  { id: 'ceramic',  label: 'Керамика',    color: '#e8e0d5', texture: 'none' },
  { id: 'glass',    label: 'Стекло',      color: '#b8d4e0', texture: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.1) 0,rgba(255,255,255,0.1) 1px,transparent 1px,transparent 6px)' },
  { id: 'leather',  label: 'Кожа',        color: '#5c3d2e', texture: 'repeating-linear-gradient(60deg,rgba(0,0,0,0.1) 0,rgba(0,0,0,0.1) 1px,transparent 1px,transparent 5px)' },
];

const HEIGHT_MAP_PRESETS: { id: HeightMapPreset; label: string; desc: string }[] = [
  { id: 'linear',   label: 'Линейный',   desc: 'Прямое отображение яркости в глубину' },
  { id: 'inverted', label: 'Инверсия',   desc: 'Тёмные участки — глубже, светлые — мельче' },
  { id: 'gamma',    label: 'Гамма-кор.', desc: 'Гамма-скорректированная глубина' },
  { id: 'relief',   label: 'Рельеф',     desc: 'Усиление рёбер, объёмный эффект' },
  { id: 'emboss',   label: 'Эмбосс',     desc: 'Чеканка / тиснение, диагональный перепад' },
  { id: 'solarize', label: 'Соляриз.',   desc: 'Синусоидальная волна — двойные контуры' },
];

const DITHER_MODES: { id: DitheringMode; label: string; desc: string }[] = [
  { id: 'none',            label: 'Нет',             desc: 'Простой порог' },
  { id: 'threshold',       label: 'Порог',            desc: 'Жёсткий чёрно-белый' },
  { id: 'floyd-steinberg', label: 'Флойд-Стейнберг', desc: 'Лучший для фото, диффузия ошибки' },
  { id: 'atkinson',        label: 'Аткинсон',        desc: 'Резкий, чёткие края' },
];

const GRAVURE_STYLES: { id: GravureStyle; label: string; desc: string }[] = [
  { id: 'lines',      label: 'Линии',      desc: 'Классический линейный экран' },
  { id: 'crosshatch', label: 'Штриховка',  desc: 'Перекрёстная штриховка' },
  { id: 'dots',       label: 'Точки',      desc: 'Полутоновый растр (halftone)' },
  { id: 'mezzotint',  label: 'Меццо-тинт', desc: 'Зернистая текстура, случайный паттерн' },
  { id: 'woodcut',    label: 'Ксилография','desc': 'Имитация гравюры на дереве' },
];

const DEFAULT_PARAMS: ProcessorParams = {
  contrast: 0,
  brightness: 0,
  sharpness: 0,
  grayscale: 100,
  threshold: 128,
  bitDepth: 8,
  dithering: 'none',
  heightMap: 'linear',
  heightMapStrength: 70,
  gamma: 1.0,
  invert: false,
  // retouch
  skinSmoothing: 0,
  skinTone: 60,
  autoRetouch: false,
  retouchStrength: 50,
  noiseReduction: 0,
  // gravure
  gravureEnabled: false,
  gravureStyle: 'lines',
  gravureLineSpacing: 6,
  gravureLineAngle: 45,
  gravureDepth: 70,
  gravureContrast: 50,
};

const ENGRAVE_SETTINGS = [
  { id: 'power',  label: 'Мощность', unit: '%',    min: 1,  max: 100,  default: 60  },
  { id: 'speed',  label: 'Скорость', unit: 'мм/с', min: 10, max: 1000, default: 200 },
  { id: 'dpi',    label: 'DPI',      unit: '',     min: 75, max: 1000, default: 254 },
  { id: 'passes', label: 'Проходов', unit: 'раз',  min: 1,  max: 10,   default: 1   },
];

// ── Slider ────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, unit = '', step = 1, onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="section-label">{label}</span>
        <span className="value-mono">{typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-[#1e1e1e] appearance-none cursor-pointer"
        style={{ accentColor: 'var(--laser)' }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-[#2e2e2e]">{min}</span>
        <span className="text-[10px] text-[#2e2e2e]">{max}</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function Index() {
  const [tab, setTab] = useState<Tab>('editor');
  const [params, setParams] = useState<ProcessorParams>(DEFAULT_PARAMS);
  const [material, setMaterial] = useState<Material>('plywood');
  const [imageFile, setImageFile] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [engraveSettings, setEngraveSettings] = useState<Record<string, number>>({
    power: 60, speed: 200, dpi: 254, passes: 1,
  });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result');
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropDrag, setCropDrag] = useState<CropDrag>({ startX: 0, startY: 0, active: false });
  const cropOverlayRef = useRef<HTMLDivElement>(null);

  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const heatCanvasRef = useRef<HTMLCanvasElement>(null);

  const setParam = <K extends keyof ProcessorParams>(key: K, value: ProcessorParams[K]) =>
    setParams(p => ({ ...p, [key]: value }));

  // Load source image into hidden source canvas
  const loadSource = useCallback((url: string) => {
    const canvas = sourceCanvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = url;
  }, []);

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setImageFile(url);
    setImageName(file.name);
    setPanOffset({ x: 0, y: 0 });
    setZoom(1);
    setCropRect(null);
    setCropMode(false);
    setTimeout(() => loadSource(url), 50);
  }, [loadSource]);

  // Apply crop: commits cropRect to source canvas
  const applyCrop = useCallback(() => {
    if (!cropRect || !sourceCanvasRef.current) return;
    const src = sourceCanvasRef.current;
    const { x, y, w, h } = cropRect;
    if (w < 4 || h < 4) return;
    const cropped = cropCanvas(src, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    src.width = cropped.width;
    src.height = cropped.height;
    src.getContext('2d')!.drawImage(cropped, 0, 0);
    setCropRect(null);
    setCropMode(false);
    // trigger reprocess
    if (outputCanvasRef.current) processImage(src, outputCanvasRef.current, params);
    if (heatCanvasRef.current)   renderHeightMapPreview(src, heatCanvasRef.current, params);
  }, [cropRect, params]);

  // Crop overlay mouse handlers (pixel coords relative to displayed canvas)
  const getCropCanvasCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget.getBoundingClientRect();
    const src = sourceCanvasRef.current!;
    const scaleX = src.width  / el.width;
    const scaleY = src.height / el.height;
    return {
      x: (e.clientX - el.left) * scaleX,
      y: (e.clientY - el.top)  * scaleY,
    };
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  // Re-process whenever params or image changes
  useEffect(() => {
    if (!imageFile || !sourceCanvasRef.current || !outputCanvasRef.current) return;
    if (sourceCanvasRef.current.width === 0) return;
    processImage(sourceCanvasRef.current, outputCanvasRef.current, params);
    if (heatCanvasRef.current) {
      renderHeightMapPreview(sourceCanvasRef.current, heatCanvasRef.current, params);
    }
  }, [params, imageFile]);

  // Re-process after source canvas is ready
  useEffect(() => {
    if (!imageFile) return;
    const id = setTimeout(() => {
      if (sourceCanvasRef.current && outputCanvasRef.current && sourceCanvasRef.current.width > 0) {
        processImage(sourceCanvasRef.current, outputCanvasRef.current, params);
        if (heatCanvasRef.current) {
          renderHeightMapPreview(sourceCanvasRef.current, heatCanvasRef.current, params);
        }
      }
    }, 120);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFile]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, ox: panOffset.x, oy: panOffset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanOffset({
      x: panStart.current.ox + (e.clientX - panStart.current.x),
      y: panStart.current.oy + (e.clientY - panStart.current.y),
    });
  };
  const handleMouseUp = () => setIsPanning(false);
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(8, Math.max(0.1, z - e.deltaY * 0.001)));
  };

  const currentMaterial = MATERIALS.find(m => m.id === material)!;

  const exportFile = (fmt: ExportFormat) => {
    if (!outputCanvasRef.current || !imageFile) return;
    const opts = {
      widthMm: 0, heightMm: 0,
      dpi: engraveSettings.dpi,
      power: engraveSettings.power,
      speed: engraveSettings.speed,
      passes: engraveSettings.passes,
      bitDepth: params.bitDepth,
      threshold: params.threshold,
      material: currentMaterial.label,
    };
    setExporting(fmt);
    setExportDone(null);
    setTimeout(() => {
      try {
        if (fmt === 'PNG' || fmt === 'BMP') {
          const link = document.createElement('a');
          link.download = `lazergrad_export.png`;
          link.href = outputCanvasRef.current!.toDataURL('image/png');
          link.click();
        } else if (fmt === 'DXF') {
          exportDXF(outputCanvasRef.current!, opts);
        } else if (fmt === 'LBRN2') {
          exportLBRN2(outputCanvasRef.current!, opts);
        }
        setExportDone(fmt);
      } finally {
        setExporting(null);
        setTimeout(() => setExportDone(null), 3000);
      }
    }, 50);
  };

  // Active display canvas
  const displayCanvas = previewMode === 'heatmap' ? heatCanvasRef : outputCanvasRef;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col relative overflow-hidden">

      {/* Hidden source canvas */}
      <canvas ref={sourceCanvasRef} className="hidden" />
      {/* Hidden heatmap canvas */}
      <canvas ref={heatCanvasRef} className="hidden" />

      {/* ── Header ── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-[#1e1e1e] bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 relative flex items-center justify-center">
            <div className="absolute inset-0 bg-laser rounded-sm opacity-20 animate-pulse-laser" />
            <Icon name="Zap" size={16} className="text-laser relative z-10" />
          </div>
          <div>
            <h1 className="font-oswald text-lg font-bold tracking-[0.15em] text-white leading-none">
              LAZER<span className="text-laser">GRAD</span>
            </h1>
            <p className="text-[9px] text-[#444] tracking-[0.3em] font-mono uppercase">Laser Engraving Studio</p>
          </div>
        </div>

        <nav className="flex gap-0 border border-[#1e1e1e]">
          {([
            { id: 'editor',    icon: 'SlidersHorizontal', label: 'РЕДАКТОР' },
            { id: 'retouch',   icon: 'Sparkles',          label: 'РЕТУШЬ' },
            { id: 'gravure',   icon: 'PenTool',           label: 'ГРАВЮРА' },
            { id: 'heightmap', icon: 'Mountain',          label: 'ВЫСОТЫ' },
            { id: 'preview',   icon: 'Eye',               label: 'МАТЕРИАЛ' },
            { id: 'settings',  icon: 'Settings2',         label: 'НАСТРОЙКИ' },
            { id: 'export',    icon: 'Download',          label: 'ЭКСПОРТ' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-[11px] font-oswald font-medium tracking-[0.12em] transition-all ${
                tab === t.id ? 'bg-laser text-white' : 'text-[#555] hover:text-[#aaa] hover:bg-[#141414]'
              }`}
            >
              <Icon name={t.icon} size={12} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-laser animate-pulse-laser" />
          <span className="text-[10px] font-mono text-[#444]">SYS ONLINE</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative z-10">

        {/* LEFT — Canvas */}
        <div className="flex-1 flex flex-col border-r border-[#1a1a1a]">

          {/* Toolbar */}
          {imageFile && (
            <div className="flex items-center gap-0 border-b border-[#181818] bg-[#0c0c0c] px-4 py-2 flex-wrap gap-y-1">
              <span className="section-label mr-3">ВИД:</span>
              {([
                { id: 'result',  label: 'Результат',   icon: 'ScanLine' },
                { id: 'heatmap', label: 'Карта высот',  icon: 'Thermometer' },
              ] as const).map(m => (
                <button key={m.id} onClick={() => { setPreviewMode(m.id); setCropMode(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-oswald tracking-wider mr-1 transition-all border ${
                    previewMode === m.id && !cropMode
                      ? 'border-laser text-laser bg-[#150000]'
                      : 'border-[#1e1e1e] text-[#444] hover:border-[#333] hover:text-[#777]'
                  }`}
                >
                  <Icon name={m.icon} size={11} />{m.label.toUpperCase()}
                </button>
              ))}

              <div className="w-px h-5 bg-[#1e1e1e] mx-2" />
              <span className="section-label mr-2">ИНСТРУМЕНТЫ:</span>

              {/* Crop toggle */}
              <button
                onClick={() => { setCropMode(c => !c); setCropRect(null); setPreviewMode('result'); }}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-oswald tracking-wider mr-1 transition-all border ${
                  cropMode ? 'border-laser text-laser bg-[#150000]' : 'border-[#1e1e1e] text-[#444] hover:border-[#333] hover:text-[#777]'
                }`}
              >
                <Icon name="Crop" size={11} />ОБРЕЗКА
              </button>

              {cropMode && cropRect && (
                <>
                  <button onClick={applyCrop} className="btn-laser px-3 py-1 text-[10px] mr-1">
                    <Icon name="Check" size={10} className="inline mr-1" />ПРИМЕНИТЬ
                  </button>
                  <button onClick={() => setCropRect(null)} className="btn-ghost-steel px-3 py-1 text-[10px]">
                    СБРОС
                  </button>
                </>
              )}

              {cropMode && (
                <span className="text-[9px] text-[#444] ml-2 font-mono">
                  {cropRect ? `${Math.round(cropRect.w)}×${Math.round(cropRect.h)} px` : 'нарисуйте область'}
                </span>
              )}

              {previewMode === 'heatmap' && !cropMode && (
                <div className="ml-auto flex items-center gap-1">
                  <div className="w-24 h-2" style={{ background: 'linear-gradient(to right, #0a0a1e, #1414b4, #00c8b4, #c8dc00, #ff3c00)' }} />
                  <span className="text-[9px] text-[#333] ml-1">0%→100%</span>
                </div>
              )}
            </div>
          )}

          <div
            className="flex-1 relative overflow-hidden bg-[#0c0c0c] select-none"
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            onMouseDown={cropMode ? undefined : handleMouseDown}
            onMouseMove={cropMode ? undefined : handleMouseMove}
            onMouseUp={cropMode ? undefined : handleMouseUp}
            onMouseLeave={cropMode ? undefined : handleMouseUp}
            onWheel={cropMode ? undefined : handleWheel}
            style={{ cursor: cropMode ? 'crosshair' : isPanning ? 'grabbing' : imageFile ? 'grab' : 'default' }}
          >
            {showGrid && (
              <div className="absolute inset-0 pointer-events-none opacity-[0.05]" style={{
                backgroundImage: 'linear-gradient(#e8000a 1px,transparent 1px),linear-gradient(90deg,#e8000a 1px,transparent 1px)',
                backgroundSize: '40px 40px',
              }} />
            )}

            {!imageFile && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 border border-[#222] flex items-center justify-center relative">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-laser" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-laser" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-laser" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-laser" />
                    <Icon name="ImagePlus" size={28} className="text-[#333]" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-oswald text-[#444] text-sm tracking-[0.2em] uppercase mb-1">Загрузить изображение</p>
                  <p className="text-[10px] text-[#2a2a2a] tracking-widest">Перетащите файл или нажмите кнопку</p>
                </div>
                <button onClick={() => fileInputRef.current?.click()} className="btn-laser px-6 py-2 text-xs">
                  <Icon name="Upload" size={12} className="inline mr-2" />Выбрать файл
                </button>
              </div>
            )}

            {imageFile && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  style={{ transform: `translate(${panOffset.x}px,${panOffset.y}px) scale(${zoom})`, transition: isPanning ? 'none' : 'transform 0.05s', position: 'relative' }}
                >
                  <canvas
                    ref={outputCanvasRef}
                    className="block max-w-none"
                    style={{
                      display: previewMode === 'result' && !cropMode ? 'block' : cropMode ? 'block' : 'none',
                      imageRendering: params.bitDepth === 1 ? 'pixelated' : 'auto',
                      maxHeight: '70vh',
                    }}
                  />
                  {previewMode === 'heatmap' && !cropMode && (
                    <canvas
                      ref={node => {
                        if (node && heatCanvasRef.current) {
                          const ctx = node.getContext('2d');
                          const src = heatCanvasRef.current;
                          if (ctx && src.width > 0) {
                            node.width = src.width; node.height = src.height;
                            ctx.drawImage(src, 0, 0);
                          }
                        }
                      }}
                      className="block max-w-none"
                      style={{ maxHeight: '70vh' }}
                    />
                  )}

                  {/* ── Crop overlay ── */}
                  {cropMode && outputCanvasRef.current && (
                    <div
                      ref={cropOverlayRef}
                      className="absolute inset-0"
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={e => {
                        const coords = getCropCanvasCoords(e);
                        setCropDrag({ startX: coords.x, startY: coords.y, active: true });
                        setCropRect(null);
                      }}
                      onMouseMove={e => {
                        if (!cropDrag.active) return;
                        const coords = getCropCanvasCoords(e);
                        const x = Math.min(cropDrag.startX, coords.x);
                        const y = Math.min(cropDrag.startY, coords.y);
                        const w = Math.abs(coords.x - cropDrag.startX);
                        const h = Math.abs(coords.y - cropDrag.startY);
                        setCropRect({ x, y, w, h });
                      }}
                      onMouseUp={() => setCropDrag(d => ({ ...d, active: false }))}
                    >
                      {/* Dark overlay outside crop */}
                      {cropRect && (() => {
                        const cw = outputCanvasRef.current!.width;
                        const ch = outputCanvasRef.current!.height;
                        const pct = (v: number, total: number) => `${(v / total * 100).toFixed(2)}%`;
                        return (
                          <>
                            <div className="absolute bg-black/60" style={{ left: 0, top: 0, width: pct(cropRect.x, cw), height: '100%' }} />
                            <div className="absolute bg-black/60" style={{ left: pct(cropRect.x + cropRect.w, cw), top: 0, right: 0, height: '100%' }} />
                            <div className="absolute bg-black/60" style={{ left: pct(cropRect.x, cw), top: 0, width: pct(cropRect.w, cw), height: pct(cropRect.y, ch) }} />
                            <div className="absolute bg-black/60" style={{ left: pct(cropRect.x, cw), top: pct(cropRect.y + cropRect.h, ch), width: pct(cropRect.w, cw), bottom: 0 }} />
                            {/* Crop border */}
                            <div className="absolute border border-laser" style={{
                              left: pct(cropRect.x, cw), top: pct(cropRect.y, ch),
                              width: pct(cropRect.w, cw), height: pct(cropRect.h, ch),
                              boxShadow: '0 0 8px rgba(232,0,10,0.5)',
                            }}>
                              {/* Rule of thirds */}
                              <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute border-l border-white/10" style={{ left: '33.33%', top: 0, bottom: 0 }} />
                                <div className="absolute border-l border-white/10" style={{ left: '66.66%', top: 0, bottom: 0 }} />
                                <div className="absolute border-t border-white/10" style={{ top: '33.33%', left: 0, right: 0 }} />
                                <div className="absolute border-t border-white/10" style={{ top: '66.66%', left: 0, right: 0 }} />
                              </div>
                              {/* Corners */}
                              {[['top-0 left-0 border-t-2 border-l-2',''],['top-0 right-0 border-t-2 border-r-2',''],['bottom-0 left-0 border-b-2 border-l-2',''],['bottom-0 right-0 border-b-2 border-r-2','']].map(([cls], i) => (
                                <div key={i} className={`absolute w-3 h-3 border-laser ${cls}`} />
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Zoom bar */}
            {imageFile && (
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <button onClick={() => setZoom(z => Math.min(8, z + 0.25))} className="btn-ghost-steel w-7 h-7 flex items-center justify-center"><Icon name="ZoomIn" size={12} /></button>
                <span className="value-mono text-xs">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} className="btn-ghost-steel w-7 h-7 flex items-center justify-center"><Icon name="ZoomOut" size={12} /></button>
                <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="btn-ghost-steel px-2 h-7 text-[10px] font-mono">СБРОС</button>
              </div>
            )}

            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <button onClick={() => setShowGrid(g => !g)} className={`btn-ghost-steel w-7 h-7 flex items-center justify-center ${showGrid ? 'border-[#333]' : ''}`}>
                <Icon name="Grid3x3" size={12} />
              </button>
              {imageFile && (
                <button onClick={() => fileInputRef.current?.click()} className="btn-ghost-steel px-2 h-7 text-[10px] font-mono">
                  <Icon name="Replace" size={10} className="inline mr-1" />ЗАМЕНИТЬ
                </button>
              )}
            </div>

            {imageName && (
              <div className="absolute top-3 left-3 px-2 py-1 bg-[#0f0f0f] border border-[#1e1e1e]">
                <span className="text-[10px] font-mono text-[#555]">{imageName}</span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Control panel */}
        <aside className="w-72 flex-shrink-0 bg-[#0e0e0e] flex flex-col overflow-y-auto">

          {/* ── EDITOR ── */}
          {tab === 'editor' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="SlidersHorizontal" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Коррекция</span>
              </div>

              <Slider label="Контрастность" value={params.contrast}    min={-100} max={100} onChange={v => setParam('contrast', v)} />
              <Slider label="Яркость"        value={params.brightness}  min={-100} max={100} onChange={v => setParam('brightness', v)} />
              <Slider label="Резкость"        value={params.sharpness}   min={0}    max={100} onChange={v => setParam('sharpness', v)} />
              <Slider label="Уровень серого"  value={params.grayscale}   min={0}    max={100} unit="%" onChange={v => setParam('grayscale', v)} />
              <Slider label="Гамма"           value={params.gamma}       min={0.1}  max={3.0} step={0.1} onChange={v => setParam('gamma', v)} />

              <div className="border-t border-[#1a1a1a] my-4" />

              {/* Invert */}
              <div className="mb-4 flex items-center justify-between">
                <span className="section-label">Инверсия (негатив)</span>
                <button
                  onClick={() => setParam('invert', !params.invert)}
                  className={`w-10 h-5 relative transition-all ${params.invert ? 'bg-laser' : 'bg-[#1e1e1e] border border-[#2e2e2e]'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${params.invert ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Bit depth */}
              <div className="mb-4">
                <span className="section-label block mb-2">Режим вывода</span>
                <div className="flex gap-2">
                  {([8, 1] as const).map(b => (
                    <button
                      key={b}
                      onClick={() => setParam('bitDepth', b)}
                      className={`flex-1 py-1.5 text-xs font-oswald tracking-wider transition-all ${params.bitDepth === b ? 'btn-laser' : 'btn-ghost-steel'}`}
                    >
                      {b === 8 ? '8 BIT' : '1 BIT'}
                    </button>
                  ))}
                </div>
              </div>

              {params.bitDepth === 1 && (
                <>
                  <Slider label="Порог" value={params.threshold} min={0} max={255} onChange={v => setParam('threshold', v)} />

                  <div className="mb-4">
                    <span className="section-label block mb-2">Дизеринг</span>
                    <div className="flex flex-col gap-1">
                      {DITHER_MODES.map(d => (
                        <button
                          key={d.id}
                          onClick={() => setParam('dithering', d.id)}
                          className={`text-left px-3 py-2 border transition-all ${
                            params.dithering === d.id
                              ? 'border-laser bg-[#150000] text-white'
                              : 'border-[#1a1a1a] text-[#555] hover:border-[#2e2e2e] hover:text-[#888]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-oswald text-xs tracking-wide">{d.label}</span>
                            {params.dithering === d.id && <Icon name="Check" size={10} className="text-laser" />}
                          </div>
                          <div className="text-[9px] text-[#3a3a3a] mt-0.5">{d.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <button onClick={() => setParams(DEFAULT_PARAMS)} className="btn-ghost-steel w-full py-2 text-xs mt-2">
                <Icon name="RotateCcw" size={10} className="inline mr-1.5" />Сбросить всё
              </button>
            </div>
          )}

          {/* ── RETOUCH ── */}
          {tab === 'retouch' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Sparkles" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Ретушь</span>
              </div>

              {/* Auto retouch */}
              <div className="bg-[#0a0a0a] border border-[#161616] p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-oswald text-xs text-white tracking-wider">Авторетушь</div>
                    <div className="text-[9px] text-[#3a3a3a]">Авто-уровни + локальный контраст</div>
                  </div>
                  <button
                    onClick={() => setParam('autoRetouch', !params.autoRetouch)}
                    className={`w-10 h-5 relative transition-all flex-shrink-0 ${params.autoRetouch ? 'bg-laser' : 'bg-[#1e1e1e] border border-[#2e2e2e]'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${params.autoRetouch ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
                {params.autoRetouch && (
                  <Slider label="Интенсивность" value={params.retouchStrength} min={0} max={100} unit="%" onChange={v => setParam('retouchStrength', v)} />
                )}
              </div>

              {/* Noise reduction */}
              <Slider
                label="Шумоподавление"
                value={params.noiseReduction} min={0} max={100} unit="%"
                onChange={v => setParam('noiseReduction', v)}
              />

              <div className="border-t border-[#1a1a1a] my-4" />

              {/* Skin smoothing */}
              <div className="mb-1">
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="User" size={12} className="text-laser" />
                  <span className="font-oswald text-xs text-white tracking-wider uppercase">Сглаживание кожи</span>
                </div>
                <p className="text-[10px] text-[#333] mb-3 leading-relaxed">
                  Сохраняет детали (глаза, волосы) через тепловую маску — сглаживает только тёплые оттенки.
                </p>
              </div>

              <Slider label="Сглаживание" value={params.skinSmoothing} min={0} max={100} unit="%" onChange={v => setParam('skinSmoothing', v)} />

              {params.skinSmoothing > 0 && (
                <div className="mb-4">
                  <Slider
                    label="Охват (тон кожи)"
                    value={params.skinTone} min={0} max={100} unit="%"
                    onChange={v => setParam('skinTone', v)}
                  />
                  <div className="flex gap-1 mt-1">
                    <div className="text-[9px] text-[#333]">0% = все пиксели</div>
                    <div className="ml-auto text-[9px] text-[#333]">100% = только кожа</div>
                  </div>

                  {/* Skin tone gradient */}
                  <div className="mt-2 h-3 w-full relative">
                    <div className="absolute inset-0" style={{
                      background: 'linear-gradient(to right, #f5deb3, #d2a679, #c68642, #8d5524, #3d1a00)'
                    }} />
                    <div className="absolute top-0 h-full w-0.5 bg-laser" style={{ left: `${params.skinTone}%` }} />
                  </div>
                </div>
              )}

              <div className="border-t border-[#1a1a1a] my-4" />

              <button
                onClick={() => setParams(p => ({ ...p, skinSmoothing: 0, noiseReduction: 0, retouchStrength: 50, autoRetouch: false, skinTone: 60 }))}
                className="btn-ghost-steel w-full py-2 text-xs"
              >
                <Icon name="RotateCcw" size={10} className="inline mr-1.5" />Сбросить ретушь
              </button>
            </div>
          )}

          {/* ── GRAVURE ── */}
          {tab === 'gravure' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1a1a1a]">
                <Icon name="PenTool" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Гравюра</span>
              </div>

              <div className="bg-[#0a0a0a] border border-[#161616] p-3 mb-4">
                <p className="text-[10px] text-[#3a3a3a] leading-relaxed">
                  Имитирует классическую печатную гравюру: линии, точечный растр, меццо-тинт. Идеально для художественной гравировки.
                </p>
              </div>

              <div className="flex items-center justify-between mb-4">
                <span className="font-oswald text-sm text-white tracking-wider">Гравюра активна</span>
                <button
                  onClick={() => setParam('gravureEnabled', !params.gravureEnabled)}
                  className={`w-10 h-5 relative transition-all ${params.gravureEnabled ? 'bg-laser' : 'bg-[#1e1e1e] border border-[#2e2e2e]'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${params.gravureEnabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              {params.gravureEnabled && (
                <>
                  <span className="section-label block mb-2">Стиль гравюры</span>
                  <div className="flex flex-col gap-1.5 mb-4">
                    {GRAVURE_STYLES.map(gs => (
                      <button
                        key={gs.id}
                        onClick={() => setParam('gravureStyle', gs.id)}
                        className={`text-left px-3 py-2 border transition-all ${
                          params.gravureStyle === gs.id
                            ? 'border-laser bg-[#150000]'
                            : 'border-[#1a1a1a] hover:border-[#2e2e2e]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-oswald text-xs tracking-wider ${params.gravureStyle === gs.id ? 'text-laser' : 'text-[#888]'}`}>
                            {gs.label}
                          </span>
                          {params.gravureStyle === gs.id && <Icon name="Check" size={10} className="text-laser" />}
                        </div>
                        <div className="text-[9px] text-[#3a3a3a] mt-0.5">{gs.desc}</div>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-[#1a1a1a] my-3" />

                  {params.gravureStyle !== 'mezzotint' && (
                    <>
                      <Slider
                        label="Шаг линий / точек"
                        value={params.gravureLineSpacing} min={2} max={20} unit=" px"
                        onChange={v => setParam('gravureLineSpacing', v)}
                      />
                      {(params.gravureStyle === 'lines' || params.gravureStyle === 'crosshatch' || params.gravureStyle === 'woodcut') && (
                        <Slider
                          label="Угол линий"
                          value={params.gravureLineAngle} min={0} max={180} unit="°"
                          onChange={v => setParam('gravureLineAngle', v)}
                        />
                      )}
                    </>
                  )}
                  <Slider label="Глубина эффекта" value={params.gravureDepth}    min={0} max={100} unit="%" onChange={v => setParam('gravureDepth', v)} />
                  <Slider label="Контраст"         value={params.gravureContrast} min={0} max={100} unit="%" onChange={v => setParam('gravureContrast', v)} />

                  {/* Style preview hint */}
                  <div className="bg-[#0c0c0c] border border-[#181818] p-2 mt-2">
                    <div className="section-label mb-1">Текущий режим</div>
                    <div className="font-oswald text-laser text-xs tracking-wider">
                      {GRAVURE_STYLES.find(g => g.id === params.gravureStyle)?.label} · {params.gravureLineSpacing}px · {params.gravureDepth}%
                    </div>
                  </div>
                </>
              )}

              {!params.gravureEnabled && (
                <button
                  onClick={() => setParam('gravureEnabled', true)}
                  className="btn-laser w-full py-2.5 text-xs mt-2"
                >
                  <Icon name="PenTool" size={12} className="inline mr-2" />Включить гравюру
                </button>
              )}
            </div>
          )}

          {/* ── HEIGHT MAP ── */}
          {tab === 'heightmap' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Mountain" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Карта высот</span>
              </div>

              {/* Info block */}
              <div className="bg-[#0a0a0a] border border-[#161616] p-3 mb-4">
                <p className="text-[10px] text-[#3a3a3a] leading-relaxed">
                  Карта высот определяет, как яркость пикселей преобразуется в глубину гравировки.
                  Визуализация — тепловая карта: <span className="text-blue-500">синий</span> = мелко,
                  <span className="text-red-500"> красный</span> = глубоко.
                </p>
              </div>

              {/* Presets */}
              <span className="section-label block mb-2">Профиль карты высот</span>
              <div className="flex flex-col gap-1.5 mb-4">
                {HEIGHT_MAP_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => { setParam('heightMap', preset.id); setPreviewMode('heatmap'); }}
                    className={`text-left px-3 py-2.5 border transition-all ${
                      params.heightMap === preset.id
                        ? 'border-laser bg-[#150000]'
                        : 'border-[#1a1a1a] hover:border-[#2e2e2e]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`font-oswald text-xs tracking-wider ${params.heightMap === preset.id ? 'text-laser' : 'text-[#888]'}`}>
                        {preset.label}
                      </span>
                      {params.heightMap === preset.id && (
                        <div className="w-1.5 h-1.5 rounded-full bg-laser animate-pulse-laser" />
                      )}
                    </div>
                    <div className="text-[9px] text-[#3a3a3a]">{preset.desc}</div>
                  </button>
                ))}
              </div>

              <Slider
                label="Сила эффекта"
                value={params.heightMapStrength}
                min={0} max={100} unit="%"
                onChange={v => setParam('heightMapStrength', v)}
              />

              {/* Depth gradient visual */}
              <div className="mb-4">
                <span className="section-label block mb-2">Визуализация глубины</span>
                <div className="relative h-8 w-full overflow-hidden border border-[#1e1e1e]">
                  <div className="absolute inset-0" style={{
                    background: 'linear-gradient(to right, #0a0a1e, #1414b4, #00c8b4, #c8dc00, #ff3c00)'
                  }} />
                  <div className="absolute inset-0 flex items-center justify-between px-2">
                    <span className="text-[9px] text-white/60 font-mono">МЕЛКО</span>
                    <span className="text-[9px] text-white/60 font-mono">ГЛУБОКО</span>
                  </div>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-[#2a2a2a]">0%</span>
                  <span className="text-[9px] text-[#2a2a2a]">25%</span>
                  <span className="text-[9px] text-[#2a2a2a]">50%</span>
                  <span className="text-[9px] text-[#2a2a2a]">75%</span>
                  <span className="text-[9px] text-[#2a2a2a]">100%</span>
                </div>
              </div>

              <button
                onClick={() => setPreviewMode(m => m === 'heatmap' ? 'result' : 'heatmap')}
                className={`w-full py-2 text-xs font-oswald tracking-wider border transition-all ${
                  previewMode === 'heatmap' ? 'btn-laser' : 'btn-ghost-steel'
                }`}
              >
                <Icon name="Thermometer" size={11} className="inline mr-1.5" />
                {previewMode === 'heatmap' ? 'СКРЫТЬ ТЕПЛОВУЮ КАРТУ' : 'ПОКАЗАТЬ ТЕПЛОВУЮ КАРТУ'}
              </button>
            </div>
          )}

          {/* ── MATERIAL PREVIEW ── */}
          {tab === 'preview' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Layers" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Материал</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-5">
                {MATERIALS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMaterial(m.id)}
                    className={`relative overflow-hidden h-16 transition-all ${material === m.id ? 'ring-1 ring-laser' : 'ring-1 ring-[#1e1e1e] hover:ring-[#333]'}`}
                    style={{ background: m.color }}
                  >
                    <div className="absolute inset-0" style={{ backgroundImage: m.texture }} />
                    {material === m.id && (
                      <div className="absolute top-1 right-1 w-3 h-3 bg-laser flex items-center justify-center">
                        <Icon name="Check" size={8} className="text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5">
                      <span className="text-[9px] font-oswald tracking-wider text-white">{m.label.toUpperCase()}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="border border-[#1e1e1e] mb-4 relative overflow-hidden">
                <div className="section-label px-3 py-2 border-b border-[#1e1e1e]">Предпросмотр на {currentMaterial.label}</div>
                <div className="h-40 relative scanlines flex items-center justify-center" style={{ background: currentMaterial.color }}>
                  <div className="absolute inset-0" style={{ backgroundImage: currentMaterial.texture }} />
                  {imageFile ? (
                    <canvas
                      ref={node => {
                        if (node && outputCanvasRef.current && outputCanvasRef.current.width > 0) {
                          node.width = outputCanvasRef.current.width;
                          node.height = outputCanvasRef.current.height;
                          node.getContext('2d')?.drawImage(outputCanvasRef.current, 0, 0);
                        }
                      }}
                      className="absolute inset-0 w-full h-full object-contain mix-blend-multiply opacity-80"
                      style={{ objectFit: 'contain' }}
                    />
                  ) : (
                    <span className="text-[10px] text-black/30 font-mono relative z-10">НЕТ ИЗОБРАЖЕНИЯ</span>
                  )}
                </div>
              </div>

              <div className="bg-[#0c0c0c] border border-[#1a1a1a] p-3">
                <p className="section-label mb-2">Параметры</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    { label: 'Материал',  value: currentMaterial.label },
                    { label: 'DPI',       value: engraveSettings.dpi },
                    { label: 'Мощность',  value: `${engraveSettings.power}%` },
                    { label: 'Скорость',  value: `${engraveSettings.speed} мм/с` },
                    { label: 'Карта',     value: HEIGHT_MAP_PRESETS.find(h => h.id === params.heightMap)?.label },
                    { label: 'Дизеринг', value: params.bitDepth === 1 ? DITHER_MODES.find(d => d.id === params.dithering)?.label : '—' },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="section-label">{r.label}</div>
                      <div className="value-mono text-[#888]">{r.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {tab === 'settings' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Settings2" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Гравировка</span>
              </div>

              {ENGRAVE_SETTINGS.map(s => (
                <Slider
                  key={s.id}
                  label={s.label}
                  value={engraveSettings[s.id]}
                  min={s.min} max={s.max}
                  unit={s.unit ? ` ${s.unit}` : ''}
                  onChange={v => setEngraveSettings(prev => ({ ...prev, [s.id]: v }))}
                />
              ))}

              <div className="border-t border-[#1a1a1a] my-4" />

              <div className="mb-4">
                <span className="section-label block mb-3">Размер рабочей области</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="section-label mb-1">Ширина (мм)</div>
                    <input type="number" defaultValue={300} className="w-full bg-[#0c0c0c] border border-[#1e1e1e] text-[#888] font-mono text-xs px-2 py-1.5 outline-none focus:border-laser" />
                  </div>
                  <div className="flex-1">
                    <div className="section-label mb-1">Высота (мм)</div>
                    <input type="number" defaultValue={200} className="w-full bg-[#0c0c0c] border border-[#1e1e1e] text-[#888] font-mono text-xs px-2 py-1.5 outline-none focus:border-laser" />
                  </div>
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-[#181818] p-3 mt-4">
                <p className="section-label mb-2">Время гравировки (оценка)</p>
                <p className="font-mono-tech text-laser text-lg">~{Math.round(engraveSettings.passes * 300 / engraveSettings.speed)} сек</p>
                <p className="text-[10px] text-[#333] mt-0.5">при текущих настройках</p>
              </div>
            </div>
          )}

          {/* ── EXPORT ── */}
          {tab === 'export' && (
            <div className="p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Download" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Экспорт</span>
              </div>

              {!imageFile && (
                <div className="border border-dashed border-[#1e1e1e] p-4 text-center mb-4">
                  <Icon name="ImageOff" size={18} className="text-[#2a2a2a] mx-auto mb-2" />
                  <p className="text-[11px] text-[#444]">Загрузите изображение для экспорта</p>
                </div>
              )}

              <div className="space-y-2 mb-4">
                {([
                  { fmt: 'PNG'   as ExportFormat, desc: 'Растровый с фильтрами',          icon: 'Image'    },
                  { fmt: 'BMP'   as ExportFormat, desc: 'Растровый, без сжатия',           icon: 'Image'    },
                  { fmt: 'DXF'   as ExportFormat, desc: 'AutoCAD — векторные траектории',  icon: 'Spline'   },
                  { fmt: 'LBRN2' as ExportFormat, desc: 'LightBurn проект с настройками',  icon: 'Zap'      },
                ]).map(({ fmt, desc, icon }) => {
                  const isLoading = exporting === fmt;
                  const isDone    = exportDone === fmt;
                  return (
                    <button
                      key={fmt}
                      onClick={() => exportFile(fmt)}
                      disabled={!imageFile || !!exporting}
                      className={`w-full flex items-center justify-between px-4 py-3 border transition-all group
                        ${isDone    ? 'border-green-700 bg-green-950/30'  : ''}
                        ${isLoading ? 'border-laser bg-[#1a0000]'          : ''}
                        ${!isDone && !isLoading ? 'border-[#1e1e1e] hover:border-laser' : ''}
                        ${(!imageFile || !!exporting) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 border flex items-center justify-center transition-all
                          ${isDone    ? 'bg-green-900/40 border-green-700'                         : ''}
                          ${isLoading ? 'bg-[#200000] border-laser animate-pulse-laser'            : ''}
                          ${!isDone && !isLoading ? 'bg-[#111] border-[#1e1e1e] group-hover:border-laser' : ''}
                        `}>
                          {isDone    ? <Icon name="Check"  size={14} className="text-green-400" />                       :
                           isLoading ? <Icon name="Loader" size={14} className="text-laser animate-spin" />              :
                                       <Icon name={icon}   size={14} className="text-[#444] group-hover:text-laser transition-colors" />}
                        </div>
                        <div className="text-left">
                          <div className={`font-oswald text-sm tracking-wider ${isDone ? 'text-green-400' : 'text-white'}`}>{fmt}</div>
                          <div className="text-[10px] text-[#444]">{isDone ? '✓ Файл сохранён' : isLoading ? 'Генерация...' : desc}</div>
                        </div>
                      </div>
                      {!isLoading && !isDone && <Icon name="ChevronRight" size={14} className="text-[#333] group-hover:text-laser transition-colors" />}
                    </button>
                  );
                })}
              </div>

              <div className="bg-[#0a0a0a] border border-[#161616] p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Info" size={11} className="text-laser" />
                  <span className="section-label">Про форматы</span>
                </div>
                <p className="text-[10px] text-[#3a3a3a] leading-relaxed">
                  <span className="text-[#555]">DXF</span> — линии по тёмным пикселям, открывается в AutoCAD, Inkscape.<br />
                  <span className="text-[#555]">LBRN2</span> — проект LightBurn: {engraveSettings.power}% мощность, {engraveSettings.speed} мм/с, {engraveSettings.dpi} DPI.
                </p>
              </div>

              <div className="bg-[#0c0c0c] border border-[#1a1a1a] p-3">
                <p className="section-label mb-2">Параметры экспорта</p>
                <div className="space-y-1.5">
                  {[
                    { label: 'Разрешение', value: `${engraveSettings.dpi} DPI` },
                    { label: 'Глубина',    value: params.bitDepth === 1 ? '1-bit (ч/б)' : '8-bit (серый)' },
                    { label: 'Карта',      value: HEIGHT_MAP_PRESETS.find(h => h.id === params.heightMap)?.label },
                    { label: 'Дизеринг',  value: params.bitDepth === 1 ? DITHER_MODES.find(d => d.id === params.dithering)?.label : '—' },
                    { label: 'Мощность',   value: `${engraveSettings.power}%` },
                    { label: 'Скорость',   value: `${engraveSettings.speed} мм/с` },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between">
                      <span className="section-label">{r.label}</span>
                      <span className="value-mono text-[#888]">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bottom status */}
          <div className="mt-auto border-t border-[#1a1a1a] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${imageFile ? 'bg-laser animate-pulse-laser' : 'bg-[#2a2a2a]'}`} />
              <span className="text-[10px] font-mono text-[#444]">
                {imageFile ? imageName.substring(0, 18) + (imageName.length > 18 ? '…' : '') : 'НЕТ ФАЙЛА'}
              </span>
            </div>
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost-steel px-2 py-1 text-[10px]">
              <Icon name="FolderOpen" size={10} className="inline mr-1" />ОТКРЫТЬ
            </button>
          </div>
        </aside>
      </div>

      <input
        ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}