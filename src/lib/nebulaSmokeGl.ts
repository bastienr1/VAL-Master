/**
 * Draws Astra's Nebula from straight above: the game's shell with the game's
 * textures (`src/assets/nebula`: `OrbitsPacked2` — R clouds, G cells, B stars —
 * and the orbit lines of `Orbits4`), the `Rift_Palette` colours, the team
 * colours of the effect's TeamColor modules (gold for allies, red for enemies),
 * and the material's drift (Ripple_Speed 0.15), Fresnel, Star and Twirl values.
 * How the layers mix is rebuilt by eye: the cooked materials give the textures
 * and numbers, not the node graph. Ported unchanged in effect from the
 * prototype page (VAL-Master-Plays/prototypes/nebula-smoke); the flat rings on
 * the ground (Base_Ring, the opening and closing ring) and the ending triangles
 * are SVG in `NebulaSmoke.tsx` instead.
 *
 * One WebGL context for all Nebulas, through the shared painter (`smokeGl.ts`).
 */

import orbitsUrl from '../assets/nebula/orbits.png'
import packedUrl from '../assets/nebula/packed.png'
import { NEBULA, type NebulaState } from './nebulaSmoke.ts'
import { createSmokePainter } from './smokeGl.ts'

/** The picture's half-width in shell radii: room for the 1.28× splash and the wreath round it. */
export const NEBULA_EXTENT = 1.4

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPacked, uOrbits;
uniform float uTime, uView, uOpacity, uPx, uEnemy, uRingR;
uniform vec4 uShell;       // scale, glow, fresnel mult, twirl
uniform vec2 uShellB;      // particle alpha (1 whole), outro
uniform vec4 uWreath;      // inner, outer (shell radii), alpha, colour left
uniform vec4 uOrb0, uOrb1; // ring normal xyz, alpha
uniform vec2 uOrbAge;
uniform vec4 uFlash;       // flash radius (cm), intensity, flare radius (cm), intensity
uniform vec2 uThreads;     // age 0..1, alpha

// Rift_Palette (linear).
const vec3 OUTER_BASE = vec3(0.049786, 0.0, 0.114583);
const vec3 OUTER_COOL = vec3(0.05, 0.0, 0.75);
const vec3 OUTER_WARM = vec3(0.442708, 0.034671, 0.26867);
const vec3 FILIGREE_2 = vec3(6.697626, 0.15, 15.0);
const vec3 INNER_COOL = vec3(0.2, 0.025, 0.4);
const vec3 ALLY = vec3(1.0, 0.3338, 0.0611);   // TeamColor BaseColor / DefenderColor
const vec3 ENEMY = vec3(2.0, 0.091, 0.015);    // TeamColor DefaultEnemyColor
const float SHELL_CM = 477.9;

