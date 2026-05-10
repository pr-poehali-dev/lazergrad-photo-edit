// ── Image Processor for Laser Engraving ──────────────────────────────────
// Handles: grayscale, height maps, Floyd-Steinberg dithering, sharpening,
//          skin smoothing, auto-retouch, engraving (gravure) effect

export type HeightMapPreset =
  | 'linear'
  | 'inverted'
  | 'gamma'
  | 'relief'
  | 'emboss'
  | 'solarize'

export type DitheringMode = 'none' | 'floyd-steinberg' | 'atkinson' | 'threshold'

export type GravureStyle = 'lines' | 'crosshatch' | 'dots' | 'mezzotint' | 'woodcut'

export interface ProcessorParams {
  contrast: number           // -100..100
  brightness: number         // -100..100
  sharpness: number          // 0..100
  grayscale: number          // 0..100
  threshold: number          // 0..255
  bitDepth: 1 | 8
  dithering: DitheringMode
  heightMap: HeightMapPreset
  heightMapStrength: number  // 0..100
  gamma: number              // 0.1..3.0
  invert: boolean
  // Skin & retouch
  skinSmoothing: number      // 0..100
  skinTone: number           // 0..100 — skin tone bias
  autoRetouch: boolean
  retouchStrength: number    // 0..100
  noiseReduction: number     // 0..100
  // Gravure / engraving effect
  gravureEnabled: boolean
  gravureStyle: GravureStyle
  gravureLineSpacing: number // 2..20 px
  gravureLineAngle: number   // 0..180 deg
  gravureDepth: number       // 0..100
  gravureContrast: number    // 0..100
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

// ── Gaussian blur (for skin smoothing) ────────────────────────────────────
function gaussianBlur(gray: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return gray
  const r = Math.min(Math.round(radius), 10)
  const kernel: number[] = []
  const sigma = r / 2.5
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel.push(v)
    sum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  // Horizontal pass
  const tmp = new Float32Array(gray.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const xi = Math.max(0, Math.min(w - 1, x + k))
        acc += gray[y * w + xi] * kernel[k + r]
      }
      tmp[y * w + x] = acc
    }
  }
  // Vertical pass
  const out = new Float32Array(gray.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const yi = Math.max(0, Math.min(h - 1, y + k))
        acc += tmp[yi * w + x] * kernel[k + r]
      }
      out[y * w + x] = acc
    }
  }
  return out
}

// ── Skin smoothing: bilateral-like blend of blurred + original ────────────
// Works on RGBA data in-place (preserves edges via luminance mask)
function applySkinSmoothing(
  data: Uint8ClampedArray,
  w: number, h: number,
  smoothing: number,
  skinTone: number
): void {
  if (smoothing <= 0) return
  const s = smoothing / 100
  const toneBias = skinTone / 100  // 0 = all pixels, 1 = only warm tones

  // Build luminance float arrays for R, G, B channels separately
  const rBuf = new Float32Array(w * h)
  const gBuf = new Float32Array(w * h)
  const bBuf = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    rBuf[i] = data[i * 4]
    gBuf[i] = data[i * 4 + 1]
    bBuf[i] = data[i * 4 + 2]
  }

  const radius = Math.round(2 + s * 6)
  const rBlur = gaussianBlur(rBuf, w, h, radius)
  const gBlur = gaussianBlur(gBuf, w, h, radius)
  const bBlur = gaussianBlur(bBuf, w, h, radius)

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]

    // Skin tone mask: warm = r>g, r>b, moderate brightness
    const warmth = Math.max(0, (r - g) / 255 + (r - b) / 255) / 2
    const lum = (r + g + b) / 765
    const inRange = lum > 0.15 && lum < 0.95
    const skinMask = inRange ? clamp(warmth * 2, 0, 1) * toneBias + (1 - toneBias) : (1 - toneBias)
    const blend = s * skinMask

    data[i * 4]     = clamp(r + (rBlur[i] - r) * blend)
    data[i * 4 + 1] = clamp(g + (gBlur[i] - g) * blend)
    data[i * 4 + 2] = clamp(b + (bBlur[i] - b) * blend)
  }
}

// ── Auto retouch: histogram stretch + local contrast + noise reduction ─────
function applyAutoRetouch(
  data: Uint8ClampedArray,
  w: number, h: number,
  strength: number,
  noiseReduction: number
): void {
  const s = strength / 100

  // 1. Histogram analysis for auto-levels
  const hist = new Array(256).fill(0)
  for (let i = 0; i < w * h; i++) {
    const lum = Math.round(0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2])
    hist[lum]++
  }
  const total = w * h
  const lo_cut = total * 0.005
  const hi_cut = total * 0.995
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lo_cut) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= (total - hi_cut)) { hi = v; break } }
  const range = hi - lo || 1

  // 2. Apply auto levels + local contrast (Unsharp Mask style via luminance)
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2]
  }

  // Noise reduction via mild blur
  const nr = noiseReduction / 100
  const blurred = nr > 0 ? gaussianBlur(gray, w, h, nr * 3) : gray

  for (let i = 0; i < w * h; i++) {
    const r0 = data[i*4], g0 = data[i*4+1], b0 = data[i*4+2]

    // Auto levels
    const rL = clamp(Math.round((r0 - lo) / range * 255))
    const gL = clamp(Math.round((g0 - lo) / range * 255))
    const bL = clamp(Math.round((b0 - lo) / range * 255))

    // Noise reduction blend
    const nr_blend = 1 - nr
    const lum_orig = gray[i]
    const lum_blur = blurred[i]
    const nr_ratio = lum_orig > 0 ? (lum_orig * nr_blend + lum_blur * nr) / lum_orig : 1

    data[i*4]   = clamp(r0 + (rL * nr_ratio - r0) * s)
    data[i*4+1] = clamp(g0 + (gL * nr_ratio - g0) * s)
    data[i*4+2] = clamp(b0 + (bL * nr_ratio - b0) * s)
  }
}

