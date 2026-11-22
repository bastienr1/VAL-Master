/**
 * Draws Miks's Waveform from straight above. Ported from the prototype page
 * (VAL-Master-Plays/prototypes/waveform-smoke), same uniforms and textures:
 * `src/assets/waveform/atlas.png` (R `VFX_Iris_ripples_TFX`, G `VFX_Iris_sphere_TFX`,
 * B `Iris_E_Distortion_Test_02_TFX`), `flow.png` (`IRIS_FlowMap_TFX`) and
 * `ramps.png` (row 0 the Nora LUT `IRIS_E_SmokeProxy5_LUT`, 1 `IRIS_E_SmokeProxy3B_LUT`,
 * 2 the `AlphaGrad_ScrollE` line profile, 3 `Gradient_Vertical_Ramp_MiddleTight`,
 * 4 `AlphaGrad_ScrollB`). Colours are the materials' own; how the layers mix is
 * rebuilt by eye (cooked materials keep parameters, not the node graph), balanced
 * green-first against in-game pictures: Background green body, Nora LUT lime /
 * yellow toward the centre, Nora ally green rim, purple only as a thin edge.
 */

import atlasUrl from '../assets/waveform/atlas.png'
import flowUrl from '../assets/waveform/flow.png'
import rampsUrl from '../assets/waveform/ramps.png'
import { createSmokePainter, type SmokeStatus } from './smokeGl.ts'
import { WAVEFORM, type WaveformState } from './waveformSmoke.ts'

/**
 * The picture's half-width in shell radii: room for the wave-line shell (1.02),
 * the edge decal (1.07) and the landing shockwave (1.10) with its soft edge.
 */
export const WAVEFORM_EXTENT = 1.15

/** The wave-line shell in shell radii. */
const LINES_R = (WAVEFORM.linesCm / WAVEFORM.shellCm).toFixed(4)

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uAtlas, uFlow, uRamps;
uniform float uTime, uView, uPx, uOpacity, uEnemy;
uniform float uDissolve, uWipeR, uWipeA, uWipeDir, uLinesA, uBands, uInd, uIndA, uShockR, uShockA;
uniform float uDecalR, uDecalA, uWarnGlow, uGlowR, uGlowA;

vec3 ramp(float row, float x){ return texture2D(uRamps, vec2(clamp(x, 0.004, 0.996), (row + 0.5) / 8.0)).rgb; }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 shoulder(vec3 x){ return mix(x, 0.6 + 0.4 * (1.0 - exp(-(x - 0.6) / 0.4)), step(0.6, x)); }

// Material parameters (linear colours) from the game files.
const vec3 SOFTF  = vec3(0.3796, 0.1825, 0.6753);  // Soft Fresnel Color
const vec3 BACKG  = vec3(0.1315, 0.3976, 0.2251);  // Background Color
const vec3 ALLYG  = vec3(0.04, 0.214, 0.129);      // Nora_Allycolor
const vec3 LINEC  = vec3(1.752 * 0.584, 1.188 * 0.397, 3.0) * 5.0;  // OuterLayer Color × particle colour × 5
const vec3 WIPEC  = vec3(3.309, 5.0, 2.586);       // Bright Intro
const vec3 SHOCKC = vec3(1.478, 0.965, 2.0);       // InnerDecal shockwave
const vec3 INDC   = vec3(0.58, 0.39, 1.0) * 2.0;   // Inverse_Depth indicator
const vec3 DECALC = vec3(0.088, 0.057, 0.205);     // smoke-edge decal
const vec3 GLOWC  = vec3(1.615, 0.978, 2.0);       // GlowGrow (× colour scale 2 → 1 in the state)
const vec3 WARNC  = vec3(0.337, 1.0, 1.0);         // 9DFFFF
const vec3 ENEMYC = vec3(12.0, 0.0, 0.0);          // TeamColor, enemy

