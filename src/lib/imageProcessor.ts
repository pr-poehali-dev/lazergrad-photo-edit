// ── Image Processor for Laser Engraving ──────────────────────────────────
// Handles: grayscale, height maps, Floyd-Steinberg dithering, sharpening

export type HeightMapPreset =
  | 'linear'      // simple luminance → depth
  | 'inverted'    // dark = deep, light = shallow
  | 'gamma'       // gamma-corrected depth
  | 'relief'      // edge-enhanced, 3D relief feel
  | 'emboss'      // emboss/bump-map effect
  | 'solarize'    // sinusoidal wave mapping

export type DitheringMode = 'none' | 'floyd-steinberg' | 'atkinson' | 'threshold'

export interface ProcessorParams {
  contrast: number       // -100..100
  brightness: number     // -100..100
  sharpness: number      // 0..100
  grayscale: number      // 0..100
  threshold: number      // 0..255
  bitDepth: 1 | 8
  dithering: DitheringMode
  heightMap: HeightMapPreset
  heightMapStrength: number  // 0..100
  gamma: number          // 0.1..3.0
  invert: boolean
}

// ── Clamp ─────────────────────────────────────────────────────────────────
function clamp(v: number, lo = 0, hi = 255): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ── Apply contrast & brightness directly to pixel buffer ──────────────────
function applyContrastBrightness(
  data: Uint8ClampedArray,
  contrast: number,
  brightness: number
): void {
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = clamp(factor * (data[i]   - 128) + 128 + brightness)
    data[i+1] = clamp(factor * (data[i+1] - 128) + 128 + brightness)
    data[i+2] = clamp(factor * (data[i+2] - 128) + 128 + brightness)
  }
}

// ── Convert to grayscale luminance buffer (Float32 for precision) ──────────
function toGrayFloat(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2]
  }
  return gray
}

// ── Gamma correction ───────────────────────────────────────────────────────
function applyGamma(gray: Float32Array, gamma: number): void {
  const inv = 1 / gamma
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.pow(gray[i] / 255, inv) * 255
  }
}

// ── Unsharp mask (sharpening) ─────────────────────────────────────────────
function sharpen(gray: Float32Array, w: number, h: number, amount: number): Float32Array {
  if (amount <= 0) return gray
  const strength = amount / 100
  const out = new Float32Array(gray)
  // 3×3 Laplacian kernel for sharpening
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const laplacian =
        -gray[(y-1)*w + (x-1)] * 0.0 +
        -gray[(y-1)*w + x    ] * 1.0 +
        -gray[(y-1)*w + (x+1)] * 0.0 +
        -gray[y    *w + (x-1)] * 1.0 +
         gray[y    *w + x    ] * 5.0 +
        -gray[y    *w + (x+1)] * 1.0 +
        -gray[(y+1)*w + (x-1)] * 0.0 +
        -gray[(y+1)*w + x    ] * 1.0 +
        -gray[(y+1)*w + (x+1)] * 0.0
      out[idx] = clamp(gray[idx] + (laplacian - gray[idx]) * strength)
    }
  }
  return out
}

