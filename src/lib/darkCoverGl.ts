/**
 * Draws Omen's Dark Cover from straight above: the game's dark dome
 * (`Wraith_4_DomeTwist_ALLY_VFX`) with the game's textures (`src/assets/darkcover`):
 *
 * - `cell.png`: R, G of Wraith_4Xtile_wblur (the dome's cells), B Wraith_4Xtile90 (the ground stain)
 * - `scroll.png`: Wraith_Scroll_masks (outer wisps) with Wraith_Scroll2_Grayscale in A (overlay wisps)
 * - `flowdissolve.png`: FlowMap_1_TEX in RG, wraith_dissolve_height90 in B
 *   (not `aux.png`: AUX is a reserved file name on Windows)
 * - `radial.png`: the radial_anim flipbook (the dark rings)
 * - `strip.png`: 16 rows of 256: the dome V-masks (Wraith_Dome_Masks, _Masks_outter, _Outter_Masks, rows 0–8),
 *   then colour ramps made only of file colours (rows 9–15): OverlayColorFringe 201A30 → OverlayColorMain 49457C →
 *   the wisp tint 0.195, 0.214, 0.3 × 5; the overlay's 2 × main; the decal and DarkRing colours.
 *
 * There is no colour ramp texture for this smoke and the dome materials carry no
 * parameters (the node graph is not cooked): how the layers mix and scroll is
 * rebuilt by eye, the same as the prototype page (VAL-Master-Plays/prototypes/dark-cover).
 * The board draws the projectile, so the prototype's orb is left out here.
 */

import cellUrl from '../assets/darkcover/cell.png'
import auxUrl from '../assets/darkcover/flowdissolve.png'
import radialUrl from '../assets/darkcover/radial.png'
import scrollUrl from '../assets/darkcover/scroll.png'
import stripUrl from '../assets/darkcover/strip.png'
import { DARK_COVER, type DarkCoverState } from './darkCover.ts'
import { createSmokePainter } from './smokeGl.ts'

/** The picture's half-width in shell radii: room for the projectile's DarkRing at its widest (625 cm). */
export const DARK_COVER_EXTENT = 1.53

const f1 = (x: number) => x.toFixed(1)

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uStrip, uCell, uScroll, uAux, uRadial;
uniform float uT, uView, uPx, uOpacity;
uniform vec4 uBody;    // scale, fill (Mask_Life), dissolve (outro opacity mask), emissive
uniform float uBodyA;  // DissolveDownUP alpha as it forms
uniform vec4 uWisp;    // scale, alpha, glow
uniform vec4 uOver;    // scale, alpha
uniform vec2 uDecal;   // alpha, tint
uniform vec4 uRing1, uRing2;  // frame, alpha, half width (cm)

const float PI = 3.14159265;
float strip(float row, float x){ return texture2D(uStrip, vec2(clamp(x, 0.002, 0.998), (row + 0.5) / 16.0)).r; }
vec3 stripC(float row, float x){ return texture2D(uStrip, vec2(clamp(x, 0.002, 0.998), (row + 0.5) / 16.0)).rgb; }

// Alpha-over a layer onto the running colour (premultiplied accumulation).
void over(inout vec4 acc, vec3 c, float a){ a = clamp(a, 0.0, 1.0); acc.rgb = acc.rgb * (1.0 - a) + c * a; acc.a = acc.a * (1.0 - a) + a; }

// The overlay mesh's V at a top-down radius (mesh units): its outer silhouette, from Wraith_Dome_Overlay.
float overlayV(float x){
  if (x < 33.4) return mix(0.186, 0.26, (x - 29.0) / 4.4);
  if (x < 37.4) return mix(0.26, 0.283, (x - 33.4) / 4.0);
  if (x < 41.3) return mix(0.283, 0.309, (x - 37.4) / 3.9);
  if (x < 46.4) return mix(0.309, 0.332, (x - 41.3) / 5.1);
  if (x < 51.1) return mix(0.332, 0.36, (x - 46.4) / 4.7);
  if (x < 54.6) return mix(0.36, 0.389, (x - 51.1) / 3.5);
  if (x < 56.7) return mix(0.389, 0.426, (x - 54.6) / 2.1);
  return mix(0.426, 0.473, (x - 56.7) / 0.7);
}

