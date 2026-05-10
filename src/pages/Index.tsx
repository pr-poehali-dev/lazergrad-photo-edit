import { useState, useRef, useCallback, useEffect } from 'react';
import Icon from '@/components/ui/icon';

// ── Types ──────────────────────────────────────────────────────────────────
type Material = 'plywood' | 'wood' | 'steel' | 'ceramic' | 'glass' | 'leather';
type ExportFormat = 'PNG' | 'BMP' | 'DXF' | 'LBRN2';
type Tab = 'editor' | 'preview' | 'settings' | 'export';

interface ImageParams {
  contrast: number;
  brightness: number;
  sharpness: number;
  grayscale: number;
  threshold: number;
  dithering: boolean;
  bitDepth: 1 | 8;
}

// ── Constants ─────────────────────────────────────────────────────────────
const MATERIALS: { id: Material; label: string; color: string; texture: string }[] = [
  { id: 'plywood', label: 'Фанера', color: '#c8a96e', texture: 'repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(0,0,0,0.08) 3px,rgba(0,0,0,0.08) 4px)' },
  { id: 'wood', label: 'Дерево', color: '#8b5e3c', texture: 'repeating-linear-gradient(10deg,transparent,transparent 4px,rgba(0,0,0,0.12) 4px,rgba(0,0,0,0.12) 5px)' },
  { id: 'steel', label: 'Нержавейка', color: '#9aa0a6', texture: 'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 1px,transparent 1px,transparent 4px)' },
  { id: 'ceramic', label: 'Керамика', color: '#e8e0d5', texture: 'none' },
  { id: 'glass', label: 'Стекло', color: '#b8d4e0', texture: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.1) 0,rgba(255,255,255,0.1) 1px,transparent 1px,transparent 6px)' },
  { id: 'leather', label: 'Кожа', color: '#5c3d2e', texture: 'repeating-linear-gradient(60deg,rgba(0,0,0,0.1) 0,rgba(0,0,0,0.1) 1px,transparent 1px,transparent 5px)' },
];

const DEFAULT_PARAMS: ImageParams = {
  contrast: 0,
  brightness: 0,
  sharpness: 0,
  grayscale: 100,
  threshold: 128,
  dithering: false,
  bitDepth: 8,
};

const ENGRAVE_SETTINGS = [
  { id: 'power', label: 'Мощность', unit: '%', min: 1, max: 100, default: 60 },
  { id: 'speed', label: 'Скорость', unit: 'мм/с', min: 10, max: 1000, default: 200 },
  { id: 'dpi', label: 'DPI', unit: '', min: 75, max: 1000, default: 254 },
  { id: 'passes', label: 'Проходов', unit: 'раз', min: 1, max: 10, default: 1 },
];