vec3 tm(vec3 c){ c = 1.0 - exp(-max(c, 0.0)); return pow(c, vec3(1.0 / 2.2)); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void over(inout vec4 dst, vec3 c, float a){ dst.rgb = c * a + dst.rgb * (1.0 - a); dst.a = a + dst.a * (1.0 - a); }
void glow(inout vec4 dst, vec3 c, float a){ vec3 add = c * a; dst.rgb += add; dst.a = max(dst.a, min(1.0, max(add.r, max(add.g, add.b)))); }
float line(float d, float w){ return 1.0 - smoothstep(w, w + 1.5 * uPx, abs(d)); }

// One filament ring of radius uRingR, tilted to normal n: its upper half shows above the dome.
float orbitRing(vec2 p, vec4 o, float age){
  if (o.w <= 0.0) return 0.0;
  vec3 n = normalize(o.xyz);
  float L = length(n.xy);
  vec2 ax = L > 1e-3 ? vec2(-n.y, n.x) / L : vec2(1.0, 0.0);
  vec2 bx = (n.z < 0.0 ? -1.0 : 1.0) * vec2(-ax.y, ax.x);
  float A = uRingR, B = max(uRingR * abs(n.z), 0.02);
  float s = dot(p, ax), u = dot(p, bx);
  float th = atan(u / B, s / A);
  vec2 e = vec2(A * cos(th), B * sin(th));
  float d = length(vec2(s, u) - e);
  float up = L > 1e-3 ? smoothstep(0.0, 0.25, sin(th)) : 1.0;
  float chase = 0.45 + 0.55 * pow(fract(th / 6.2831853 - age * 0.6), 3.0);
  return line(d, 0.006) * up * chase * o.w;
}

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uView;           // in shell radii
  float r = length(p);
  float t = uTime;
  vec3 team = mix(ALLY, ENEMY, uEnemy);
  vec4 dst = vec4(0.0);
  float ang = atan(p.y, p.x);

  // Wreath: the dark smoke ring that rises with the shell (Smoke_Ring, Nebula_Wreath_Inst: U 3, V 0.3, pan 0.1 / -0.1).
  if (uWreath.z > 0.0 && r > uWreath.x && r < uWreath.y) {
    float v = (r - uWreath.x) / (uWreath.y - uWreath.x);
    float n = texture2D(uPacked, vec2(ang / 6.2831853 * 3.0 + 0.1 * t, v * 0.3 - 0.1 * t)).r;
    float a = uWreath.z * smoothstep(0.0, 0.3, v) * (1.0 - smoothstep(0.55, 1.0, v)) * (0.45 + 0.8 * n);
    over(dst, tm(vec3(0.05, 0.0, 0.13) * (1.0 + 2.0 * uWreath.w)), clamp(a, 0.0, 1.0));
  }
  // Twisting threads where the star was (under the shell once it lands).
  if (uThreads.y > 0.0) {
    float d = r * SHELL_CM / (90.0 + 260.0 * uThreads.x);
    if (d < 1.0) {
      float sp = abs(fract(ang / 6.2831853 * 3.0 + d * 0.9 - uThreads.x * 1.6) - 0.5);
      float th = (1.0 - smoothstep(0.02, 0.06, sp)) * (1.0 - smoothstep(0.6, 1.0, d)) * smoothstep(0.05, 0.2, d);
      glow(dst, tm(team * mix(3.0, 1.0, uThreads.x)), th * min(uThreads.y, 1.0) * 0.8);
    }
  }

  // The shell (Nebula_Outer_Inst on Sphere_Mesh), seen from above.
  float sc = uShell.x;
  if (sc > 0.0) {
    float rr = r / sc;
    if (rr < 1.0) {
      float z = sqrt(1.0 - rr * rr);
      vec2 q = (p / sc) * (asin(rr) / max(rr, 1e-4)) * 0.63662;   // the globe, unrolled from its pole
      q = rot(q, 0.35 * uShell.w * (1.0 - rr) * (1.0 - rr));       // Twirl
      vec2 w = (texture2D(uPacked, q * 0.55 + t * vec2(0.045, 0.15)).rg - 0.5) * 0.10;   // Distortion 0.05
      float cloud = texture2D(uPacked, q * 0.8 + vec2(0.37, 0.11) + t * vec2(0.075, -0.025) + w).r;
      float cell = texture2D(uPacked, q * 0.9 + vec2(0.71, 0.29) + t * vec2(-0.0175, 0.0525) + w * 1.5).g;
      float star = texture2D(uPacked, q * 1.4 + t * vec2(0.01, 0.006)).b;
      float orb = texture2D(uOrbits, rot(q, t * 0.15) * 0.62 + 0.5).r;
      float orb2 = texture2D(uOrbits, rot(q, -t * 0.09) * 0.9 + vec2(0.23, 0.61)).r;

      vec3 c = OUTER_BASE;
      c = mix(c, OUTER_COOL * 0.5, smoothstep(0.3, 0.95, cloud) * 0.7);
      c += OUTER_WARM * pow(cell, 6.0) * (0.25 + 0.6 * cloud);
      float fr = (1.6887 * pow(max(1.0 - z, 1e-4), 0.2) + 0.0667) * uShell.z;   // Fresnel_Mult, Fresnel_Power, Fresnel_Add
      c += (OUTER_WARM * 0.3 + OUTER_COOL * 0.3) * fr * smoothstep(0.55, 1.0, rr) * 0.6;
      c += team * (1.5 * orb * orb * (0.55 + 0.45 * z) + 0.35 * orb2 * orb2);
      c += vec3(1.0, 0.8, 1.0) * min(10199.68 * pow(star, 3.976) * 0.004, 3.0);   // Star_Mult, Star_Power
      c += FILIGREE_2 * 0.0035 * max(uShell.y - 1.0, 0.0) * (0.5 + fr);         // Glow
      c += (team * 0.5 + OUTER_WARM) * smoothstep(0.93, 1.0, rr);               // GroundSeam
      // The outro breaks the shell up along its cells as it fades; the inner shell shows through.
      float m = cloud * 0.5 + cell * 0.5;
      float cut = 1.0 - uShellB.x;
      float vis = uShellB.y > 0.5 ? smoothstep(cut - 0.04, cut + 0.04, m) : 1.0;
      float rim = uShellB.y > 0.5 ? (1.0 - smoothstep(0.0, 0.1, m - cut)) * vis : 0.0;
      c += (FILIGREE_2 * 0.06 + team * 0.4) * rim;
      float edge = 1.0 - smoothstep(1.0 - 2.0 * uPx / sc, 1.0, rr);
      if (uShellB.y > 0.5) over(dst, tm(INNER_COOL * (0.5 + cloud)), (1.0 - vis) * uShellB.x * 0.55 * edge);
      over(dst, tm(c), vis * edge);
    }
  }

  // Orbit rings: the upper half of each tilted ring passes over the dome.
  float o = orbitRing(p, uOrb0, uOrbAge.x) + orbitRing(p, uOrb1, uOrbAge.y);
  if (o > 0.0) glow(dst, tm(team * 2.6), clamp(o, 0.0, 1.0) * 0.9);

  // The star bursting: radianite flashes and the flare.
  if (uFlash.y > 0.0 || uFlash.w > 0.0) {
    float d = r * SHELL_CM;
    float f1 = uFlash.y * exp(-3.0 * (d * d) / max(uFlash.x * uFlash.x, 1.0));
    float f2 = uFlash.w * exp(-4.0 * (d * d) / max(uFlash.z * uFlash.z, 1.0));
    glow(dst, tm(team * 1.5 * f1 + vec3(1.0, 0.85, 1.2) * (f1 * 0.6 + f2 * 0.5)), 1.0);
  }

  gl_FragColor = dst * uOpacity;
}`

const UNIFORMS = ['uTime', 'uView', 'uOpacity', 'uPx', 'uEnemy', 'uRingR', 'uShell', 'uShellB', 'uWreath', 'uOrb0', 'uOrb1', 'uOrbAge', 'uFlash', 'uThreads'] as const

const painter = createSmokePainter({
  name: 'Nebula',
  frag: FRAG,
  uniforms: UNIFORMS,
  samplers: ['uPacked', 'uOrbits'],
  textures: [{ url: packedUrl }, { url: orbitsUrl }],
})

/** Whether the smoke can be drawn yet; asking starts the textures loading. */
export const nebulaStatus = painter.status
export const subscribeNebula = painter.subscribe

const NO_ORBIT = [0, 0, 1, 0] as const

/**
 * Paints the smoke in `state` onto `target`, a square 2D canvas, filling it
 * with `NEBULA_EXTENT` shell radii either side of the centre. False when it
 * could not (no WebGL, textures not in yet): the caller keeps its fallback.
 */
export function paintNebula(target: HTMLCanvasElement, state: NebulaState, enemy: boolean, opacity: number): boolean {
  const [o0, o1] = state.orbits
  const shell = NEBULA.shellCm
  return painter.paint(target, {
    uTime: state.materialTime,
    uView: NEBULA_EXTENT,
    uOpacity: opacity,
    uPx: (2 * NEBULA_EXTENT) / Math.max(1, target.width),
    uEnemy: enemy ? 1 : 0,
    uRingR: NEBULA.ringCm / shell,
    uShell: [state.scale, state.glow, state.fresnel, state.twirl],
    uShellB: [1 - state.dissolve, state.out],
    uWreath: [(NEBULA.wreathCm[0] / shell) * state.wreath.scale, (NEBULA.wreathCm[1] / shell) * state.wreath.scale, state.wreath.alpha, state.wreath.dark],
    uOrb0: o0 ? [...o0.n, o0.alpha] : NO_ORBIT,
    uOrb1: o1 ? [...o1.n, o1.alpha] : NO_ORBIT,
    uOrbAge: [o0 ? o0.age : 0, o1 ? o1.age : 0],
    uFlash: state.flash,
    uThreads: state.threads,
  })
}
