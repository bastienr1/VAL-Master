/**
 * Draws Brimstone's Incendiary from straight above, in two passes as the
 * prototype page does (VAL-Master-Plays/prototypes/incendiary), unchanged in
 * effect:
 *
 * 1. The burning ground: the decal's fire noise (`sarge_fire`) scrolled in
 *    polar UVs and bent by `FlowMap_2`, the outline of `Sarge_Molotov_Mask`,
 *    the hot rim of DecalRing, coloured through the ground ramp (a dark navy
 *    pool, purple veins, the orange ring on the edge). One full-square shader,
 *    on the shared painter (`smokeGl.ts`).
 * 2. The flames: every sprite of the state (16-frame `Sarge_FireFB_C`
 *    flipbooks, embers, the impact's flash, streaks, sparks and smoke), each a
 *    textured quad coloured through the emitters' ramps. The shared painter
 *    draws one square and no geometry, so this pass has a small context of its
 *    own here, laid over the ground on the same 2D canvas (premultiplied
 *    source-over, the blend the page uses inside its one context).
 *
 * Textures (`src/assets/incendiary`): `flip` (R/G the flipbook's grey and
 * alpha, B/A its blurred copy), `ground` (R sarge_fire, G/B the flow map, A
 * T_Noise_Blurry), `mask` (the outline) and `lut` (eight colour ramps, one per
 * row, at the page's exposure 1 − e^(−0.12 × HDR)). How the layers mix is
 * rebuilt by eye against in-game shots: the cooked materials give the textures
 * and numbers, not the node graph.
 */

import flipUrl from '../assets/incendiary/flip.png'
import groundUrl from '../assets/incendiary/ground.png'
import lutUrl from '../assets/incendiary/lut.png'
import maskUrl from '../assets/incendiary/mask.png'
import { INCENDIARY, type IncendiarySprite, type IncendiaryState } from './incendiary.ts'
import { createSmokePainter, type SmokeStatus } from './smokeGl.ts'

/** The picture's half-width in hurt radii: 6 m either side, room for the impact's streaks and sparks. */
export const INCENDIARY_EXTENT = 4 / 3

/** The same in world cm. */
const VIEW_CM = INCENDIARY_EXTENT * INCENDIARY.hurtCm

/** Display exposure of the colour ramps: 1 − exp(−K × HDR). */
const K_EXPOSURE = '0.120'

