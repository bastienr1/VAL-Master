/**
 * Draws Brimstone's Sky Smoke from straight above, on the shared smoke painter
 * (`smokeGl.ts`). Ported from the prototype page (`VAL-Master-Plays/prototypes/sky-smoke`)
 * with the same uniforms and textures; the falling canister and its trail are
 * left out. Textures (`src/assets/sky`), packed from the game files:
 * - smoke.png  r `smokebomb_T_blurLess` (the body), g its `_mask` (team colour), b `Sarge_E_Smokebomb_Glide_45_blur` (birth shell), a `Sarge_Smokebomb_Glide_blur` (ground stain)
 * - pack.png   rg `FlowMap_2_TEX1`, b `T_Sarge_SmokeBomb_Transparent_Pack` (veil), a `T_Sarge_SmokeBomb_Pack` (outro erosion)
 * - sheet.png  r `SmokePoof_4x4_RadialBlur` (impact puffs), b `Wraith_4Xtile90_blur_Grayscale` (birth shell dissolve)
 * - lut.png    ramps built from the materials' colour parameters (body, birth shell, veil, …); Brimstone has no LUT
 * The game gives textures, colours, sizes and timings; how the layers mix is rebuilt by eye.
 */

import lutUrl from '../assets/sky/lut.png'
import packUrl from '../assets/sky/pack.png'
import sheetUrl from '../assets/sky/sheet.png'
import smokeUrl from '../assets/sky/smoke.png'
import { SKY_PUFFS, SKY_SMOKE, type SkySmokeState } from './skySmoke.ts'
import { createSmokePainter } from './smokeGl.ts'

/** The picture's half-width in shell radii: the veil, the ground stain and most of the shockwave. */
export const SKY_SMOKE_EXTENT = 1.6

const PUFF_SLOTS = Array.from({ length: SKY_PUFFS }, (_, i) => i)
const HEAT_SLOTS = Array.from({ length: Math.ceil(SKY_PUFFS / 4) }, (_, i) => i)

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSmoke, uPack, uSheet, uLut;
uniform float uTime, uView, uPx, uEnemy, uOpacity;
uniform float uMarkerA, uGrowR, uGrowA, uFlash;
uniform float uShockR, uShockA, uShockHeat, uShockAge;
uniform float uBirthR, uBirthA, uBirthHeat, uBirthEro;
uniform float uBodyR, uBodyA, uBodyHeat, uBodyDis, uBodyDark;
uniform float uVeilA, uVeilEro, uDecalR, uDecalA;
${PUFF_SLOTS.map(i => `uniform vec4 uPuff${i};`).join('\n')}
${HEAT_SLOTS.map(i => `uniform vec4 uHeat${i};`).join('\n')}

