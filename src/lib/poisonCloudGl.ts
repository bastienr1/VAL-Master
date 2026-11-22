/**
 * Draws Viper's Poison Cloud from straight above: the game's camera-facing
 * dome with its own textures (`src/assets/poison`, taken from
 * PandemicTearAway_Dome, PandemicTearAway_TFX_Tiled, PandemicTearAway_Thin_TFX,
 * Smoke_Dissolve_Grayscale, Wraith_4Xtile90_blur_Grayscale and foe_smoke) and
 * colour ramps built from the Pandemic_4_SmokeSphere materials' vector
 * parameters, drifting at the material's own speeds. How the layers mix, the
 * gas puffs and the edge glow are rebuilt by eye: the cooked materials give
 * the textures and numbers, not the node graph. Same shader as the prototype
 * page (VAL-Master-Plays/prototypes/poison-cloud), with the puff array split
 * into six vec4 uniforms.
 */

import lutUrl from '../assets/poison/lut.png'
import pack1Url from '../assets/poison/pack1.png'
import pack2Url from '../assets/poison/pack2.png'
import type { PoisonCloudState } from './poisonCloud.ts'
import { createSmokePainter, type SmokeStatus } from './smokeGl.ts'

/** The picture's half-width in shell radii: the wisp layer (1.039) grown by the outro's tenth, and the rim's wobble. */
export const POISON_CLOUD_EXTENT = 1.16

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPack1, uPack2, uLut;
uniform float uTime, uScale, uDome, uDisIn, uInnerDis, uOutro, uOutroDis, uHalo, uBoost;
uniform float uEnemy, uView, uOpacity, uPx, uGlow, uGlowR;
uniform vec4 uPuff0, uPuff1, uPuff2, uPuff3, uPuff4, uPuff5;

vec3 lut(float row, float x){ return texture2D(uLut, vec2(clamp(x, 0.002, 0.998), (row + 0.5) / 8.0)).rgb; }
const float PI = 3.14159265;

