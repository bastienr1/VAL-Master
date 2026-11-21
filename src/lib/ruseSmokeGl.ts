/**
 * Draws Clove's Ruse from straight above (docs/plays-editor-v2.md §2.21): the
 * game's sphere with the game's stripe texture, smoke texture and colour ramps
 * (`src/assets/ruse`, taken from `SMO_Stripes_TFX`, `SMO_SmokeBombPack01_TFX`
 * and the `SMO_E_*_LUT` ramps), drifting at the material's own speeds. How the
 * layers mix is rebuilt by eye from in-game pictures: the cooked materials
 * give the textures and numbers, not the node graph.
 *
 * One WebGL context for the whole app, however many smokes are up: each smoke
 * is rendered here and copied into its own 2D canvas.
 */

import lutUrl from '../assets/ruse/lut.png'
import packUrl from '../assets/ruse/pack.png'
import stripesUrl from '../assets/ruse/stripes.png'
import type { RuseCast, RuseState } from './ruseSmoke.ts'

/** The picture's half-width in shell radii: room for the tenth it overshoots as it forms. */
export const RUSE_EXTENT = 1.12

const VERT = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }'

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uStripes, uPack, uLut;
uniform float uTime, uScale, uDissolve, uMode, uDead, uView, uOpacity, uPx;

vec3 lut(float row, float x){ return texture2D(uLut, vec2(x, (row + 0.5) / 8.0)).rgb; }

// The stripe texture at (u, v). Towards the pole the wrap squeezes every wave
// into a spike, so there the angle is let go and the stripes close into rings.
float stripeTex(vec2 uv, float uFree, float ring){
  return mix(texture2D(uStripes, vec2(uFree, uv.y)).r, texture2D(uStripes, uv).r, ring);
}
// Stripes_Width is the cut: everything of the texture above it is stripe, so the
// stripes are the wide white bands and the cover shows in the thinner gaps.
float stripeMask(float s, float width, float soft){
  return smoothstep(width - soft, width + soft, s);
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;
  float r = length(p) / max(uScale, 0.001);
  if (r >= 1.0) { gl_FragColor = vec4(0.0); return; }

  // The game's sphere: u runs around it, v from the top pole (0) to the equator (0.5).
  float z = sqrt(1.0 - r * r);
  float v = asin(r) / 3.14159265;
  float u = atan(p.y, p.x) / 6.2831853 + 0.5;
  float t = uTime;
  float core = smoothstep(0.03, 0.38, r);

  // Cover layer: the banded smoke texture, twisted round the sphere, drifting
  // (Smoke_Tex_Scale 2, speed 0.1 / -0.05 at GLOBAL_Speed 0.5, TwistStrength -2).
  vec2 cuv = vec2(u * 2.0 - 2.0 * v, v * 2.0) + t * 0.5 * vec2(0.1, -0.05);
  vec3 pk = texture2D(uPack, cuv).rgb;
  vec3 pkCore = texture2D(uPack, vec2(0.31, v * 2.0) + t * 0.5 * vec2(0.1, -0.05)).rgb;
  pk = mix(pkCore, pk, core);
  float bands = pk.b;
  float soft = texture2D(uPack, vec2(u + v, v * 1.2) + t * vec2(0.012, -0.02)).r;
  soft = mix(texture2D(uPack, vec2(0.6, v * 1.2) + t * vec2(0.012, -0.02)).r, soft, core);

  vec3 body = lut(0.0, bands * 0.55 + soft * 0.6 + t * 0.045);
  // Blue-violet undertone in the creases, a lighter core, a darker lower rim.
  float fres = pow(1.0 - z, 1.3);
  body = mix(body, vec3(0.34, 0.27, 0.93), (1.0 - bands) * 0.30);
  body = mix(body, vec3(1.0), 0.08 * (1.0 - fres));
  body *= mix(0.96, 0.74, fres);
  // After death the cover goes dark indigo and the stripes take the colour.
  vec3 deadBody = mix(vec3(0.085, 0.06, 0.30), body * vec3(0.42, 0.36, 0.78), 0.4 + 0.25 * bands);
  body = mix(body, deadBody, uDead);

  // Stripes: scrolling round and outward (Stripe_Tex_Speed 0.05 / -0.035), slightly warped.
  vec2 warp = (texture2D(uPack, vec2(u * 4.0, v * 3.0) + t * vec2(0.02, -0.02)).rg - 0.5) * 0.05 * core;
  vec2 suv = vec2(u, v) + t * vec2(0.05, -0.035) + warp;
  float width = mix(0.30, 0.21, uDead);
  float uFree = 0.13 + t * 0.05;
  float sv = stripeTex(suv, uFree, core);
  float stripe = stripeMask(sv, width, 0.04);
  // The stripes float 1.5 % above the cover and drop a soft purple shadow on it.
  float shadow = stripeMask(stripeTex(suv - vec2(0.0, 0.022), uFree, core), width, 0.14) * (1.0 - stripe);
  vec3 stripeCol = mix(lut(3.0, sv * 2.0 + t * 0.3), lut(4.0, 0.34 + sv * 0.28 + soft * 0.2 + 0.1 * sin(t * 0.9)), uDead);
  stripeCol *= mix(1.0, 0.86, fres);

  // Dissolve: in from the centre as it forms, out in wisps as it ends; the
  // edge passes through the mid ramp (magenta to blue) and the under ramp (orange).
  float fIn = 1.0 - (r * 0.72 + soft * 0.28);
  float fOut = soft * 0.55 + pk.g * 0.25 + (1.0 - r) * 0.2;
  float e = mix(fIn, fOut, uMode) - uDissolve;
  float vis = smoothstep(0.0, 0.035, e);
  float under = 1.0 - smoothstep(0.02, 0.13, e);
  float mid = 1.0 - smoothstep(0.10, 0.30, e);
  float stripeVis = smoothstep(0.0, 0.035, e + 0.12);

  vec3 col = body;
  col = mix(col, col * vec3(0.69, 0.47, 0.81), shadow * 0.7 * (1.0 - uDead));
  col = mix(col, lut(1.0, pk.g + t * 0.2), mid * 0.85);
  col = mix(col, min(lut(2.0, soft * 0.8 + 0.1) * 1.15, 1.0), under);
  col = mix(col, stripeCol, stripe * 0.94 * stripeVis);
  float a = max(vis, stripe * stripeVis);

  float edge = 1.0 - smoothstep(1.0 - 2.5 * uPx, 1.0, r);
  a *= edge * uOpacity;
  gl_FragColor = vec4(col * a, a);
}`

const UNIFORMS = ['uStripes', 'uPack', 'uLut', 'uTime', 'uScale', 'uDissolve', 'uMode', 'uDead', 'uView', 'uOpacity', 'uPx'] as const
type UniformName = (typeof UNIFORMS)[number]

export type RuseStatus = 'loading' | 'ready' | 'failed'

interface Painter {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  uniforms: Record<UniformName, WebGLUniformLocation | null>
}

let status: RuseStatus = 'loading'
let painter: Painter | null = null
let started = false
const listeners = new Set<() => void>()

function setStatus(next: RuseStatus) {
  if (status === next) return
  status = next
  listeners.forEach(listener => listener())
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Ruse texture did not load: ${url}`))
    image.src = url
  })
}