const float PI = 3.14159265;
vec3 lut(float row, float x){ return texture2D(uLut, vec2(clamp(x, 0.002, 0.998), (row + 0.5) / 8.0)).rgb; }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 tone(vec3 c){ return c * (1.0 + c / 6.0) / (1.0 + c); }
// The game's sphere UV seen from the top: u around, v from the pole (0) to the equator (0.5).
vec2 sphereUv(vec2 p, float r){ return vec2(atan(p.y, p.x) / 6.2831853 + 0.5, asin(clamp(r, 0.0, 1.0)) / PI); }
// One impact puff (size cm, alpha, frame, rotation) from the 4 x 4 sheet, at the centre.
float puffAt(vec2 p, vec4 q){
  if (q.y <= 0.0) return 0.0;
  float cs = cos(q.w), sn = sin(q.w);
  vec2 lp = mat2(cs, -sn, sn, cs) * p / (q.x * 0.5);
  if (abs(lp.x) > 1.0 || abs(lp.y) > 1.0) return 0.0;
  float f = floor(clamp(q.z, 0.0, 15.0));
  vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
  return texture2D(uSheet, (cell + (lp * vec2(0.5, -0.5) + 0.5)) / 4.0).r * q.y;
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;                    // world cm, y up
  float d = length(p);
  float t = uTime;
  vec3 col = vec3(0.0); float a = 0.0;                    // what covers the ground: premultiplied, linear light
  vec3 add = vec3(0.0);                                   // additive light (marker, rings, shockwave, flash)
  vec3 teamMark = mix(vec3(0.1, 1.0, 1.0), vec3(1.0, 0.12, 0.12), uEnemy);

  // Ground: the dark stain, the landing marker, the grow ring, the shockwave.
  if (uDecalA > 0.0 && d < uDecalR) {
    float m = texture2D(uSmoke, p / 870.0 * vec2(4.0, 2.0) + t * vec2(-0.3, -0.5) * 0.1).a;
    float ring = smoothstep(0.62, 0.86, d / uDecalR) * (1.0 - smoothstep(0.9, 1.0, d / uDecalR));
    float da = ring * (0.35 + 0.65 * m) * 0.5 * uDecalA;
    col = mix(col, vec3(0.0612, 0.0423, 0.0331) * 0.6, da); a = max(a, da);
  }
  if (uMarkerA > 0.0) {
    float rg = sqrt(${SKY_SMOKE.markerCm.toFixed(1)} * ${SKY_SMOKE.markerCm.toFixed(1)} - 65.0 * 65.0);   // the sphere sits 65 cm up
    float line = exp(-pow((d - rg) / 7.0, 2.0));
    float band = smoothstep(rg - 150.0, rg, d) * step(d, rg) * 0.1;
    float fill = step(d, rg) * 0.03;
    add += teamMark * (line * 0.9 + band + fill) * uMarkerA * (1.0 - a);
  }
  if (uGrowA > 0.0 && uGrowR > 65.0) {
    float rg = sqrt(uGrowR * uGrowR - 65.0 * 65.0);
    add += mix(vec3(0.1, 1.4, 1.0), vec3(1.0, 0.12, 0.12), uEnemy) * exp(-pow((d - rg) / 6.0, 2.0)) * uGrowA * 0.6;
  }
  if (uShockA > 0.0 && d < uShockR) {
    float in0 = 0.087 * uShockR;
    float v = clamp((d - in0) / (uShockR - in0), 0.0, 1.0);
    float prof = sin(PI * v) * step(in0, d);
    float n = texture2D(uSmoke, vec2(atan(p.y, p.x) / 6.2831853 * 9.0, v * 0.5 + t * 0.3)).b;
    float dis = smoothstep(0.0, 0.25, n - (1.0 - mix(0.7, -1.0, uShockAge)) * 0.6);
    add += vec3(1.0, 0.711, 0.422) * prof * dis * uShockA * uShockHeat * 0.08;
  }

  // The shells: birth shell (bright, eroding) and the body (opaque), whichever is higher.
  float rb = d / max(uBodyR, 1.0), rs = d / max(uBirthR, 1.0);
  float hb = uBodyR > 0.0 && rb < 1.0 ? uBodyR * sqrt(1.0 - rb * rb) : -1.0;
  float hs = uBirthR > 0.0 && rs < 1.0 ? uBirthR * sqrt(1.0 - rs * rs) : -1.0;

  // Birth shell: SmokeBomb_Trans_MAT_Inst, Glide_45 streaks, dissolved by the Wraith noise, fresnel alpha.
  vec4 shell = vec4(0.0);
  if (hs > 0.0 && uBirthA > 0.0) {
    vec2 su = sphereUv(p, rs);
    float z = sqrt(1.0 - rs * rs);
    float e = texture2D(uSmoke, vec2(su.x * 2.0 + su.y * 0.268, su.y * 1.8) + t * vec2(-0.7, 0.7)).b;
    e = mix(texture2D(uSmoke, p / uBirthR * 0.9 + t * vec2(-0.25, 0.25)).b, e, smoothstep(0.05, 0.35, rs));
    float n = texture2D(uSheet, vec2(su.x * 1.5 + su.y * 3.27, su.y * 1.935) + t * vec2(0.0, 1.5)).b;
    float keep = smoothstep(0.0, 0.05, n - (1.0 - uBirthEro));
    float fres = clamp(pow(1.0 - z, 2.0) * 3.0, 0.0, 1.0);
    float sa = clamp(0.25 + fres, 0.0, 1.0) * keep * uBirthA;
    vec3 sc = toLin(lut(1.0, 0.5 + e * 0.3 + pow(z, 6.0) * 0.15)) * vec3(0.85, 0.75, 0.7) * uBirthHeat * 0.55;
    shell = vec4(sc * sa, sa);
  }

  // Body: SmokeBomb_FOE_Inst. The blurLess texture twisted round the dome, drifting along its streaks.
  vec4 body = vec4(0.0);
  if (hb > 0.0 && uBodyA > 0.0) {
    vec2 su = sphereUv(p, rb);
    float z = sqrt(1.0 - rb * rb);
    float core = smoothstep(0.05, 0.4, rb);
    vec2 flow = (texture2D(uPack, vec2(su.x * 8.0 - t * 2.0 * 0.1, su.y)).rg - 0.5) * vec2(0.01, 0.015) * 2.0;
    vec2 drift = t * 4.0 * vec2(-0.13, 0.13);
    vec2 euv = su * 3.0 + drift + flow;
    vec2 puv = p / uBodyR * 1.35 + drift * 0.45;          // the pole, where the wrap pinches
    vec4 tx = mix(texture2D(uSmoke, puv), texture2D(uSmoke, euv), core);
    float e2 = mix(texture2D(uSmoke, puv + vec2(-0.03, 0.03)).r, texture2D(uSmoke, euv + vec2(-0.02, 0.02)).r, core);
    // blurLess only spans 90..115 of 255: stretched to the full ramp (by eye).
    float e = clamp((tx.r * 255.0 - 88.0) / 30.0, 0.0, 1.0);
    float mask = clamp((tx.g * 255.0 - 28.0) / 91.0, 0.0, 1.0);
    e2 = clamp((e2 * 255.0 - 88.0) / 30.0, 0.0, 1.0);
    float relief = clamp(0.5 + (e - e2) * 1.6, 0.0, 1.0);
    vec3 c = toLin(lut(0.0, 0.12 + e * 0.8));
    c *= mix(0.8, 1.15, relief);
    // Brimstone's own tint: TeamColor through the blurLess mask (x 3.5); ally brown, enemy red at 0.502.
    vec3 team = mix(vec3(0.2, 0.085, 0.04), vec3(1.3, 0.13, 0.143) * 0.502, uEnemy);
    c += team * mask * mask * 3.5 * mix(0.15, 0.6, uEnemy);
    float fres = pow(1.0 - z, 2.2993);
    c = mix(c, toLin(lut(0.0, 0.9)), fres * 0.35);        // a lighter, fluffier rim
    c *= mix(1.0, 0.8, pow(1.0 - z, 6.0));                // the very edge rolls away from the light
    c *= uBodyHeat * uBodyDark;
    // Outro: SmokeBomb_Dissipation_MAT, masked, eaten by the Texture Pack as AlphaDissolve falls 1 to 0.
    float keep = 1.0;
    if (uBodyDis < 1.0) {
      float vt = mix(0.3, 1.5, 1.0 - uBodyDis);
      float n = texture2D(uPack, vec2(su.x + su.y * 0.5, su.y * vt) + t * 2.0 * vec2(-0.3, 0.3)).a;
      n = mix(texture2D(uPack, p / uBodyR * 0.8 + t * vec2(-0.2, 0.2)).a, n, core);
      keep = smoothstep(0.0, 0.2, n * 1.05 - (1.0 - uBodyDis) * 1.1 + 0.02 + (1.0 - rb) * 0.08 * uBodyDis);
    }
    float ba = uBodyA * keep * uOpacity;
    ba *= 1.0 - smoothstep(1.0 - 2.5 * uPx / max(uBodyR, 1.0), 1.0, rb);
    body = vec4(c * ba, ba);
  }
  vec4 lo = hs > hb ? body : shell;
  vec4 hi = hs > hb ? shell : body;
  col = col * (1.0 - lo.a) + lo.rgb; a = a + lo.a * (1.0 - a);
  col = col * (1.0 - hi.a) + hi.rgb; a = a + hi.a * (1.0 - a);
  add *= 1.0 - min(1.0, 2.0 * max(lo.a, hi.a));           // ground light is hidden under the smoke

  // Outer veil: SmokeBomb_b_Trans_AllInOne_MAT, Transparent_Pack wisps, strongest at the silhouette.
  if (uVeilA > 0.0 && d < ${SKY_SMOKE.veilCm.toFixed(1)}) {
    float rv = d / ${SKY_SMOKE.veilCm.toFixed(1)};
    vec2 su = sphereUv(p, rv);
    float core = smoothstep(0.05, 0.4, rv);
    float w = texture2D(uPack, vec2(su.x * 2.0, su.y * 2.0) + t * 4.0 * vec2(0.05, 0.0729)).b;
    w = mix(texture2D(uPack, p / ${SKY_SMOKE.veilCm.toFixed(1)} * 1.2 + t * vec2(0.1, 0.15)).b, w, core);
    float edge = smoothstep(0.86, 0.95, rv) * (1.0 - smoothstep(0.96, 1.0, rv));
    float mid = 0.2714 * (1.0 - smoothstep(0.85, 0.95, rv)) * smoothstep(0.2381, 0.6, rv);
    float keep = smoothstep(-0.05, 0.25, w - uVeilEro);
    float va = clamp((edge * 1.2253 + mid * 0.5) * w * 0.7, 0.0, 1.0) * keep * uVeilA * uOpacity * uBodyDark;
    vec3 vc = toLin(lut(0.0, 0.5 + w * 0.35)) * uBodyDark;
    col = col * (1.0 - va) + vc * va; a = a + va * (1.0 - a);
    add *= 1.0 - va;
  }

  // Above the shells: the impact puffs (SmokeBurst, colour (1, 0.711, 0.422) x heat) and the flash.
${PUFF_SLOTS.map(i => `  { float m = puffAt(p, uPuff${i}); vec3 pc = vec3(1.0, 0.711, 0.422) * uHeat${i >> 2}[${i & 3}] * 0.6; col = col * (1.0 - m) + pc * m; a = a + m * (1.0 - a); add *= 1.0 - m; }`).join('\n')}
  if (uFlash > 0.0) {
    float fr = mix(450.0, 1050.0, 1.0 - uFlash);
    add += vec3(20.0, 10.0, 5.0) * 0.06 * exp(-pow(d / (fr * 0.35), 2.0)) * uFlash;
  }

  add *= 1.0 - smoothstep(uView * 0.82, uView, d);       // no square edge where the canvas ends
  vec3 base = toSrgb(tone(col / max(a, 1e-4))) * a;
  vec3 glow = toSrgb(tone(add));
  float ga = max(glow.r, max(glow.g, glow.b));
  vec3 rgb = base * (1.0 - ga) + glow;
  float alpha = clamp(a + ga * (1.0 - a), 0.0, 1.0);
  gl_FragColor = vec4(min(rgb, vec3(alpha)), alpha);
}`

const UNIFORMS = [
  'uTime', 'uView', 'uPx', 'uEnemy', 'uOpacity', 'uMarkerA', 'uGrowR', 'uGrowA', 'uFlash',
  'uShockR', 'uShockA', 'uShockHeat', 'uShockAge', 'uBirthR', 'uBirthA', 'uBirthHeat', 'uBirthEro',
  'uBodyR', 'uBodyA', 'uBodyHeat', 'uBodyDis', 'uBodyDark', 'uVeilA', 'uVeilEro', 'uDecalR', 'uDecalA',
  ...PUFF_SLOTS.map(i => `uPuff${i}`), ...HEAT_SLOTS.map(i => `uHeat${i}`),
] as const
type Uniform = (typeof UNIFORMS)[number]

const painter = createSmokePainter<Uniform>({
  name: 'Sky Smoke',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uSmoke', 'uPack', 'uSheet', 'uLut'],
  textures: [{ url: smokeUrl }, { url: packUrl }, { url: sheetUrl }, { url: lutUrl, clampX: true, clampY: true }],
})

/** Whether the smoke can be drawn yet; asking starts the textures loading. */
export const skySmokeStatus = painter.status
export const subscribeSkySmoke = painter.subscribe

/**
 * Paints the smoke in `state` onto `target`, a square 2D canvas, filling it
 * with `SKY_SMOKE_EXTENT` shell radii either side of the centre. False when it
 * could not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintSkySmoke(target: HTMLCanvasElement, state: SkySmokeState, enemy: boolean, opacity: number): boolean {
  const view = SKY_SMOKE_EXTENT * SKY_SMOKE.shellCm
  const values: Partial<Record<Uniform, number | readonly number[]>> = {
    uTime: state.materialTime,
    uView: view,
    uPx: (2 * view) / Math.max(1, target.width),
    uEnemy: enemy ? 1 : 0,
    uOpacity: opacity,
    uMarkerA: state.markerA,
    uGrowR: state.growCm,
    uGrowA: state.growA,
    uFlash: state.flash,
    uShockR: state.shockCm,
    uShockA: state.shockA,
    uShockHeat: state.shockHeat,
    uShockAge: state.shockAge,
    uBirthR: state.birthCm,
    uBirthA: state.birthA,
    uBirthHeat: state.birthHeat,
    uBirthEro: state.birthKeep,
    uBodyR: state.scale * SKY_SMOKE.shellCm,
    uBodyA: state.bodyA,
    uBodyHeat: state.bodyHeat,
    uBodyDis: 1 - state.dissolve,
    uBodyDark: state.bodyDark,
    uVeilA: state.veilA,
    uVeilEro: state.veilErosion,
    uDecalR: state.decalCm,
    uDecalA: state.decalA,
  }
  const heat = new Array<number>(HEAT_SLOTS.length * 4).fill(0)
  PUFF_SLOTS.forEach(i => {
    const q = state.puffs[i]
    values[`uPuff${i}` as Uniform] = q ? [q.sizeCm, q.alpha, q.frame, q.rot] : [1, 0, 0, 0]
    if (q) heat[i] = q.heat
  })
  HEAT_SLOTS.forEach(i => {
    values[`uHeat${i}` as Uniform] = heat.slice(i * 4, i * 4 + 4)
  })
  return painter.paint(target, values)
}