const FRAG_GROUND = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uGround, uMask, uLut;
uniform float uTime, uView, uSpread, uGlow, uGlowScale, uBurn, uEnemy, uOpacity, uDecal, uRimW, uRimBand, uOutlineAdd;
const float K = ${K_EXPOSURE};
vec3 lut(float row, float x){ return texture2D(uLut, vec2(clamp(x, 0.004, 0.996), (row + 0.5) / 8.0)).rgb; }
vec3 hdr(vec3 c){ return -log(max(1.0 - c, 0.004)) / K; }
void main(){
  vec2 p = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0) * uView;      // world cm, y down like the board
  float r = length(p);
  float area = 1.0 - smoothstep(uSpread - 10.0, uSpread, r);       // the patch so far, 10 cm soft edge
  if (area <= 0.0 || uGlow <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float t = uTime;
  vec2 uvP = p / (2.0 * uDecal) + 0.5;                               // decal box UV, 5 m half-size
  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
  float rad = r / (2.0 * uDecal);
  // Flow map distortion (TextureA 5 × 6, scrolled for B and for C, strength 0.2).
  vec2 flowB = (texture2D(uGround, uvP * vec2(5.0, 6.0) + t * vec2(-0.2, 0.4)).gb - 0.5) * 0.2;
  vec2 flowC = (texture2D(uGround, uvP * vec2(5.0, 6.0) + t * vec2(0.3, 0.2)).gb - 0.5) * 0.2;
  // Fire noise in polar UVs: B 3 × 0.25 scrolling −0.15/s, E 2 × 0.4 scrolling −0.2/s.
  float B = texture2D(uGround, vec2(ang * 3.0, rad * 0.25 / uGlowScale) + vec2(0.0, -0.15 * t) + flowB).r;
  // Near the pole the polar wrap pinches every cell into a spike; there a flat copy takes over.
  float pole = smoothstep(40.0, 170.0, r);
  B = mix(texture2D(uGround, uvP * vec2(1.5, 1.5) + vec2(0.0, -0.15 * t) * 0.3 + flowB).r, B, pole);
  B = clamp((pow(B, 2.0) * 2.0 - 0.5) * 1.3 + 0.5, 0.0, 1.0);
  float E = texture2D(uGround, vec2(ang * 2.0, rad * 0.4) + vec2(0.0, -0.2 * t) + flowC).r;
  E = mix(texture2D(uGround, uvP * 1.2 + vec2(0.0, -0.2 * t) * 0.3 + flowC).r, E, pole);
  float mask = pow(texture2D(uGround, uvP * 0.6 + flowC * 0.5).r, 2.0);
  // Burn-in: the dissolve copy (1.6 × 1.6) opens with the decal's 4th parameter.
  float d = texture2D(uGround, uvP * 1.6 + flowB).r;
  float open = smoothstep(0.0, 0.12, uBurn * 1.15 - (1.0 - d) * 0.9);
  // Outline from Sarge_Molotov_Mask (G rises to the edge), pow 2, plus the instance's add.
  vec3 mk = texture2D(uMask, uvP).rgb;
  float outline = pow(mk.g, 2.0) + uOutlineAdd;
  // DecalRing (300, 30 ally / 10 enemy, 3.5): a hot band rising over the outer 300 cm with power 3.5,
  // and a sharp line of 30 / 10 cm on the edge itself. Inside it the pool stays dark navy with purple veins.
  float band = pow(clamp(1.0 - (uSpread - r) / uRimBand, 0.0, 1.0), 3.5);
  float rim = pow(clamp(1.0 - (uSpread - r) / uRimW, 0.0, 1.0), 3.5);
  float veins = B * (0.5 + 0.8 * E) * (0.6 + 0.4 * mask);
  float inner = 0.02 + 0.36 * pow(clamp(veins, 0.0, 1.0), 1.6);
  float outer = 0.62 + 0.38 * clamp(B * (0.6 + 0.6 * E) * (0.7 + 0.5 * outline), 0.0, 1.0);
  float heat = clamp(mix(inner, outer, clamp(band * (0.8 + 0.5 * outline), 0.0, 1.0)), 0.0, 1.0);
  vec3 col = hdr(lut(5.0 + uEnemy, heat)) * uGlow;
  col += hdr(lut(5.0 + uEnemy, 1.0)) * rim * 1.2 * uGlow;
  vec3 rgb = 1.0 - exp(-K * col);
  // The scorch itself darkens the ground (DecalColor black) under the glow.
  float a = area * open * (0.55 + 0.45 * uGlow);
  float lumi = max(rgb.r, max(rgb.g, rgb.b));
  float aOut = clamp(a * max(0.62, lumi), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(rgb * a * uOpacity, aOut);
}`

const GROUND_UNIFORMS = ['uTime', 'uView', 'uSpread', 'uGlow', 'uGlowScale', 'uBurn', 'uEnemy', 'uOpacity', 'uDecal', 'uRimW', 'uRimBand', 'uOutlineAdd'] as const

const ground = createSmokePainter({
  name: 'Incendiary',
  frag: FRAG_GROUND,
  uniforms: GROUND_UNIFORMS,
  samplers: ['uGround', 'uMask', 'uLut'],
  textures: [{ url: groundUrl }, { url: maskUrl, clampX: true, clampY: true }, { url: lutUrl, clampX: true, clampY: true }],
})

// ── The flames: one textured quad per sprite ─────────────────────────────────

const VERT_SPRITE = `
attribute vec2 aPos; attribute vec2 aUv; attribute vec4 aA; attribute vec4 aM; attribute vec4 aM2; attribute vec3 aCol;
uniform float uView;
varying vec2 vUv; varying vec4 vA; varying vec4 vM; varying vec4 vM2; varying vec3 vCol; varying vec2 vW;
void main(){ vUv = aUv; vA = aA; vM = aM; vM2 = aM2; vCol = aCol; vW = aPos; gl_Position = vec4(aPos.x / uView, -aPos.y / uView, 0.0, 1.0); }`

const FRAG_SPRITE = `
precision highp float;
uniform sampler2D uFlip, uGround, uLut;
uniform float uEnemy, uOpacity, uClip, uRimBand;
varying vec2 vUv; varying vec4 vA; varying vec4 vM; varying vec4 vM2; varying vec3 vCol; varying vec2 vW;
const float K = ${K_EXPOSURE};
vec3 lut(float row, float x){ return texture2D(uLut, vec2(clamp(x, 0.004, 0.996), (row + 0.5) / 8.0)).rgb; }
vec3 hdr(vec3 c){ return -log(max(1.0 - c, 0.004)) / K; }
void main(){
  float kind = vA.x, frame = vA.y, alpha = vA.z, noiseOff = vA.w;
  float g = 1.0, a = 0.0;
  if (kind < 1.5) {
    float f = clamp(floor(frame), 0.0, 15.0);
    vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
    vec2 uv = (cell + clamp(vUv, 0.002, 0.998)) / 4.0;
    vec4 fb = texture2D(uFlip, uv);
    g = kind < 0.5 ? fb.r : fb.b;
    a = kind < 0.5 ? fb.g : fb.a;
    if (frame >= 16.0) a = 0.0;
  } else if (kind < 2.5) {
    float r = length(vUv * 2.0 - 1.0);
    a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
  } else if (kind < 3.5) {
    float across = abs(vUv.x * 2.0 - 1.0), along = vUv.y;
    a = pow(1.0 - across, 2.0) * smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.55, 1.0, along));
  } else {
    float r = length(vUv * 2.0 - 1.0);
    float n = texture2D(uGround, vUv * 0.5 + noiseOff).a;
    a = clamp((1.0 - r) * 1.6 * (0.5 + n), 0.0, 1.0);
  }
  float n2 = texture2D(uGround, vUv * 0.5 + noiseOff).a;
  a = clamp(a * vM.z * pow(max(n2, 0.001), vM2.x) * vM.w, 0.0, 1.0) * alpha;
  vec3 base = vCol;
  if (vM2.y >= 0.0) {
    float row = vM2.y;
    if (row > 2.5 && row < 3.5) {
      // Burning flames take the ground's split (rebuilt against in-game shots): purple-magenta
      // (the files' blue-to-red ramp, its middle) over the pool, the Flame colour in the hot rim band.
      float band = pow(clamp(1.0 - (uClip - length(vW)) / uRimBand, 0.0, 1.0), 3.5);
      vec3 inner = hdr(lut(1.0, 0.45 + 0.2 * vM2.z)) * 0.95;
      vec3 outer = hdr(lut(3.0 + uEnemy, vM2.z));
      base = mix(inner, outer, clamp(band * 1.4, 0.0, 1.0)) * vCol;
    } else {
      base = hdr(lut(row, vM2.z)) * vCol;
    }
    if (row > 6.5) base.g *= mix(1.0, 0.5, uEnemy);  // impact burst: enemy (20, 1.5, 0.5) vs ally (20, 3, 0.5)
  }
  vec3 em = base * pow(max(g, 0.0), vM.y) * vM.x;
  vec3 rgb = 1.0 - exp(-K * em);
  // Flames stand on the burning floor: seen from above they are kept inside the patch
  // (flames on the edge may lick 45 cm past it).
  if (vM2.w > 0.5) a *= 1.0 - smoothstep(uClip, uClip + 45.0, length(vW));
  a *= uOpacity;
  gl_FragColor = vec4(rgb * a, a);
}`

/** Floats per vertex: position 2, uv 2, (kind, frame, alpha, noise), material 4, (alpha power, row, row x, clip), colour 3. */
const STRIDE = 19
const ATTRIBUTES = [['aPos', 2, 0], ['aUv', 2, 2], ['aA', 4, 4], ['aM', 4, 8], ['aM2', 4, 12], ['aCol', 3, 16]] as const
const SPRITE_UNIFORMS = ['uView', 'uEnemy', 'uOpacity', 'uClip', 'uRimBand'] as const
/** Samplers in texture-unit order. */
const SPRITE_SAMPLERS = ['uFlip', 'uGround', 'uLut'] as const
const SPRITE_TEXTURES = [{ url: flipUrl, clamp: false }, { url: groundUrl, clamp: false }, { url: lutUrl, clamp: true }] as const
const CORNERS = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]] as const

interface SpriteLayer {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  uniforms: Record<(typeof SPRITE_UNIFORMS)[number], WebGLUniformLocation | null>
}

let spriteStatus: SmokeStatus = 'loading'
let spritesStarted = false
let layer: SpriteLayer | null = null
let vertices = new Float32Array(STRIDE * 6 * 256)
const spriteListeners = new Set<() => void>()

function setSpriteStatus(next: SmokeStatus): void {
  if (spriteStatus === next) return
  spriteStatus = next
  spriteListeners.forEach(listener => listener())
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Incendiary texture did not load: ${url}`))
    image.src = url
  })
}

