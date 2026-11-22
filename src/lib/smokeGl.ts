/**
 * The shared machinery behind the board's game-look smokes (docs/plays-editor-v2.md
 * §2.23): one WebGL painter per smoke kind, built on first use, that renders a
 * smoke into a square 2D canvas. A kind brings its fragment shader, its uniform
 * names and its textures; everything else (loading, a lost context, copying the
 * picture out) is the same for all of them.
 *
 * Ruse (`ruseSmokeGl.ts`) predates this and keeps its own copy.
 */

export type SmokeStatus = 'loading' | 'ready' | 'failed'

export interface SmokeTexture {
  url: string
  /** Rows of colour ramps must not bleed into each other: clamp vertically. */
  clampY?: boolean
  /** Clamp horizontally too (a ramp read edge to edge). */
  clampX?: boolean
}

export interface SmokePainterSpec<U extends string> {
  /** For error messages. */
  name: string
  /** The fragment shader. It gets `varying vec2 vUv` (0…1 across the square, y up) from the shared vertex shader. */
  frag: string
  /** Every uniform the shader reads besides its samplers. */
  uniforms: readonly U[]
  /** Samplers in texture-unit order: `samplers[i]` reads `textures[i]`. */
  samplers: readonly string[]
  textures: readonly SmokeTexture[]
}

export interface SmokePainter<U extends string> {
  /** Whether it can paint yet; asking starts the textures loading. */
  status: () => SmokeStatus
  subscribe: (listener: () => void) => () => void
  /**
   * Clears `target` (a square 2D canvas) and paints into it with these uniform
   * values. False when it could not (no WebGL, textures not in yet): the caller
   * keeps its fallback.
   */
  paint: (target: HTMLCanvasElement, values: Partial<Record<U, number | readonly number[]>>) => boolean
}

const VERT = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }'

function loadImage(url: string, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`${name} texture did not load: ${url}`))
    image.src = url
  })
}

export function createSmokePainter<U extends string>(spec: SmokePainterSpec<U>): SmokePainter<U> {
  let status: SmokeStatus = 'loading'
  let started = false
  let painter: { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; uniforms: Record<string, WebGLUniformLocation | null> } | null = null
  const listeners = new Set<() => void>()

  const setStatus = (next: SmokeStatus) => {
    if (status === next) return
    status = next
    listeners.forEach(listener => listener())
  }

  const build = (canvas: HTMLCanvasElement, images: HTMLImageElement[]) => {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
    if (!gl) return null
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)
      if (!s) return null
      gl.shaderSource(s, source)
      gl.compileShader(s)
      if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
      console.warn(`${spec.name} shader:`, gl.getShaderInfoLog(s))
      return null
    }
    const vert = shader(gl.VERTEX_SHADER, VERT)
    const frag = shader(gl.FRAGMENT_SHADER, spec.frag)
    const program = gl.createProgram()
    if (!vert || !frag || !program) return null
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const corner = gl.getAttribLocation(program, 'a')
    gl.enableVertexAttribArray(corner)
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
    images.forEach((image, unit) => {
      const t = spec.textures[unit]
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      // WebGL 1 repeats only power-of-two textures; anything else is clamped.
      const pot = (n: number) => (n & (n - 1)) === 0
      const repeat = pot(image.width) && pot(image.height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, t.clampX || !repeat ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, t.clampY || !repeat ? gl.CLAMP_TO_EDGE : gl.REPEAT)
    })
    const uniforms: Record<string, WebGLUniformLocation | null> = {}
    for (const name of [...spec.uniforms, ...spec.samplers]) uniforms[name] = gl.getUniformLocation(program, name)
    spec.samplers.forEach((name, unit) => gl.uniform1i(uniforms[name], unit))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    return { canvas, gl, uniforms }
  }

  const start = () => {
    if (started || typeof document === 'undefined') return
    started = true
    Promise.all(spec.textures.map(t => loadImage(t.url, spec.name)))
      .then(images => {
        const canvas = document.createElement('canvas')
        // A lost context takes the smokes back to the board's plain circle until it returns.
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault()
          painter = null
          setStatus('failed')
        })
        canvas.addEventListener('webglcontextrestored', () => {
          painter = build(canvas, images)
          setStatus(painter ? 'ready' : 'failed')
        })
        painter = build(canvas, images)
        setStatus(painter ? 'ready' : 'failed')
      })
      .catch(() => setStatus('failed'))
  }

  return {
    status: () => {
      start()
      return status
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    paint: (target, values) => {
      const ctx = target.getContext('2d')
      if (!ctx || !painter || status !== 'ready') return false
      const size = target.width
      ctx.clearRect(0, 0, size, size)
      if (size <= 0) return true
      const { canvas, gl, uniforms } = painter
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size
        canvas.height = size
      }
      gl.viewport(0, 0, size, size)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (const name in values) {
        const v = values[name]
        const at = uniforms[name]
        if (v === undefined || !at) continue
        if (typeof v === 'number') gl.uniform1f(at, v)
        else if (v.length === 2) gl.uniform2f(at, v[0], v[1])
        else if (v.length === 3) gl.uniform3f(at, v[0], v[1], v[2])
        else if (v.length === 4) gl.uniform4f(at, v[0], v[1], v[2], v[3])
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      ctx.drawImage(canvas, 0, 0)
      return true
    },
  }
}

/** The picture's backing size, device pixels: a step up from what is on screen, within these. */
const MIN_SIZE = 64
const MAX_SIZE = 512
const SIZE_STEP = 32

/** Sizes a smoke's 2D canvas for how big it is on screen now. */
export function fitSmokeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const shown = canvas.getBoundingClientRect().width * dpr
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.ceil(shown / SIZE_STEP) * SIZE_STEP))
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
}