void addLight(inout vec4 acc, vec3 c){ acc.rgb += c; acc.a = max(acc.a, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0)); }
void over(inout vec4 acc, vec3 c, float a){ acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;            // in shell radii (4.104 m), y up
  float r = length(p);
  float t = uTime;
  vec2 sUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);  // screen-space UV over the shell, top = 0
  vec4 acc = vec4(0.0);                           // premultiplied, linear

  // Ground: the smoke-edge decal, a dark ring at 4.0 m (750 × 0.82 × Radius Scale 0.65).
  if (uDecalA > 0.0) {
    float rr = r / max(uDecalR * 0.975, 0.001);
    float band = smoothstep(0.90, 1.0, rr) * (1.0 - smoothstep(1.0, 1.10, rr));
    float floorMask = ramp(4.0, fract(rr * 1.0 + t * 0.05)).r;   // AlphaGrad_ScrollB, V speed −0.5 (slowed)
    over(acc, DECALC * (1.0 + floorMask), band * uDecalA * 0.9);
  }
  // Ground: the intro shockwave decal.
  if (uShockA > 0.0) {
    float sw = smoothstep(uShockR - 0.25, uShockR, r) * (1.0 - smoothstep(uShockR, uShockR + 0.03, r));
    addLight(acc, SHOCKC * sw * uShockA * 1.6);
  }
  // The indicator sphere that grows out to the footprint just before it forms.
  if (uIndA > 0.0 && r < uInd) {
    float ir = r / uInd, iz = sqrt(1.0 - ir * ir);
    float rim = pow(1.0 - iz, 6.0);
    float d = texture2D(uAtlas, vec2(sUv.x * 3.0, sUv.y) + t * vec2(0.1, 0.2)).b - 0.5;
    float lp = ramp(2.0, fract((0.5 - p.y / (2.0 * uInd)) * 10.0 + t * 0.2 + d * 0.9)).r;
    float a = clamp(0.16 + 0.9 * rim + 0.3 * lp, 0.0, 1.0) * uIndA * (1.0 - smoothstep(1.0 - 2.0 * uPx / uInd, 1.0, ir));
    over(acc, INDC * (0.35 + 1.2 * rim + 0.5 * lp), a);
  }

  // The shell (IRIS_E_SmokeProxy5_MI, masked): Background green body, lighter lime / yellow toward
  // the centre from the Nora LUT (screen-centred sphere texture), a darker Nora-ally green rim, the
  // Nora ripple bands in the LUT's yellow, and only a thin Soft Fresnel purple accent at the edge.
  float reveal = 0.6 * (uDissolve + 1.0);          // Dissolve −1…1 as the cut through r and noise
  if (r < 1.0 && reveal > 0.0) {
    float z = sqrt(1.0 - r * r), fres = 1.0 - z;
    vec2 fl = texture2D(uFlow, sUv * 0.8 + t * vec2(0.015, -0.025)).rg - 0.5;
    float rip = texture2D(uAtlas, vec2(sUv.x, sUv.y + t * 0.06) + fl * 0.05).r;
    float sph = texture2D(uAtlas, sUv + fl * 0.03).g;
    float nora = rip * sph;
    vec3 bc = BACKG;
    float cg = 1.0 - smoothstep(0.0, 0.9, r);
    bc = mix(bc, toLin(ramp(0.0, 0.05 + 0.4 * sph)) * vec3(0.8, 0.95, 0.55), 0.45 + 0.45 * cg);
    bc = mix(bc, ALLYG * vec3(1.6, 1.5, 1.0), smoothstep(0.6, 1.0, r) * 0.6);
    bc = mix(bc, SOFTF, smoothstep(0.975, 1.0, r) * 0.3);
    vec3 glyph = toLin(ramp(0.0, 0.35 + 0.65 * smoothstep(0.1, 0.9, nora)));
    glyph = mix(glyph, ENEMYC * (0.03 + 0.05 * nora), uEnemy);
    bc = mix(bc, glyph, smoothstep(0.08, 0.6, nora) * 0.7);
    bc = mix(bc, bc * 0.5 + ENEMYC * 0.012, uEnemy * smoothstep(0.5, 1.0, r));
    bc += WARNC * uWarnGlow * (0.06 + 0.8 * pow(fres, 2.0));
    // Dissolve: in from the crown outward, back in from the rim at the end.
    float n = texture2D(uFlow, sUv * 2.5 + vec2(0.37, 0.11)).b;
    float ev = r * 0.86 + n * 0.14;
    float vis = (1.0 - smoothstep(reveal - 2.0 * uPx, reveal, ev)) * (1.0 - smoothstep(1.0 - 2.0 * uPx, 1.0, r));
    over(acc, bc, vis);
  }
  // Bright Intro / outro wipe (Gradient_Vertical_Ramp_MiddleTight), a pale-green band.
  if (uWipeA > 0.0 && r < ${LINES_R}) {
    float w = ramp(3.0, 0.45 + (uWipeR - r) * 4.0 * uWipeDir).r;
    addLight(acc, WIPEC * w * uWipeA * 0.22);
  }
  // Centre glow as it lands.
  if (uGlowA > 0.0) addLight(acc, GLOWC * exp(-3.0 * r * r / max(uGlowR * uGlowR, 1e-4)) * uGlowA * 0.6);

  // OuterLines: ten screen-facing wave lines (AlphaGrad_ScrollE), drifting and bent by the distortion texture.
  float lr = r / ${LINES_R};
  if (uLinesA > 0.0 && lr < 1.0) {
    float ys = 0.5 - p.y / (2.0 * ${LINES_R});
    float xs = p.x / (2.0 * ${LINES_R}) + 0.5;
    float d = texture2D(uAtlas, vec2(xs * 3.0, ys) + t * vec2(0.1, 0.2)).b - 0.5;
    float prof = ramp(2.0, fract(ys * 10.0 + t * 0.2 + d * 0.6)).r;
    float bandMask = smoothstep(0.0, 0.2, 1.0 - ys + uBands);
    float la = prof * uLinesA * bandMask * (1.0 - smoothstep(0.9, 1.0, lr));
    addLight(acc, LINEC * la * 0.025);
  }

  float a = clamp(acc.a, 0.0, 1.0);
  vec3 c = acc.rgb / max(a, 1e-4);
  c = pow(clamp(shoulder(c), 0.0, 1.0), vec3(1.0 / 2.2));
  a *= uOpacity;
  gl_FragColor = vec4(c * a, a);
}`

const UNIFORMS = [
  'uTime', 'uView', 'uPx', 'uOpacity', 'uEnemy', 'uDissolve', 'uWipeR', 'uWipeA', 'uWipeDir', 'uLinesA', 'uBands',
  'uInd', 'uIndA', 'uShockR', 'uShockA', 'uDecalR', 'uDecalA', 'uWarnGlow', 'uGlowR', 'uGlowA',
] as const

const painter = createSmokePainter({
  name: 'Waveform',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uAtlas', 'uFlow', 'uRamps'],
  textures: [{ url: atlasUrl }, { url: flowUrl }, { url: rampsUrl, clampX: true, clampY: true }],
})

/** Whether the smoke can be drawn yet; asking starts the textures loading. */
export const waveformStatus = (): SmokeStatus => painter.status()
export const subscribeWaveform = (listener: () => void): (() => void) => painter.subscribe(listener)

/**
 * Paints the smoke in `state` onto `target`, a square 2D canvas, filling it with
 * `WAVEFORM_EXTENT` shell radii either side of the centre. False when it could
 * not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintWaveform(target: HTMLCanvasElement, state: WaveformState, enemy: boolean, opacity: number): boolean {
  if (!(state.scale > 0)) {
    const ctx = target.getContext('2d')
    if (!ctx || painter.status() !== 'ready') return false
    ctx.clearRect(0, 0, target.width, target.height)
    return true
  }
  return painter.paint(target, {
    uTime: state.materialTime,
    uView: WAVEFORM_EXTENT,
    uPx: (2 * WAVEFORM_EXTENT) / Math.max(1, target.width),
    uOpacity: opacity,
    uEnemy: enemy ? 1 : 0,
    uDissolve: state.dissolve,
    uWipeR: state.wipeR,
    uWipeA: state.wipeA,
    uWipeDir: state.wipeDir,
    uLinesA: state.linesA,
    uBands: state.bands,
    uInd: state.ind,
    uIndA: state.indA,
    uShockR: state.shockR,
    uShockA: state.shockA,
    uDecalR: state.decalR,
    uDecalA: state.decalA,
    uWarnGlow: state.warnGlow,
    uGlowR: state.glowR,
    uGlowA: state.glowA,
  })
}