// A 3 x 3 flipbook frame of radial_anim, a sprite of half width R.z at the centre.
float ringTex(vec2 p, vec4 R){
  if (R.y <= 0.0) return 0.0;
  vec2 q = p / R.z * 0.5 + 0.5;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
  float f = floor(min(R.x, 8.0));
  vec2 cellO = vec2(mod(f, 3.0), floor(f / 3.0));
  return texture2D(uRadial, (q + cellO) / 3.0).r * R.y;
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView * vec2(1.0, -1.0);   // world cm, y down like the board
  float r = length(p);
  float u = fract(atan(p.y, p.x) / (2.0 * PI) + 1.0);
  float t = uT;
  vec4 acc = vec4(0.0);

  // Ground stain (Wraith_4_DecalGround_MI_New: Wraith_4Xtile90, floor V speed -0.2, U scale 3).
  if (uDecal.x > 0.0 && r < ${f1(DARK_COVER.decalCm)}) {
    float x = r / ${f1(DARK_COVER.decalCm)};
    float tile = texture2D(uCell, vec2(u * 3.0, x - t * 0.2)).b;
    // PinchMask (radius 0.1) hides the pinched centre of the polar mapping.
    float a = (1.0 - smoothstep(0.62, 1.0, x)) * smoothstep(0.08, 0.2, x) * (0.3 + 0.7 * tile * tile) * uDecal.x;
    over(acc, stripC(15.0, 0.2 + 0.8 * tile) * max(1.0, uDecal.y), a * 0.6);
  }

  // The dark orb (Dome_Inner on Wraith_Dome).
  float R = ${f1(DARK_COVER.shellCm)} * uBody.x;
  if (uBody.x > 0.0 && r < R) {
    float rn = r / R;
    float z = sqrt(1.0 - rn * rn);
    float v = acos(z) / PI;                                  // 0 at the top, 0.5 at the rim
    float core = smoothstep(0.3, 0.62, rn);
    // Cells twist round the dome and drift down it ("DomeTwist"); planar at the pole.
    vec2 cuv = vec2(u * 2.0 + v * 0.9 + t * 0.012, v * 2.0 + t * 0.025);
    vec2 puv = p / ${f1(DARK_COVER.shellCm)} * 0.55 + vec2(0.31, 0.17) + t * vec2(0.006, 0.012);
    vec2 cell = mix(texture2D(uCell, puv).rg, texture2D(uCell, cuv).rg, core);
    float dis = mix(texture2D(uAux, puv * 0.7).b, texture2D(uAux, vec2(u * 2.0 + v, v)).b, core);
    float edge = smoothstep(0.62, 0.98, cell.r);
    float shade = 0.08 + 0.6 * cell.g;
    vec3 col = stripC(9.0, shade * 0.45);
    // Emissive cell walls, stronger toward the rim (Wraith_Dome_Masks G along V); EmissiveLERP fades them in.
    col = mix(col, stripC(9.0, 0.6), edge * (0.3 + 0.4 * strip(1.0, v)) * uBody.w);
    col *= mix(1.0, 0.75, pow(rn, 5.0));
    // DissolveDownUP: Mask_Life 0.5 -> 1 fills from the rim up to the top; alpha ramps the mask in.
    float h = 0.5 + 0.5 * z;                                 // 0.5 at the rim, 1 at the top
    float fill = smoothstep(-0.02, 0.02, mix(0.5, 1.12, (uBody.y - 0.5) * 2.0) - h + 0.08 * (dis - 0.5));
    float inA = smoothstep(-0.05, 0.05, uBodyA - (dis * 0.8 + 0.1));
    // Outro: the opacity mask runs 1 -> -5; the cells go last.
    float n2 = dis * 0.6 + (1.0 - cell.g) * 0.4;
    float outA = smoothstep(-0.03, 0.03, uBody.z - n2);
    float a = fill * inA * outA;
    float rim = 1.0 - smoothstep(1.0 - 2.0 * uPx / R, 1.0, rn);
    // The burning edge as it dissolves, in the main overlay colour.
    float band = (1.0 - smoothstep(0.0, 0.07, uBody.z - n2)) * step(uBody.z, 0.999) * outA;
    col = mix(col, stripC(9.0, 0.66), band * 0.8);
    over(acc, col, a * rim);
  }

  // Outer wisps (Dome_outter: Wraith_Scroll_masks, FlowMap_1_TEX, Wraith_Dome_Masks_outter).
  float Rw = ${f1(DARK_COVER.wispCm)} * uWisp.x;
  if (uWisp.y > 0.0 && r < Rw) {
    float rn = r / Rw;
    float z = sqrt(1.0 - rn * rn);
    float v = acos(z) / PI;
    float core = smoothstep(0.3, 0.62, rn);
    vec2 fl = (mix(texture2D(uAux, p / 900.0 + t * vec2(0.01, -0.03)).rg, texture2D(uAux, vec2(u * 2.0, v * 2.0) + t * vec2(0.01, -0.03)).rg, core) - 0.5) * 0.12;
    vec2 suv = vec2(u + v * 0.7 + t * 0.008, v * 1.6 - t * 0.045) + fl;
    vec2 spuv = p / ${f1(DARK_COVER.wispCm)} * 0.45 + t * vec2(0.01, -0.02) + fl;
    vec3 sm = mix(texture2D(uScroll, spuv).rgb, texture2D(uScroll, suv).rgb, core);
    float m = strip(3.0, v) * 0.55 + strip(4.0, v) * 0.75;
    float w = sm.r * 0.75 + sm.g * 0.25;
    float a = w * m * uWisp.y * 0.3;
    vec3 tint = stripC(10.0, 0.15 + 0.55 * sm.b);
    vec3 c = min(vec3(1.0), tint * uWisp.z);
    float rim = 1.0 - smoothstep(1.0 - 2.0 * uPx / Rw, 1.0, rn);
    over(acc, c, a * rim);
  }

  // Overlay wisps (Dome_Overlay on Wraith_Dome_Overlay: Wraith_Scroll2_Grayscale, Wraith_Dome_Outter_Masks).
  float Ro = ${f1(DARK_COVER.overlayCm)} * uOver.x;
  if (uOver.y > 0.0 && r < Ro) {
    float x = r / uOver.x / 8.2;                              // mesh units (× 10 × 0.82)
    float v = overlayV(max(x, 29.0));
    vec2 fl = (texture2D(uAux, vec2(u * 3.0, v * 3.0) - t * vec2(0.02, 0.04)).rg - 0.5) * 0.15;
    vec2 ouv = vec2(u * 2.0 - v * 0.6 - t * 0.01, v * 2.0 - t * 0.06) + fl;
    float sc = texture2D(uScroll, ouv).a;
    float m = strip(6.0, v) * 0.45 + strip(7.0, v) * 0.9;
    float open = smoothstep(200.0, 300.0, r / uOver.x);       // the crown is open on top
    float a = smoothstep(0.08, 0.6, sc) * m * open * uOver.y * 0.5;
    float rim = 1.0 - smoothstep(Ro - 30.0, Ro, r);
    over(acc, stripC(11.0, 0.35 + 0.55 * sc), a * rim);
  }

  // Dark rings: the Zone's radial_anim (1025 cm) and the projectile's DarkRing (500 -> 1250 cm).
  float ring = ringTex(p, uRing1) * 0.9 + ringTex(p, uRing2) * 0.8;
  if (ring > 0.0) over(acc, mix(stripC(15.0, 0.0), stripC(15.0, 1.0) * 1.1, 0.5), ring);

  gl_FragColor = vec4(acc.rgb, acc.a) * uOpacity;
}`

const painter = createSmokePainter({
  name: 'Dark Cover',
  frag: FRAG,
  uniforms: ['uT', 'uView', 'uPx', 'uOpacity', 'uBody', 'uBodyA', 'uWisp', 'uOver', 'uDecal', 'uRing1', 'uRing2'] as const,
  samplers: ['uStrip', 'uCell', 'uScroll', 'uAux', 'uRadial'],
  textures: [{ url: stripUrl, clampX: true, clampY: true }, { url: cellUrl }, { url: scrollUrl }, { url: auxUrl }, { url: radialUrl, clampX: true, clampY: true }],
})

/** Whether the smoke can be drawn yet; asking starts the textures loading. */
export const darkCoverStatus = painter.status
export const subscribeDarkCover = painter.subscribe

/**
 * Paints the smoke in `state` onto `target`, a square 2D canvas, filling it with
 * `DARK_COVER_EXTENT` shell radii either side of the centre. False when it could
 * not (no WebGL, textures not in yet): the caller keeps its fallback. The files'
 * enemy treatment (the `_FOE` outro) is already in the state: the dome has no
 * team colour, so there is no enemy uniform.
 */
export function paintDarkCover(target: HTMLCanvasElement, state: DarkCoverState, opacity: number): boolean {
  const view = DARK_COVER.shellCm * DARK_COVER_EXTENT
  const { zone, orb } = state.rings
  return painter.paint(target, {
    uT: state.materialTime,
    uView: view,
    uPx: (2 * view) / Math.max(1, target.width),
    uOpacity: state.phase === 'gone' ? 0 : opacity,
    uBody: [state.scale, state.fill, state.dissolve, state.emissive],
    uBodyA: state.alpha,
    uWisp: [state.wisp.scale, state.wisp.alpha, state.wisp.glow, 0],
    uOver: [state.overlay.scale, state.overlay.alpha, 0, 0],
    uDecal: [state.decal.alpha, state.decal.tint],
    uRing1: [zone.frame, zone.alpha, Math.max(1, zone.halfCm), 0],
    uRing2: [orb.frame, orb.alpha, Math.max(1, orb.halfCm), 0],
  })
}