// One GasBurst puff q = (radius in shell radii, opacity, seed, -).
void puff(vec4 q, float L, float ang, inout vec3 col, inout float a){
  if (q.y <= 0.0) return;
  float rr = L / max(q.x, 0.001);
  float n = texture2D(uPack2, vec2(ang * 2.0 + q.z, rr * 0.35 + q.z)).g;
  float m = (1.0 - smoothstep(0.55, 1.0, rr + (n - 0.5) * 0.35)) * q.y;
  vec3 pc = mix(mix(lut(1.0, 0.18), lut(1.0, 0.55), n * (1.0 - rr * 0.6)), mix(lut(5.0, 0.12), lut(5.0, 0.4), n * (1.0 - rr * 0.6)), uEnemy);
  col = mix(col, pc, m);
  a = max(a, m);
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;            // in shell radii (1 = 457.7 cm)
  float L = length(p);
  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;

  // Gas burst puffs: dark acid-green poofs from the canister, under the forming shell.
  puff(uPuff0, L, ang, col, a);
  puff(uPuff1, L, ang, col, a);
  puff(uPuff2, L, ang, col, a);
  puff(uPuff3, L, ang, col, a);
  puff(uPuff4, L, ang, col, a);
  puff(uPuff5, L, ang, col, a);

  if (uDome > 0.5 && uScale > 0.0) {
    float rs = L / uScale;
    // Edge: the shell's vertex offset (foe_smoke, −5 to +8 cm) roughens the rim a little.
    float wob = texture2D(uPack2, vec2(ang * 3.0, 0.5 + t * 0.4)).b;
    float rEdge = 1.0 + mix(-5.0, 8.0, wob) / 457.7;

    if (rs < rEdge) {
      float r = rs / rEdge;
      float z = sqrt(max(0.0, 1.0 - r * r));
      // Camera-facing half sphere: v runs from the rim (0) to the pole (1), u around the pole.
      float v = 1.0 - asin(min(r, 1.0)) / (PI * 0.5);
      float u = ang;
      // The pole faces the camera and pinches the wrap; near it the textures are read flat instead.
      float core = smoothstep(0.12, 0.5, r);
      vec2 fp = p / max(uScale, 0.001);
      vec2 uvA = vec2(u, v * 0.5 + t * 0.4);
      vec2 uvB = vec2(u * 2.0, v * 0.5 + t * 0.2);
      float A = mix(texture2D(uPack1, fp * 0.42 + vec2(0.31, 0.12 + t * 0.03)).r, texture2D(uPack1, uvA).r, core);
      float B = mix(texture2D(uPack1, fp * 0.55 + vec2(0.63, 0.4 + t * 0.02)).g, texture2D(uPack1, uvB).g, core);
      float fres = 1.0 - z;

      // Body from TextureB through the ColorB ramp, darker towards the rim (TextureB_Grad).
      float g = pow(clamp(v * 1.15, 0.0, 1.0), 0.6);
      vec3 body = lut(0.0, B * B * 0.26 * g + 0.03);
      // Veins: TextureA (the tear-away cells) carries ColorA_2, the acid green.
      float vein = smoothstep(0.42, 0.92, A);
      vec3 veinCol = mix(lut(1.0, 0.45 + 0.55 * A), lut(5.0, 0.45 + 0.55 * A), uEnemy);
      body = mix(body, veinCol, vein * 0.6);
      // Fresnel: ColorD → ColorC towards the rim, a thin bright line at the very edge.
      body = mix(body, lut(2.0, fres), clamp(pow(fres, 4.1) * 0.514 * 1.4, 0.0, 0.6));
      body += pow(fres, 8.0) * 0.3 * mix(lut(1.0, 0.8), lut(5.0, 0.8), uEnemy);
      body *= uBoost;

      // Forming: the masked shell grows in through Smoke_Dissolve_Grayscale; the dark inner shell shows in the holes.
      float nIn = mix(texture2D(uPack2, fp * 0.6 + 0.2).r, texture2D(uPack2, vec2(u * 2.0, v * 1.0)).r, core);
      float shell = step(nIn, uDisIn * 1.02 - 0.01);
      float edgeIn = (1.0 - smoothstep(0.0, 0.06, uDisIn * 1.02 - 0.01 - nIn)) * shell * (1.0 - step(0.999, uDisIn));
      float nInner = mix(texture2D(uPack2, fp * 0.7 + 0.5).g, texture2D(uPack2, vec2(u * 2.0 + 0.3, v * 1.3)).g, core);
      float inner = step(nInner, uInnerDis * 1.02);
      vec3 innerCol = lut(3.0, 0.2 + 0.5 * B * v);

      // Fading: Outro_Trans eats it through Wraith_4Xtile90_blur from the rim inwards (Dome_Outter_Mask4).
      float nOut = mix(texture2D(uPack2, fp * 0.8 + vec2(0.1, 0.6)).g, texture2D(uPack2, vec2(u * 3.0, v * mix(2.0, 0.4, uOutro) + t * 0.2)).g, core);
      float grad = smoothstep(0.5, 0.85, v);
      float keep = nOut * 0.8 + grad * 0.25;
      float outCut = 1.0 - uOutroDis;
      float outVis = uOutro > 0.0 ? smoothstep(outCut, outCut + 0.04, keep) : 1.0;
      float outEdge = uOutro > 0.0 ? (1.0 - smoothstep(0.0, 0.08, keep - outCut)) * outVis : 0.0;

      vec3 sc = mix(innerCol, body, shell);
      float sa = max(shell, inner * (1.0 - uOutro));
      sc = mix(sc, mix(lut(1.0, 1.0), lut(5.0, 1.0), uEnemy), max(edgeIn, outEdge) * 0.85);
      sa *= outVis;
      // The rim softens over the last couple of pixels.
      sa *= 1.0 - smoothstep(rEdge - 2.5 * uPx, rEdge, rs);
      col = mix(col, sc, sa);
      a = max(a, sa);
    }

    // Wisp layer (NewShape): translucent, 3.9 % wider, cells of PandemicTearAway_Thin with a strong fresnel.
    float rh = L / (uScale * 1.039);
    if (rh < 1.0 && uHalo > 0.0) {
      float zh = sqrt(max(0.0, 1.0 - rh * rh));
      float vh = 1.0 - asin(rh) / (PI * 0.5);
      float coreh = smoothstep(0.12, 0.5, rh);
      vec2 uvh = vec2(ang, vh * 0.2 + t * 0.25);
      float thin = mix(texture2D(uPack1, p / max(uScale, 0.001) * 0.5 + vec2(0.2, 0.7)).b, texture2D(uPack1, uvh).b, coreh);
      float fa = clamp(59.75 * pow(1.0 - zh, 2.0), 0.0, 1.0);
      float wa = thin * fa * 0.55 * uHalo;
      wa *= 1.0 - smoothstep(1.0 - 2.5 * uPx, 1.0, rh);
      vec3 wc = mix(lut(4.0, thin), lut(6.0, thin), uEnemy);
      col = mix(col, wc, wa);
      a = max(a, wa);
    }
  }

  // centerglow: (2.84, 4, 0.49) × 0.4, drawn towards the camera.
  if (uGlow > 0.0) {
    float gr = L * 457.7 / max(uGlowR, 1.0);
    float gm = exp(-gr * gr * 2.2) * uGlow;
    col += mix(lut(7.0, 0.85), lut(5.0, 1.0), uEnemy) * gm * 0.9;
    a = max(a, gm);
  }

  // Enemy: the TeamColor swap leaves the dark body alone and turns the highlights orange-red.
  a *= uOpacity;
  gl_FragColor = vec4(col * a, a);
}`

const UNIFORMS = [
  'uTime', 'uScale', 'uDome', 'uDisIn', 'uInnerDis', 'uOutro', 'uOutroDis', 'uHalo', 'uBoost',
  'uEnemy', 'uView', 'uOpacity', 'uPx', 'uGlow', 'uGlowR', 'uPuff0', 'uPuff1', 'uPuff2', 'uPuff3', 'uPuff4', 'uPuff5',
] as const
type UniformName = (typeof UNIFORMS)[number]

const painter = createSmokePainter<UniformName>({
  name: 'Poison Cloud',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uPack1', 'uPack2', 'uLut'],
  textures: [{ url: pack1Url }, { url: pack2Url }, { url: lutUrl, clampX: true, clampY: true }],
})

/** Whether the cloud can be drawn yet; asking starts the textures loading. */
export const poisonCloudStatus = (): SmokeStatus => painter.status()
export const subscribePoisonCloud = (listener: () => void): (() => void) => painter.subscribe(listener)

const PUFFS = ['uPuff0', 'uPuff1', 'uPuff2', 'uPuff3', 'uPuff4', 'uPuff5'] as const

/**
 * Paints the cloud in `state` onto `target`, a square 2D canvas, filling it
 * with `POISON_CLOUD_EXTENT` shell radii either side of the centre. False when
 * it could not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintPoisonCloud(target: HTMLCanvasElement, state: PoisonCloudState, enemy: boolean, opacity: number): boolean {
  const values: Partial<Record<UniformName, number | readonly number[]>> = {
    uTime: state.materialTime,
    uScale: state.scale,
    uDome: state.dome ? 1 : 0,
    uDisIn: state.disIn,
    uInnerDis: state.innerDis,
    uOutro: state.outro,
    uOutroDis: state.outroDis,
    uHalo: state.halo,
    uBoost: state.boost,
    uEnemy: enemy ? 1 : 0,
    uView: POISON_CLOUD_EXTENT,
    uOpacity: opacity,
    uPx: (2 * POISON_CLOUD_EXTENT) / Math.max(1, target.width) / Math.max(state.scale, 0.001),
    uGlow: state.glow,
    uGlowR: state.glowCm,
  }
  PUFFS.forEach((name, i) => {
    const q = state.puffs[i]
    values[name] = q ? [q.r, q.a, q.seed, 0] : [0, 0, 0, 0]
  })
  return painter.paint(target, values)
}