// ── Slider ────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="section-label">{label}</span>
        <span className="value-mono">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-[#1e1e1e] appearance-none cursor-pointer slider-laser"
        style={{ accentColor: 'var(--laser)' }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-[#333]">{min}</span>
        <span className="text-[10px] text-[#333]">{max}</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function Index() {
  const [tab, setTab] = useState<Tab>('editor');
  const [params, setParams] = useState<ImageParams>(DEFAULT_PARAMS);
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
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const param = <K extends keyof ImageParams>(key: K, value: ImageParams[K]) =>
    setParams(p => ({ ...p, [key]: value }));

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setImageFile(url);
    setImageName(file.name);
    setPanOffset({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  // Apply filters to canvas for preview
  useEffect(() => {
    if (!canvasRef.current || !imageFile) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.filter = [
        `contrast(${100 + params.contrast}%)`,
        `brightness(${100 + params.brightness}%)`,
        `saturate(${100 - params.grayscale}%)`,
        `grayscale(${params.grayscale}%)`,
      ].join(' ');
      ctx.drawImage(img, 0, 0);
      if (params.bitDepth === 1) {
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const lum = 0.299 * d.data[i] + 0.587 * d.data[i+1] + 0.114 * d.data[i+2];
          const v = lum >= params.threshold ? 255 : 0;
          d.data[i] = d.data[i+1] = d.data[i+2] = v;
        }
        ctx.putImageData(d, 0, 0);
      }
    };
    img.src = imageFile;
  }, [imageFile, params]);

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
    if (!canvasRef.current) return;
    if (fmt === 'PNG' || fmt === 'BMP') {
      const link = document.createElement('a');
      link.download = `lazergrad_export.${fmt.toLowerCase()}`;
      link.href = canvasRef.current.toDataURL('image/png');
      link.click();
    } else {
      alert(`Экспорт в ${fmt} — формат будет доступен в следующей версии`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col relative overflow-hidden">

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

        {/* Nav tabs */}
        <nav className="flex gap-0 border border-[#1e1e1e]">
          {([
            { id: 'editor', icon: 'SlidersHorizontal', label: 'РЕДАКТОР' },
            { id: 'preview', icon: 'Eye', label: 'МАТЕРИАЛ' },
            { id: 'settings', icon: 'Settings2', label: 'НАСТРОЙКИ' },
            { id: 'export', icon: 'Download', label: 'ЭКСПОРТ' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-[11px] font-oswald font-medium tracking-[0.12em] transition-all ${
                tab === t.id
                  ? 'bg-laser text-white'
                  : 'text-[#555] hover:text-[#aaa] hover:bg-[#141414]'
              }`}
            >
              <Icon name={t.icon} size={12} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 text-[#333]">
          <div className="h-1.5 w-1.5 rounded-full bg-laser animate-pulse-laser" />
          <span className="text-[10px] font-mono text-[#444]">SYS ONLINE</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative z-10">

        {/* LEFT — Upload / Canvas */}
        <div className="flex-1 flex flex-col border-r border-[#1a1a1a]">

          {/* Canvas area */}
          <div
            className="flex-1 relative overflow-hidden bg-[#0c0c0c] cursor-crosshair select-none"
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            {/* Grid */}
            {showGrid && (
              <div
                className="absolute inset-0 pointer-events-none opacity-[0.06]"
                style={{
                  backgroundImage: 'linear-gradient(#e8000a 1px,transparent 1px),linear-gradient(90deg,#e8000a 1px,transparent 1px)',
                  backgroundSize: '40px 40px',
                }}
              />
            )}

            {/* Crosshair */}
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
                  <div className="absolute -inset-4 border border-dashed border-[#1a1a1a]" />
                </div>
                <div className="text-center">
                  <p className="font-oswald text-[#444] text-sm tracking-[0.2em] uppercase mb-1">Загрузить изображение</p>
                  <p className="text-[10px] text-[#2a2a2a] tracking-widest">Перетащите файл или нажмите кнопку</p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-laser px-6 py-2 text-xs"
                >
                  <Icon name="Upload" size={12} className="inline mr-2" />
                  Выбрать файл
                </button>
              </div>
            )}

            {/* Image canvas */}
            {imageFile && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
              >
                <div style={{ transform: `translate(${panOffset.x}px,${panOffset.y}px) scale(${zoom})`, transition: isPanning ? 'none' : 'transform 0.05s' }}>
                  <canvas
                    ref={canvasRef}
                    className="block max-w-none"
                    style={{ imageRendering: params.bitDepth === 1 ? 'pixelated' : 'auto', maxHeight: '70vh', maxWidth: '100%' }}
                  />
                </div>
              </div>
            )}

            {/* Zoom / Tools bar */}
            {imageFile && (
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <button onClick={() => setZoom(z => Math.min(8, z + 0.25))} className="btn-ghost-steel w-7 h-7 flex items-center justify-center">
                  <Icon name="ZoomIn" size={12} />
                </button>
                <span className="value-mono text-xs">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} className="btn-ghost-steel w-7 h-7 flex items-center justify-center">
                  <Icon name="ZoomOut" size={12} />
                </button>
                <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="btn-ghost-steel px-2 h-7 text-[10px] font-mono">
                  СБРОС
                </button>
              </div>
            )}

            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <button
                onClick={() => setShowGrid(g => !g)}
                className={`btn-ghost-steel w-7 h-7 flex items-center justify-center ${showGrid ? 'border-[#333] text-[#666]' : ''}`}
              >
                <Icon name="Grid3x3" size={12} />
              </button>
              {imageFile && (
                <button onClick={() => fileInputRef.current?.click()} className="btn-ghost-steel px-2 h-7 text-[10px] font-mono">
                  <Icon name="Replace" size={10} className="inline mr-1" />ЗАМЕНИТЬ
                </button>
              )}
            </div>

            {/* File name badge */}
            {imageName && (
              <div className="absolute top-3 left-3 px-2 py-1 bg-[#0f0f0f] border border-[#1e1e1e]">
                <span className="text-[10px] font-mono text-[#555]">{imageName}</span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Controls panel */}
        <aside className="w-72 flex-shrink-0 bg-[#0e0e0e] flex flex-col overflow-y-auto">

          {/* ── TAB: EDITOR ── */}
          {tab === 'editor' && (
            <div className="p-5 animate-fade-in flex-1">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="SlidersHorizontal" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Параметры</span>
              </div>

              <Slider label="Контрастность" value={params.contrast} min={-100} max={100} unit="" onChange={v => param('contrast', v)} />
              <Slider label="Яркость" value={params.brightness} min={-100} max={100} onChange={v => param('brightness', v)} />
              <Slider label="Резкость" value={params.sharpness} min={0} max={100} onChange={v => param('sharpness', v)} />
              <Slider label="Уровень серого" value={params.grayscale} min={0} max={100} unit="%" onChange={v => param('grayscale', v)} />

              <div className="border-t border-[#1a1a1a] my-4" />

              <div className="mb-4">
                <span className="section-label block mb-2">Режим вывода</span>
                <div className="flex gap-2">
                  {([8, 1] as const).map(b => (
                    <button
                      key={b}
                      onClick={() => param('bitDepth', b)}
                      className={`flex-1 py-1.5 text-xs font-oswald tracking-wider transition-all ${
                        params.bitDepth === b ? 'btn-laser' : 'btn-ghost-steel'
                      }`}
                    >
                      {b === 8 ? '8 BIT' : '1 BIT'}
                    </button>
                  ))}
                </div>
              </div>

              {params.bitDepth === 1 && (
                <Slider label="Порог (Threshold)" value={params.threshold} min={0} max={255} onChange={v => param('threshold', v)} />
              )}

              <div className="mb-4 flex items-center justify-between">
                <span className="section-label">Дизеринг</span>
                <button
                  onClick={() => param('dithering', !params.dithering)}
                  className={`w-10 h-5 relative transition-all ${params.dithering ? 'bg-laser' : 'bg-[#1e1e1e] border border-[#2e2e2e]'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${params.dithering ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              <button
                onClick={() => setParams(DEFAULT_PARAMS)}
                className="btn-ghost-steel w-full py-2 text-xs mt-2"
              >
                <Icon name="RotateCcw" size={10} className="inline mr-1.5" />
                Сбросить всё
              </button>
            </div>
          )}

          {/* ── TAB: PREVIEW (MATERIAL) ── */}
          {tab === 'preview' && (
            <div className="p-5 animate-fade-in flex-1">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Layers" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Материал</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-5">
                {MATERIALS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMaterial(m.id)}
                    className={`relative overflow-hidden h-16 transition-all ${
                      material === m.id ? 'ring-1 ring-laser' : 'ring-1 ring-[#1e1e1e] hover:ring-[#333]'
                    }`}
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

              {/* Material preview overlay */}
              <div className="border border-[#1e1e1e] mb-4 relative overflow-hidden">
                <div className="section-label px-3 py-2 border-b border-[#1e1e1e]">Предпросмотр на {currentMaterial.label}</div>
                <div
                  className="h-40 relative scanlines flex items-center justify-center"
                  style={{ background: currentMaterial.color }}
                >
                  <div className="absolute inset-0" style={{ backgroundImage: currentMaterial.texture }} />
                  {imageFile ? (
                    <img
                      src={imageFile}
                      alt="preview"
                      className="absolute inset-0 w-full h-full object-contain mix-blend-multiply opacity-80"
                      style={{
                        filter: `contrast(${100 + params.contrast}%) brightness(${100 + params.brightness}%) grayscale(${params.grayscale}%)`,
                      }}
                    />
                  ) : (
                    <span className="text-[10px] text-black/30 font-mono relative z-10">НЕТ ИЗОБРАЖЕНИЯ</span>
                  )}
                </div>
              </div>

              <div className="bg-[#0c0c0c] border border-[#1a1a1a] p-3">
                <p className="section-label mb-2">Параметры материала</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {[
                    { label: 'Материал', value: currentMaterial.label },
                    { label: 'DPI', value: engraveSettings.dpi },
                    { label: 'Мощность', value: `${engraveSettings.power}%` },
                    { label: 'Скорость', value: `${engraveSettings.speed} мм/с` },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="section-label">{r.label}</div>
                      <div className="value-mono">{r.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: SETTINGS ── */}
          {tab === 'settings' && (
            <div className="p-5 animate-fade-in flex-1">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Settings2" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Гравировка</span>
              </div>

              {ENGRAVE_SETTINGS.map(s => (
                <Slider
                  key={s.id}
                  label={s.label}
                  value={engraveSettings[s.id]}
                  min={s.min}
                  max={s.max}
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
                    <input
                      type="number"
                      defaultValue={300}
                      className="w-full bg-[#0c0c0c] border border-[#1e1e1e] text-[#888] font-mono text-xs px-2 py-1.5 outline-none focus:border-laser"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="section-label mb-1">Высота (мм)</div>
                    <input
                      type="number"
                      defaultValue={200}
                      className="w-full bg-[#0c0c0c] border border-[#1e1e1e] text-[#888] font-mono text-xs px-2 py-1.5 outline-none focus:border-laser"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <span className="section-label block mb-2">Тип гравировки</span>
                <div className="flex flex-col gap-1.5">
                  {['Растровая (bitmap)', 'Векторная (contour)', 'Комбинированная'].map(t => (
                    <button key={t} className="btn-ghost-steel text-left px-3 py-2 text-[11px] flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-laser flex-shrink-0" />
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-[#181818] p-3 mt-4">
                <p className="section-label mb-2">Время гравировки (оценка)</p>
                <p className="font-mono-tech text-laser text-lg">~{Math.round(engraveSettings.passes * 300 / engraveSettings.speed)} сек</p>
                <p className="text-[10px] text-[#333] mt-0.5">при текущих настройках</p>
              </div>
            </div>
          )}

          {/* ── TAB: EXPORT ── */}
          {tab === 'export' && (
            <div className="p-5 animate-fade-in flex-1">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#1a1a1a]">
                <Icon name="Download" size={14} className="text-laser" />
                <span className="font-oswald text-sm tracking-[0.15em] text-white uppercase">Экспорт</span>
              </div>

              <div className="space-y-2 mb-5">
                {(['PNG', 'BMP', 'DXF', 'LBRN2'] as ExportFormat[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => exportFile(fmt)}
                    className="w-full flex items-center justify-between px-4 py-3 border border-[#1e1e1e] hover:border-laser group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#111] border border-[#1e1e1e] group-hover:border-laser flex items-center justify-center transition-all">
                        <Icon name="FileDown" size={14} className="text-[#444] group-hover:text-laser transition-colors" />
                      </div>
                      <div className="text-left">
                        <div className="font-oswald text-sm text-white tracking-wider">{fmt}</div>
                        <div className="text-[10px] text-[#444]">
                          {fmt === 'PNG' && 'Растровый, прозрачность'}
                          {fmt === 'BMP' && 'Растровый, без сжатия'}
                          {fmt === 'DXF' && 'AutoCAD, векторный'}
                          {fmt === 'LBRN2' && 'LightBurn проект'}
                        </div>
                      </div>
                    </div>
                    <Icon name="ChevronRight" size={14} className="text-[#333] group-hover:text-laser transition-colors" />
                  </button>
                ))}
              </div>

              <div className="bg-[#0c0c0c] border border-[#1a1a1a] p-3 mb-4">
                <p className="section-label mb-2">Параметры файла</p>
                <div className="space-y-1.5">
                  {[
                    { label: 'Разрешение', value: `${engraveSettings.dpi} DPI` },
                    { label: 'Глубина цвета', value: params.bitDepth === 1 ? '1-bit (ч/б)' : '8-bit (серый)' },
                    { label: 'Материал', value: currentMaterial.label },
                    { label: 'Размер', value: imageFile ? '(из файла)' : 'нет файла' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between">
                      <span className="section-label">{r.label}</span>
                      <span className="value-mono text-[#888]">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upload from cloud placeholder */}
              <div className="border border-dashed border-[#1e1e1e] p-4 text-center">
                <Icon name="Cloud" size={20} className="text-[#2a2a2a] mx-auto mb-2" />
                <p className="section-label mb-1">Облачное хранилище</p>
                <p className="text-[10px] text-[#2a2a2a]">Загрузка из облака — скоро</p>
              </div>
            </div>
          )}

          {/* Bottom status */}
          <div className="border-t border-[#1a1a1a] px-5 py-3 flex items-center justify-between">
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