function buildSprites(canvas: HTMLCanvasElement, images: HTMLImageElement[]): SpriteLayer | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
    console.warn('Incendiary flames shader:', gl.getShaderInfoLog(s))
    return null
  }
  const vert = shader(gl.VERTEX_SHADER, VERT_SPRITE)
  const frag = shader(gl.FRAGMENT_SHADER, FRAG_SPRITE)
  const program = gl.createProgram()
  if (!vert || !frag || !program) return null
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  for (const [name, size, offset] of ATTRIBUTES) {
    const at = gl.getAttribLocation(program, name)
    if (at < 0) continue
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, STRIDE * 4, offset * 4)
  }
  images.forEach((image, unit) => {
    const wrap = SPRITE_TEXTURES[unit].clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  })
  SPRITE_SAMPLERS.forEach((name, unit) => gl.uniform1i(gl.getUniformLocation(program, name), unit))
  const uniforms = {} as SpriteLayer['uniforms']
  for (const name of SPRITE_UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // translucent, grey transmittance: emissive over (1 − α)
  return { canvas, gl, uniforms }
}

function startSprites(): void {
  if (spritesStarted || typeof document === 'undefined') return
  spritesStarted = true
  Promise.all(SPRITE_TEXTURES.map(t => loadImage(t.url)))
    .then(images => {
      const canvas = document.createElement('canvas')
      // A lost context takes the fire back to the board's plain disc until it returns.
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        layer = null
        setSpriteStatus('failed')
      })
      canvas.addEventListener('webglcontextrestored', () => {
        layer = buildSprites(canvas, images)
        setSpriteStatus(layer ? 'ready' : 'failed')
      })
      layer = buildSprites(canvas, images)
      setSpriteStatus(layer ? 'ready' : 'failed')
    })
    .catch(() => setSpriteStatus('failed'))
}