// ── Height map transforms ─────────────────────────────────────────────────
function applyHeightMap(
  gray: Float32Array,
  preset: HeightMapPreset,
  strength: number
): Float32Array {
  const s = strength / 100
  const out = new Float32Array(gray.length)
  const w_len = gray.length

  if (preset === 'linear') {
    // pass-through (already linear)
    for (let i = 0; i < w_len; i++) out[i] = gray[i]
    return out
  }

  if (preset === 'inverted') {
    for (let i = 0; i < w_len; i++) {
      const v = 255 - gray[i]
      out[i] = gray[i] + (v - gray[i]) * s
    }
    return out
  }

  if (preset === 'gamma') {
    for (let i = 0; i < w_len; i++) {
      const v = Math.pow(gray[i] / 255, 2.2) * 255
      out[i] = gray[i] + (v - gray[i]) * s
    }
    return out
  }

  if (preset === 'relief') {
    // Edge-enhanced: emphasise high-frequency detail
    for (let i = 0; i < w_len; i++) {
      const edge = Math.abs(gray[i] - (i > 0 ? gray[i-1] : gray[i]))
      const v = clamp(gray[i] + edge * 2)
      out[i] = gray[i] + (v - gray[i]) * s
    }
    return out
  }

  if (preset === 'emboss') {
    // Diagonal difference (bump)
    for (let i = 0; i < w_len; i++) {
      const prev = i > 1 ? gray[i-1] : gray[i]
      const v = clamp(gray[i] - prev + 128)
      out[i] = gray[i] + (v - gray[i]) * s
    }
    return out
  }

  if (preset === 'solarize') {
    // Sinusoidal wave over luminance
    for (let i = 0; i < w_len; i++) {
      const t = gray[i] / 255
      const v = (Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * 255
      out[i] = gray[i] + (v - gray[i]) * s
    }
    return out
  }

  return gray
}

// ── Floyd-Steinberg dithering ────────────────────────────────────────────
function floydSteinberg(
  gray: Float32Array,
  w: number,
  h: number,
  threshold: number
): Uint8ClampedArray {
  const buf = new Float32Array(gray) // mutable copy
  const out = new Uint8ClampedArray(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const old = buf[idx]
      const newVal = old < threshold ? 0 : 255
      out[idx] = newVal
      const err = old - newVal

      // Distribute error to neighbours
      if (x + 1 < w)           buf[idx + 1]     += err * 7 / 16
      if (y + 1 < h) {
        if (x - 1 >= 0)         buf[idx + w - 1] += err * 3 / 16
                                 buf[idx + w]     += err * 5 / 16
        if (x + 1 < w)          buf[idx + w + 1] += err * 1 / 16
      }
    }
  }
  return out
}

// ── Atkinson dithering (sharper, used by Apple LaserWriter) ───────────────
function atkinson(
  gray: Float32Array,
  w: number,
  h: number,
  threshold: number
): Uint8ClampedArray {
  const buf = new Float32Array(gray)
  const out = new Uint8ClampedArray(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const old = buf[idx]
      const newVal = old < threshold ? 0 : 255
      out[idx] = newVal
      const err = (old - newVal) / 8

      const neighbors = [
        [y,   x+1], [y,   x+2],
        [y+1, x-1], [y+1, x],   [y+1, x+1],
        [y+2, x],
      ]
      for (const [ny, nx] of neighbors) {
        if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
          buf[ny * w + nx] += err
        }
      }
    }
  }
  return out
}

// ── Simple threshold ──────────────────────────────────────────────────────
function simpleThreshold(gray: Float32Array, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length)
  for (let i = 0; i < gray.length; i++) {
    out[i] = gray[i] < threshold ? 0 : 255
  }
  return out
}

