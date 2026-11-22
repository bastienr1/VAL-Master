/**
 * Draws Phoenix's Hot Hands from straight above: the fire on the ground (the
 * game's decal) and the flames standing on it, with the game's textures
 * (`src/assets/hothands`: `fire` packs Phoenix_FlamePan, Phoenix_E_Flame_Dissolve
 * and Z_FireShapeTile_TFX in R, G, B; `flow` is FlowMap_2_TEX2 with
 * Phoenix_FirePan_TFX in B; `flame` is Phoenix_Molotov_Flame and its highlight),
 * the HDR colours of the material instances (Phoenix_E_Molotov_Decal_Inst and
 * Phoenix_molotov_flame_Inst, their _FOE_ twins for an enemy's fire), and the
 * materials' scroll speeds. The polar mapping, the tone curve and the flames
 * laid flat are rebuilt by eye: the cooked materials give the textures and
 * numbers, not the node graph.
 *
 * Same shader as the prototype page (VAL-Master-Plays/prototypes/hot-hands).
 * The page draws each flame as its own quad in a second program; the shared
 * painter (`smokeGl.ts`) has one program and one quad, so here the flames are
 * a loop in the same fragment shader, laid over the ground fire in the same
 * order and with the same blend, and the colours are constants instead of
 * uniforms. One WebGL context for every Hot Hands on the board.
 */

import fireUrl from '../assets/hothands/fire.png'
import flameUrl from '../assets/hothands/flame.png'
import flowUrl from '../assets/hothands/flow.png'
import { HOT_HANDS, HOT_HANDS_SITES, type HotHandsState } from './hotHands.ts'
import { createSmokePainter } from './smokeGl.ts'

/** The picture's half-width in hurt radii: the fire's ragged edge reaches 1.04, the decal box 1.111. */
export const HOT_HANDS_EXTENT = 1.1

/** At most two flames burn at one site at a time. */
const SLOTS = HOT_HANDS_SITES * 2

/** The material instances' HDR colours: the ground fire's DecalColorA/B/C and DecalRing, the flames' ColorA and ColorB. */
const PAL = {
  ally: { decalA: [0.4, 0.06, 0.1], decalB: [1.3, 0.325, 0.195], decalC: [4.0, 0.9485, 0.4], ring: [1500, 75, 17.5], flameA: [0.65, 0.0406, 0.07], flameB: [220, 8.8, 3.0801], birthB: [150, 6.0, 2.1001] },
  enemy: { decalA: [0.275, 0.0275, 0.0454], decalB: [1.0, 0.149, 0.1686], decalC: [4.0, 0.7, 0.4], ring: [1500, 30, 10], flameA: [0.65, 0.0406, 0.07], flameB: [220, 5.1764, 3.0801], birthB: [150, 3.5, 2.1001] },
} as const
const DECAL_EXPOSURE = 0.9
const RING_SCALE = 0.02

const vec3 = (c: readonly number[]) => `vec3(${c.map(x => x.toFixed(4)).join(', ')})`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFire, uFlow, uFlame;
uniform float uTime, uFront, uR, uView, uAlpha, uHeat, uEnemy, uOpacity, uFlash, uCount;
uniform vec4 uFa[${SLOTS}];   // a flame: its foot x, y (cm), length (cm; negative for a birth flame), angle
uniform vec4 uFb[${SLOTS}];   // its seed, alpha, outro, intro

const vec3 uA = ${vec3(PAL.ally.decalA)}, uA2 = ${vec3(PAL.enemy.decalA)};
const vec3 uB = ${vec3(PAL.ally.decalB)}, uB2 = ${vec3(PAL.enemy.decalB)};
const vec3 uC = ${vec3(PAL.ally.decalC)}, uC2 = ${vec3(PAL.enemy.decalC)};
const vec3 uRing = ${vec3(PAL.ally.ring)}, uRing2 = ${vec3(PAL.enemy.ring)};
const vec3 uFA = ${vec3(PAL.ally.flameA)};
const vec3 uFB = ${vec3(PAL.ally.flameB)}, uFB2 = ${vec3(PAL.enemy.flameB)};
const vec3 uBB = ${vec3(PAL.ally.birthB)}, uBB2 = ${vec3(PAL.enemy.birthB)};

vec3 tm(vec3 c){ return 1.0 - exp(-c); }