function build(canvas: HTMLCanvasElement, images: HTMLImageElement[]): Painter | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
  }
  const vert = shader(gl.VERTEX_SHADER, VERT)
  const frag = shader(gl.FRAGMENT_SHADER, FRAG)
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
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    // The ramps sit one per row: a row must not bleed into the next.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, unit === 2 ? gl.CLAMP_TO_EDGE : gl.REPEAT)
  })
  const uniforms = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])) as Painter['uniforms']
  gl.uniform1i(uniforms.uStripes, 0)
  gl.uniform1i(uniforms.uPack, 1)
  gl.uniform1i(uniforms.uLut, 2)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  return { canvas, gl, uniforms }
}

function start() {
  if (started || typeof document === 'undefined') return
  started = true
  Promise.all([loadImage(stripesUrl), loadImage(packUrl), loadImage(lutUrl)])
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

/** Whether the smoke can be drawn yet; asking starts the textures loading. */
export function ruseStatus(): RuseStatus {
  start()
  return status
}

export function subscribeRuse(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Paints the smoke in `state` onto `target`, a square 2D canvas, filling it
 * with `RUSE_EXTENT` shell radii either side of the centre. False when it
 * could not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintRuse(target: HTMLCanvasElement, state: RuseState, cast: RuseCast, opacity: number): boolean {
  const ctx = target.getContext('2d')
  if (!ctx || !painter || status !== 'ready') return false
  const size = target.width
  ctx.clearRect(0, 0, size, size)
  if (!(state.scale > 0) || size <= 0) return true
  const { canvas, gl, uniforms } = painter
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
  gl.viewport(0, 0, size, size)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniform1f(uniforms.uTime, state.materialTime)
  gl.uniform1f(uniforms.uScale, state.scale)
  gl.uniform1f(uniforms.uDissolve, state.dissolve)
  gl.uniform1f(uniforms.uMode, state.mode)
  gl.uniform1f(uniforms.uDead, cast === 'afterDeath' ? 1 : 0)
  gl.uniform1f(uniforms.uView, RUSE_EXTENT)
  gl.uniform1f(uniforms.uOpacity, opacity)
  gl.uniform1f(uniforms.uPx, (2 * RUSE_EXTENT) / size / Math.max(state.scale, 0.001))
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  ctx.drawImage(canvas, 0, 0)
  return true
}
