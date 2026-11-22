/**
 * Draws Harbor's Cove from straight above: the game's water dome with the
 * game's caustic web (`Mage_Water_TFX`, `Mage_Water_Blurred_TFX`), the colour
 * ramp `LUT_Mage_Wall_TEX`, faint sand (`Mage_Sand_Comp_TFX`, seen through the
 * shell) and the ground foam decal, drifting at the material's own speeds
 * (`src/assets/cove`). It reads as a light aqua bubble with a white caustic web
 * and a pale rim, as in-game pictures show; how the layers mix is rebuilt by
 * eye, the cooked materials give the textures and numbers, not the node graph.
 */

import lutUrl from '../assets/cove/lut.png'
import noiseUrl from '../assets/cove/noise.png'
import sandUrl from '../assets/cove/sand.png'
import waterUrl from '../assets/cove/water.png'
import type { CoveState } from './coveSmoke.ts'
import { createSmokePainter } from './smokeGl.ts'

/** The picture's half-width in shell radii: room for the foam round its foot. */
export const COVE_EXTENT = 1.08

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uWater, uSand, uNoise, uLut;
uniform float uTime, uView, uScale, uDis, uRing, uEnemy, uOpacity, uPx;

const float PI = 3.14159265;
vec3 lut(float row, float x){ return texture2D(uLut, vec2(clamp(x, 0.004, 0.996), (row + 0.5) / 8.0)).rgb; }
vec4 over(vec4 top, vec4 under){ return top + under * (1.0 - top.a); }