// ── Gravure / engraving effect ─────────────────────────────────────────────
// Renders the image using classic printmaking line-screen techniques
export function applyGravure(
  gray: Float32Array,
  w: number, h: number,
  style: GravureStyle,
  spacing: number,
  angle: number,
  depth: number,
  contrast: number
): Float32Array {
  const out = new Float32Array(w * h)
  const d = depth / 100
  const c = 1 + contrast / 50  // contrast multiplier
  const rad = (angle * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      const src = clamp(((gray[idx] / 255 - 0.5) * c + 0.5) * 255) / 255

      // Rotate coordinates for line angle
      const rx = x * cosA + y * sinA
      const ry = -x * sinA + y * cosA

      let pattern = 0

      if (style === 'lines') {
        // Classic horizontal line screen: line width ∝ luminance
        const pos = ((ry % spacing) + spacing) % spacing
        const lineW = src * spacing * 0.9
        pattern = pos < lineW ? 1 : 0
      } else if (style === 'crosshatch') {
        // Two sets of lines at angle and angle+90
        const rx2 = x * cosA - y * sinA
        const ry2 = x * sinA + y * cosA
        const pos1 = ((ry % spacing) + spacing) % spacing
        const pos2 = ((ry2 % spacing) + spacing) % spacing
        const lw = src * spacing * 0.6
        pattern = (pos1 < lw || pos2 < lw) ? 1 : 0
      } else if (style === 'dots') {
        // Halftone dot screen
        const cx = ((rx % spacing) + spacing) % spacing - spacing / 2
        const cy = ((ry % spacing) + spacing) % spacing - spacing / 2
        const r = Math.sqrt(cx * cx + cy * cy)
        const maxR = spacing * 0.48
        pattern = r < maxR * src ? 1 : 0
      } else if (style === 'mezzotint') {
        // Random grain modulated by luminance (pseudo-random via hash)
        const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
        const noise = hash - Math.floor(hash)
        pattern = noise < src ? 1 : 0
      } else if (style === 'woodcut') {
        // Variable-width lines with edge emphasis (high contrast)
        const pos = ((ry % spacing) + spacing) % spacing
        // Edge detect contribution
        const above = idx >= w ? gray[idx - w] / 255 : src
        const below = idx < (h-1)*w ? gray[idx + w] / 255 : src
        const edge = Math.abs(src - above) + Math.abs(src - below)
        const lw = Math.min(spacing - 1, (src + edge * 2) * spacing * 0.85)
        pattern = pos < lw ? 1 : 0
      }

      // Blend gravure pattern with original
      out[idx] = clamp(((1 - d) * src + d * pattern) * 255)
    }
  }
  return out
}

// ── Crop canvas utility ────────────────────────────────────────────────────
export function cropCanvas(
  src: HTMLCanvasElement,
  x: number, y: number,
  cw: number, ch: number
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width  = cw
  out.height = ch
  out.getContext('2d')!.drawImage(src, x, y, cw, ch, 0, 0, cw, ch)
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

  // 3. Auto retouch (works on RGBA before grayscale conversion)
  if (p.autoRetouch && p.retouchStrength > 0) {
    applyAutoRetouch(rawData.data, w, h, p.retouchStrength, p.noiseReduction)
  } else if (p.noiseReduction > 0) {
    applyAutoRetouch(rawData.data, w, h, 0, p.noiseReduction)
  }

  // 4. Skin smoothing (on color data before grayscale)
  if (p.skinSmoothing > 0) {
    applySkinSmoothing(rawData.data, w, h, p.skinSmoothing, p.skinTone)
  }

  // 5. Extract grayscale float buffer
  let gray = toGrayFloat(rawData.data, w, h)

  // 6. Gamma
  if (Math.abs(p.gamma - 1) > 0.01) {
    applyGamma(gray, p.gamma)
  }

  // 7. Sharpening
  if (p.sharpness > 0) {
    gray = sharpen(gray, w, h, p.sharpness)
  }

  // 8. Invert
  if (p.invert) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  }

  // 9. Height map transform
  if (p.heightMap !== 'linear' && p.heightMapStrength > 0) {
    gray = applyHeightMap(gray, p.heightMap, p.heightMapStrength)
  }

  // 10. Gravure effect
  if (p.gravureEnabled && p.gravureDepth > 0) {
    gray = applyGravure(gray, w, h, p.gravureStyle, p.gravureLineSpacing, p.gravureLineAngle, p.gravureDepth, p.gravureContrast)
  }

  // 11. Final output
  const outData = outCtx.createImageData(w, h)

  if (p.bitDepth === 1) {
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