/** Writes each sprite as two triangles; returns the number of vertices. */
function writeSprites(list: readonly IncendiarySprite[]): number {
  const need = list.length * 6 * STRIDE
  if (vertices.length < need) vertices = new Float32Array(need * 2)
  let o = 0
  for (const s of list) {
    const c = Math.cos(s.rot)
    const sn = Math.sin(s.rot)
    const streak = s.kind === 3
    const hw = s.size / 2
    const hl = streak ? s.len / 2 : s.size / 2
    const flipU = s.kind < 2 && s.noise > 0.5
    const flipV = s.kind < 2 && (s.noise * 7) % 1 > 0.5
    for (const [u, v] of CORNERS) {
      // Streaks: v runs along the direction (rot), u across it.
      const lx = (u * 2 - 1) * hw
      const ly = (v * 2 - 1) * hl
      vertices[o++] = streak ? s.x + c * ly - sn * lx : s.x + c * lx - sn * ly
      vertices[o++] = streak ? s.y + sn * ly + c * lx : s.y + sn * lx + c * ly
      vertices[o++] = flipU ? 1 - u : u
      vertices[o++] = flipV ? 1 - v : v
      vertices[o++] = s.kind
      vertices[o++] = s.frame
      vertices[o++] = s.alpha
      vertices[o++] = s.noise
      vertices[o++] = s.mat[0]
      vertices[o++] = s.mat[1]
      vertices[o++] = s.mat[2]
      vertices[o++] = s.mat[3]
      vertices[o++] = s.mat[4]
      vertices[o++] = s.row
      vertices[o++] = s.rx
      vertices[o++] = s.clip ? 1 : 0
      vertices[o++] = s.col[0]
      vertices[o++] = s.col[1]
      vertices[o++] = s.col[2]
    }
  }
  return o / STRIDE
}