// ── Main processor: takes source canvas, writes to output canvas ──────────
export function processImage(
  sourceCanvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  p: ProcessorParams
): void {
  const ctx = sourceCanvas.getContext('2d')!
  const w = sourceCanvas.width
  const h = sourceCanvas.height

  outputCanvas.width = w
  outputCanvas.height = h

  const outCtx = outputCanvas.getContext('2d')!

  // 1. Read source pixels with CSS filters applied
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = w
  tempCanvas.height = h
  const tempCtx = tempCanvas.getContext('2d')!
  tempCtx.filter = [
    `contrast(${100 + p.contrast}%)`,
    `brightness(${100 + p.brightness}%)`,
    `grayscale(${p.grayscale}%)`,
  ].join(' ')
  tempCtx.drawImage(sourceCanvas, 0, 0)

  const rawData = tempCtx.getImageData(0, 0, w, h)

  // 2. Precise contrast + brightness on pixel level
  applyContrastBrightness(rawData.data, p.contrast * 0.5, p.brightness * 0.5)

  // 3. Extract grayscale float buffer
  let gray = toGrayFloat(rawData.data, w, h)

  // 4. Gamma
  if (Math.abs(p.gamma - 1) > 0.01) {
    applyGamma(gray, p.gamma)
  }

  // 5. Sharpening
  if (p.sharpness > 0) {
    gray = sharpen(gray, w, h, p.sharpness)
  }

  // 6. Invert
  if (p.invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  }

  // 7. Height map transform
  if (p.heightMap !== 'linear' && p.heightMapStrength > 0) {
    gray = applyHeightMap(gray, p.heightMap, p.heightMapStrength)
  }

  // 8. Final output
  const outData = outCtx.createImageData(w, h)

  if (p.bitDepth === 1) {
    // Dithering modes
    let mono: Uint8ClampedArray
    if (p.dithering === 'floyd-steinberg') {
      mono = floydSteinberg(gray, w, h, p.threshold)
    } else if (p.dithering === 'atkinson') {
      mono = atkinson(gray, w, h, p.threshold)
    } else {
      mono = simpleThreshold(gray, p.threshold)
    }
    for (let i = 0; i < w * h; i++) {
      outData.data[i*4]   = mono[i]
      outData.data[i*4+1] = mono[i]
      outData.data[i*4+2] = mono[i]
      outData.data[i*4+3] = 255
    }
  } else {
    // 8-bit grayscale — write height map as luminance
    for (let i = 0; i < w * h; i++) {
      const v = clamp(Math.round(gray[i]))
      outData.data[i*4]   = v
      outData.data[i*4+1] = v
      outData.data[i*4+2] = v
      outData.data[i*4+3] = 255
    }
  }

  outCtx.putImageData(outData, 0, 0)
}

// ── Heightmap color visualization (for "heat" preview) ────────────────────
export function getHeightMapColor(normalizedValue: number): string {
  // 0 = deep/black → 1 = shallow/white
  // Thermal: black → blue → cyan → green → yellow → red → white
  const stops = [
    [0,   [0,   0,   0]],
    [0.2, [0,   0,   180]],
    [0.4, [0,   200, 200]],
    [0.6, [0,   220, 0]],
    [0.8, [255, 220, 0]],
    [1.0, [255, 80,  0]],
  ] as [number, [number,number,number]][]

  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i+1]
    if (normalizedValue >= t0 && normalizedValue <= t1) {
      const t = (normalizedValue - t0) / (t1 - t0)
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t)
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t)
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t)
      return `rgb(${r},${g},${b})`
    }
  }
  return 'white'
}

// ── Height map preview: draw thermal colormap onto canvas ─────────────────
export function renderHeightMapPreview(
  sourceCanvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  p: ProcessorParams
): void {
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  outputCanvas.width = w
  outputCanvas.height = h

  const tempCtx = sourceCanvas.getContext('2d')!
  const raw = tempCtx.getImageData(0, 0, w, h)
  let gray = toGrayFloat(raw.data, w, h)

  if (p.sharpness > 0) gray = sharpen(gray, w, h, p.sharpness)
  if (p.invert) for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  if (p.heightMap !== 'linear' && p.heightMapStrength > 0) {
    gray = applyHeightMap(gray, p.heightMap, p.heightMapStrength)
  }

  const outCtx = outputCanvas.getContext('2d')!
  const outData = outCtx.createImageData(w, h)

  for (let i = 0; i < w * h; i++) {
    const t = gray[i] / 255
    // thermal colormap inline
    const stops: [number, [number,number,number]][] = [
      [0,   [10,  10,  30]],
      [0.25,[20,  20,  180]],
      [0.5, [0,   200, 180]],
      [0.75,[200, 220, 0]],
      [1.0, [255, 60,  0]],
    ]
    let r = 255, g = 255, b = 255
    for (let s = 0; s < stops.length - 1; s++) {
      const [t0, c0] = stops[s]
      const [t1, c1] = stops[s+1]
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0)
        r = Math.round(c0[0] + (c1[0] - c0[0]) * f)
        g = Math.round(c0[1] + (c1[1] - c0[1]) * f)
        b = Math.round(c0[2] + (c1[2] - c0[2]) * f)
        break
      }
    }
    outData.data[i*4]   = r
    outData.data[i*4+1] = g
    outData.data[i*4+2] = b
    outData.data[i*4+3] = 255
  }

  outCtx.putImageData(outData, 0, 0)
}