// One flame, laid flat from its foot outward, at w (cm, +y down the map). Premultiplied.
vec4 flame(vec2 w, vec4 fa, vec4 fb){
  float len = abs(fa.z);
  vec2 d = w - fa.xy;
  if (dot(d, d) > len * len) return vec4(0.0);
  float birth = fa.z < 0.0 ? 1.0 : 0.0;
  float wid = len * mix(0.5, 0.62, birth);
  // Back into the flame's own quad (corners at ±1): along it from 0.15 behind the foot to 0.85 ahead.
  float c = cos(fa.w), s = sin(fa.w);
  vec2 q = vec2((c * d.y - s * d.x) / wid * 2.0, ((c * d.x + s * d.y) / len - 0.35) * 2.0);
  if (abs(q.x) > 1.0 || abs(q.y) > 1.0) return vec4(0.0);
  vec2 fv = vec2(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);       // v 0 at the tip, 1 at the foot
  float t = uTime;
  // TextureC: the fire pan scrolling 1.5 /s wobbles U by 0.15; TextureE scrolls 1.3 /s and cuts the shape.
  float wob = texture2D(uFlow, vec2(fv.x * 1.0 + fb.x, fv.y * 2.0 - t * 1.5)).b - 0.5;
  vec2 fuv = vec2(fv.x + wob * 0.15 * (1.0 - fv.y) * 2.0, fv.y * 0.9 + 0.08);
  float shape = texture2D(uFlame, fuv).r;
  float hi = texture2D(uFlame, fuv + vec2(0.0, 0.04)).g;
  float cut = texture2D(uFlow, vec2(fv.x * 2.3 + fb.x * 1.7, fv.y - t * 1.3)).b;
  float e = shape * (0.55 + 0.45 * cut);
  // Erosion: the outro threshold climbs as the flame ages, the intro opens it at birth.
  float th = (1.0 - fb.z) * 0.8 + fb.w * 0.6;
  float vis = smoothstep(th, th + 0.3, e);
  vec3 fb2 = mix(mix(uFB, uFB2, uEnemy), mix(uBB, uBB2, uEnemy), birth);
  vec3 hdr = mix(uFA * 2.0, fb2 * 0.17 * (0.45 + 0.55 * hi), smoothstep(0.12, 0.9, e));
  vec3 col = tm(hdr);
  float a = vis * fb.y * smoothstep(0.0, 0.3, e) * uOpacity;
  // Flames glow over the ground fire rather than cover it.
  return vec4(col * a, a * 0.7);
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;           // centimetres
  float r = length(p);
  float t = uTime;
  vec4 outc = vec4(0.0);

  if (uAlpha > 0.0 && uFront > 0.0) {
    // The decal box is 1.111 × the radius (DecalRadiusMultiplier); its UV runs 0…1 across it.
    float box = uR * ${HOT_HANDS.decalBox.toFixed(3)};
    vec2 uv = p / (2.0 * box) + 0.5;
    float rn = r / (2.0 * box);                   // 0 at the centre, 0.45 at the fire's edge
    float ang = atan(p.y, p.x) / 6.2831853 + 0.5;

    // Flow map (tile 4 × 2) bends the fire; it scrolls (−0.2, 0.4) /s.
    vec2 flow = texture2D(uFlow, uv * vec2(4.0, 2.0) + t * vec2(-0.2, 0.4) * 0.25).rg - 0.5;
    // Fire pan: around the patch 3 times, 0.4 of the texture from centre to edge, drifting outward 0.25 /s.
    vec2 bUv = vec2(ang * 3.0, rn * 0.4 * 2.2 + t * 0.25) + flow * vec2(0.2, 0.1);
    float pan = texture2D(uFire, vec2(bUv.x, -bUv.y)).r;
    // Fire shape (tile 6 × 0.5, −0.2 /s), mixed in at 0.53.
    float shape = texture2D(uFire, vec2(ang * 6.0, -(rn * 0.5 * 2.2 + t * 0.2)) + flow * 0.08).b;
    float dis = texture2D(uFire, uv * 2.0 + flow * 0.05).g;
    // Near the centre the wrap pinches every flame into a point, so there the same
    // textures are read flat instead.
    float core = smoothstep(0.03, 0.2, rn);
    float panFlat = texture2D(uFire, uv * 1.6 + flow * vec2(0.2, 0.1) + t * vec2(0.03, -0.06)).r;
    float shapeFlat = texture2D(uFire, uv * vec2(3.0, 1.5) + flow * 0.08 + t * vec2(0.0, -0.1)).b;
    pan = mix(panFlat, pan, core);
    shape = mix(shapeFlat, shape, core);
    float i = clamp(pan * mix(1.0, shape, 0.53) * 1.35 + (shape - 0.75) * 0.25, 0.0, 1.0);
    i = 0.22 + 0.78 * i;

    vec3 A = mix(uA, uA2, uEnemy), B = mix(uB, uB2, uEnemy), C = mix(uC, uC2, uEnemy), RING = mix(uRing, uRing2, uEnemy);
    vec3 hdr = mix(A, B, smoothstep(0.0, 0.45, i));
    hdr = mix(hdr, C, smoothstep(0.45, 1.0, i));
    // Born hot: the decal's heat parameter falls from 6.1 to 1 over its life.
    hdr *= 1.0 + (uHeat - 1.0) * 0.12;

    // The edge: soft, a little ragged (dissolve texture), at the patch's radius; while it
    // spreads, at the spread front. A hot rim (DecalRing) just inside it.
    float edgeR = min(uFront, uR);
    float rr = r + (dis - 0.5) * 26.0;
    float inside = 1.0 - smoothstep(edgeR - 16.0, edgeR + 6.0, rr);
    float rim = smoothstep(edgeR - 70.0, edgeR - 6.0, rr) * inside;
    hdr += RING * ${RING_SCALE.toFixed(3)} * rim * (0.35 + 0.65 * pan);
    // The front itself glows brighter while it is still moving out.
    float moving = 1.0 - smoothstep(uR - 1.0, uR, uFront);
    hdr += RING * ${RING_SCALE.toFixed(3)} * 0.6 * moving * smoothstep(edgeR - 40.0, edgeR, rr) * inside;

    vec3 col = tm(hdr * ${DECAL_EXPOSURE.toFixed(3)});
    float a = (0.62 + 0.38 * i) * inside * uAlpha;
    // As it dims it breaks up through the dissolve texture.
    a *= smoothstep(0.0, 0.25, dis + uAlpha - 0.65);
    outc = vec4(col * a, a);
  }

  // Landing flash: the explosion sprite, 350 cm, × 0.2 → 1.2 over 0.4 s, fading out.
  if (uFlash >= 0.0) {
    float fr = ${(HOT_HANDS.flashCm / 2).toFixed(1)} * mix(0.2, 1.2, uFlash);
    float g = 1.0 - smoothstep(0.0, fr, r);
    g = g * g * (1.0 - uFlash * uFlash);
    vec3 fc = tm(vec3(7.0, 0.6, 0.35) * 11.0 * 0.12 * (0.3 + g) * (1.6 - uFlash));
    outc.rgb = outc.rgb * (1.0 - g) + fc * g;
    outc.a = max(outc.a, g);
  }
  outc *= uOpacity;

  // The flames, oldest first, each laid over what is under it (the page draws them as quads).
  vec2 w = vec2(p.x, -p.y);
  for (int n = 0; n < ${SLOTS}; n++) {
    if (float(n) >= uCount) break;
    vec4 f = flame(w, uFa[n], uFb[n]);
    outc = f + outc * (1.0 - f.a);
  }
  gl_FragColor = outc;
}`

const FA = Array.from({ length: SLOTS }, (_, i) => `uFa[${i}]`)
const FB = Array.from({ length: SLOTS }, (_, i) => `uFb[${i}]`)
const UNIFORMS: readonly string[] = ['uTime', 'uFront', 'uR', 'uView', 'uAlpha', 'uHeat', 'uEnemy', 'uOpacity', 'uFlash', 'uCount', ...FA, ...FB]

const painter = createSmokePainter({
  name: 'Hot Hands',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uFire', 'uFlow', 'uFlame'],
  // The flame is read once, edge to edge; the other two tile.
  textures: [{ url: fireUrl }, { url: flowUrl }, { url: flameUrl, clampX: true, clampY: true }],
})

/** Whether the fire can be drawn yet; asking starts the textures loading. */
export const hotHandsStatus = painter.status
export const subscribeHotHands = painter.subscribe

/**
 * Paints the fire in `state` onto `target`, a square 2D canvas, filling it
 * with `HOT_HANDS_EXTENT` hurt radii either side of the centre. False when it
 * could not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintHotHands(target: HTMLCanvasElement, state: HotHandsState, enemy: boolean, opacity: number): boolean {
  const count = Math.min(SLOTS, state.flames.length)
  const values: Record<string, number | readonly number[]> = {
    uTime: state.materialTime,
    uFront: state.frontCm,
    uR: HOT_HANDS.radiusCm,
    uView: HOT_HANDS_EXTENT * HOT_HANDS.radiusCm,
    uAlpha: state.decal,
    uHeat: state.heat,
    uEnemy: enemy ? 1 : 0,
    uOpacity: opacity,
    uFlash: state.flash,
    uCount: count,
  }
  for (let i = 0; i < count; i++) {
    const f = state.flames[i]
    values[FA[i]] = [f.x, f.y, f.birth ? -f.len : f.len, f.ang]
    values[FB[i]] = [f.seed, f.alpha, f.outro, f.intro]
  }
  return painter.paint(target, values)
}