/** Whether the fire can be drawn yet; asking starts the textures loading. */
export function incendiaryStatus(): SmokeStatus {
  startSprites()
  const below = ground.status()
  if (below === 'failed' || spriteStatus === 'failed') return 'failed'
  return below === 'ready' && spriteStatus === 'ready' ? 'ready' : 'loading'
}

export function subscribeIncendiary(listener: () => void): () => void {
  const unsubscribe = ground.subscribe(listener)
  spriteListeners.add(listener)
  return () => {
    unsubscribe()
    spriteListeners.delete(listener)
  }
}

/**
 * Paints the fire in `state` onto `target`, a square 2D canvas, filling it
 * with `INCENDIARY_EXTENT` hurt radii either side of the centre. Allies'
 * colours unless `enemy`: then the files' _FOE treatment (a redder flame and
 * impact burst, a 10 cm edge line in place of 30). False when it could not
 * (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintIncendiary(target: HTMLCanvasElement, state: IncendiaryState, enemy: boolean, opacity: number): boolean {
  if (incendiaryStatus() !== 'ready' || !layer) return false
  const side = enemy ? 'enemy' : 'ally'
  const spreadCm = state.spread * INCENDIARY.hurtCm
  // The ground; it also clears the canvas (and draws nothing with no glow, or before the fire starts out).
  const painted = ground.paint(target, {
    uTime: state.materialTime,
    uView: VIEW_CM,
    uSpread: spreadCm,
    uGlow: spreadCm > 0 ? state.glow : 0,
    uGlowScale: state.glowScale,
    uBurn: state.burn,
    uEnemy: enemy ? 1 : 0,
    uOpacity: opacity,
    uDecal: INCENDIARY.decalCm,
    uRimW: INCENDIARY.rimLineCm[side],
    uRimBand: INCENDIARY.rimBandCm,
    uOutlineAdd: INCENDIARY.outlineAdd[side],
  })
  if (!painted) return false
  const size = target.width
  const ctx = target.getContext('2d')
  if (state.sprites.length === 0 || size <= 0 || !ctx) return true
  // The flames, over it.
  const { canvas, gl, uniforms } = layer
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size
    canvas.height = size
  }
  gl.viewport(0, 0, size, size)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  const count = writeSprites(state.sprites)
  gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW)
  gl.uniform1f(uniforms.uView, VIEW_CM)
  gl.uniform1f(uniforms.uEnemy, enemy ? 1 : 0)
  gl.uniform1f(uniforms.uOpacity, opacity)
  gl.uniform1f(uniforms.uClip, spreadCm)
  gl.uniform1f(uniforms.uRimBand, INCENDIARY.rimBandCm)
  gl.drawArrays(gl.TRIANGLES, 0, count)
  ctx.drawImage(canvas, 0, 0)
  return true
}