void main(){
  // Units: the water shell's radius (4.63 m). Unreal seen from above: up = +X, right = +Y.
  vec2 p = (vUv * 2.0 - 1.0) * uView / max(uScale, 0.001);
  float rr = length(p);
  float t = uTime;
  float uA = -atan(p.x, p.y) / 6.2831853 + 0.969;   // the dome mesh's own u
  vec4 acc = vec4(0.0);

  // Ground foam (Mage_Q_DecalGround_Foam_MI): a broken white ring at the shell's foot, about 4.65 m.
  if (uRing > 0.01) {
    float d = abs(rr - 1.004);
    float band = 1.0 - smoothstep(0.008, 0.05, d);
    float fn = texture2D(uNoise, vec2(uA * 10.0 + t * 0.125, rr * 4.0 - t * 0.2)).r;
    float keep = 0.62 - 0.42 * uRing;
    float a = band * smoothstep(keep, keep + 0.12, fn * 0.7 + band * 0.3) * 0.895 * uOpacity;
    acc = over(vec4(vec3(0.80, 0.90, 0.90) * a, a), acc);
  }

  // The water dome (Mage_Q_Dome_V2_MI on the outer dome mesh).
  if (rr < 1.0 && uDis < 0.999) {
    float r = rr;
    float z = sqrt(1.0 - r * r);
    float v = asin(r) / PI;                  // 0 at the top pole, 0.5 at the equator
    float core = smoothstep(0.05, 0.42, r);  // near the pole the u wrap pinches: a flat look there
    // Distortion (NoiseDistortion_GS_01, strength 0.0175, scale 12 x 2, speed 0.1, 0.5).
    vec2 dn = vec2(texture2D(uSand, vec2(uA * 12.0, v * 2.0) + t * vec2(0.1, 0.5)).b,
                   texture2D(uSand, vec2(uA * 12.0 + 0.37, v * 2.0 + 0.21) + t * vec2(0.1, 0.5)).b) - 0.5;
    // Water: 7 tiles round, tilt -0.152, Texture_Speed 0.2 / 0.2; the blurred copy at Fast_V 1.0.
    vec2 wuv = vec2(uA * 7.0 - 0.152 * v * 7.0, v) + t * vec2(0.2, 0.2) + dn * 0.07;
    vec3 w = mix(texture2D(uWater, p * 1.35 + t * vec2(0.03, 0.06) + dn * 0.03).rgb, texture2D(uWater, wuv).rgb, core);
    float blur = mix(texture2D(uWater, p * 1.1 - t * vec2(0.0, 0.12)).g,
                     texture2D(uWater, vec2(uA * 7.0, v) + t * vec2(0.0, 1.0)).g, core);
    float caustic = w.r, cell = w.b;
    // Light teal-aqua body from the upper half of the ramp, the caustic web on top in near-white.
    vec3 col = lut(0.0, 0.42 + 0.22 * cell + 0.25 * blur);
    col = mix(col, vec3(0.93, 1.0, 0.98), smoothstep(0.25, 0.85, caustic) * 0.85);
    float fres = pow(1.0 - z, 1.4);
    col = mix(col, lut(5.0, 0.45), fres * 0.35);
    col = mix(col, vec3(0.88, 0.98, 0.97), smoothstep(0.94, 1.0, r) * 0.7);   // pale rim

    // Sand inside, at the bottom of the ball: from above only faint wisps near the rim.
    // The enemy treatment (Mage_Q_Dome_MI_Foe) swaps only these sand colours.
    vec2 suv = vec2(uA * 3.0, v) + t * vec2(0.25, 0.3);
    float sv = mix(texture2D(uSand, p * 0.8 + t * vec2(0.06, 0.09)).r, texture2D(uSand, suv).r, core);
    float sandF = clamp((pow(1.0 - z, 0.4) * mix(2.5, 1.75, uEnemy) - 0.2) * 0.75, 0.0, 1.0);
    float sandA = smoothstep(0.55, 1.0, sv) * sandF * smoothstep(0.6, 0.95, r) * 0.12;
    col = mix(col, mix(lut(1.0, sv * 0.55), lut(2.0, sv * 0.4), uEnemy), sandA);
    // Grains (Dots_Color F6FFFF), scale 10 x 5, speed 0.5, 1.25.
    float g = mix(texture2D(uSand, p * 2.6 + t * vec2(0.1, 0.25)).g,
                  texture2D(uSand, vec2(uA * 10.0, v * 5.0) + t * vec2(0.5, 1.25)).g, core);
    col += lut(5.0, 1.0) * smoothstep(0.35, 0.95, g) * 0.25 * (0.3 + 0.7 * sandF);

    // Dissolve in / out, with a foam lip on the front.
    float n = mix(texture2D(uNoise, p * 0.9).r, texture2D(uNoise, vec2(uA * 2.0, v * 3.0)).r, core);
    float dv = clamp((n - 0.08) / 0.5, 0.0, 1.0) * 0.8 + cell * 0.2;
    float D = uDis * 1.2 - 0.1;
    float vis = smoothstep(D - 0.03, D + 0.03, dv);
    float lip = (1.0 - smoothstep(0.0, 0.09, dv - D)) * step(0.001, uDis);
    col = mix(col, vec3(0.88, 0.97, 0.96), lip * 0.85 * vis);

    float a = vis * (1.0 - smoothstep(1.0 - 2.5 * uPx, 1.0, r)) * uOpacity;
    acc = over(vec4(col * a, a), acc);
  }
  gl_FragColor = acc;
}`

const UNIFORMS = ['uTime', 'uView', 'uScale', 'uDis', 'uRing', 'uEnemy', 'uOpacity', 'uPx'] as const

const painter = createSmokePainter({
  name: 'Cove',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uWater', 'uSand', 'uNoise', 'uLut'],
  textures: [{ url: waterUrl }, { url: sandUrl }, { url: noiseUrl }, { url: lutUrl, clampX: true, clampY: true }],
})

export const coveStatus = painter.status
export const subscribeCove = painter.subscribe

/**
 * Paints the smoke into `target` (a square 2D canvas) with `COVE_EXTENT` shell
 * radii either side of the centre. False when it could not (the caller keeps
 * its fallback).
 */
export function paintCove(target: HTMLCanvasElement, state: CoveState, enemy: boolean, opacity: number): boolean {
  const size = Math.max(1, target.width)
  return painter.paint(target, {
    uTime: state.materialTime,
    uView: COVE_EXTENT,
    uScale: state.scale,
    uDis: state.scale > 0 ? state.dissolve : 1,
    uRing: state.scale > 0 ? state.ring : 0,
    uEnemy: enemy ? 1 : 0,
    uOpacity: opacity,
    uPx: (2 * COVE_EXTENT) / size,
  })
}
