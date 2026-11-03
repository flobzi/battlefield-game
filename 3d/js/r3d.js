// BATTLE FIELD GAME — Three.js (WebGL2) renderer for the shared 2D simulation.
// The sim, controls, combat, bot, audio and UI are the exact same files as the 2D build (../js/*.js).
// This module installs window.R3D, then loads those scripts; game.js delegates render() and the
// screen<->ground mapping to it. Everything here is render-only: it never changes the simulation.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const Q = new URLSearchParams(location.search);
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
const QUAL = ['low', 'med', 'high'].includes(Q.get('q')) ? Q.get('q') : (localStorage.getItem('bf_quality') || (MOBILE ? 'med' : 'high'));
const QS = {
  low:  { shadow: 0,    soft: false, grass: 14000, blades: 3, dpr: 1,    post: false, bloom: false, msaa: true,  dust: 180, items: 500,  blood: 500,  groundEvery: 0.5 },
  med:  { shadow: 1024, soft: false, grass: 34000, blades: 4, dpr: 1.5,  post: true,  bloom: false, msaa: false, dust: 400, items: 1000, blood: 1000, groundEvery: 0.3 },
  high: { shadow: 2048, soft: true,  grass: 64000, blades: 5, dpr: 2,    post: true,  bloom: true,  msaa: true,  dust: 800, items: 1600, blood: 1400, groundEvery: 0.18 },
}[QUAL];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------ renderer / scene ---
const glc = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: QS.msaa && !QS.post, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QS.dpr));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = QS.shadow > 0; renderer.shadowMap.type = QS.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const scene = new THREE.Scene();
const HAZE = new THREE.Color('#cdb97f');
scene.background = HAZE.clone(); scene.fog = new THREE.Fog(HAZE, 400, 1600);
const camera = new THREE.PerspectiveCamera(36, 1, 5, 6000);
const ctrlCam = camera.clone();           // un-shaken camera used for input raycasts / projections
const fitCam = camera.clone();            // scratch camera for the fit solver

// image-based light: cool sky dome + warm horizon + green bounce -> metal helmets pick up a sky reflection
{
  const pm = new THREE.PMREMGenerator(renderer); const es = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: {}, vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 sky = mix(vec3(1.0,0.78,0.48), vec3(0.42,0.55,0.78), smoothstep(0.0,0.6,y)); vec3 gnd = mix(vec3(0.16,0.2,0.07), vec3(0.6,0.5,0.32), smoothstep(-0.4,0.0,y)); vec3 c = y > 0.0 ? sky : gnd; vec3 d = normalize(vP); float sun = pow(max(0.0, dot(d, normalize(vec3(0.62,0.52,-0.58)))), 64.0); gl_FragColor = vec4(c + vec3(8.0,6.0,3.5)*sun, 1.0); }' });
  es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  scene.environment = pm.fromScene(es, 0.03).texture; scene.environmentIntensity = 0.35; pm.dispose();
}
const sunDir = new THREE.Vector3(...((window.CONFIG && CONFIG.r3d && CONFIG.r3d.sunDir) || [0.62, 0.52, -0.58])).normalize();
const sun = new THREE.DirectionalLight(new THREE.Color('#ffc477'), 2.9);
sun.castShadow = QS.shadow > 0;
if (sun.castShadow) { sun.shadow.mapSize.set(QS.shadow, QS.shadow); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6; sun.shadow.radius = 2.5; sun.shadow.camera.near = 10; sun.shadow.camera.far = 3000; }
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color('#7f9ccc'), new THREE.Color('#3b4420'), 0.55));   // cool fill in the shadows

// ------------------------------------------------------------------ post: bloom -> ACES -> grade + vignette ---
let composer = null, gradePass = null;
if (QS.post) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: QS.msaa ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (QS.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.5, 0.9));
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.299,0.587,0.114));
        c = mix(c, c * vec3(0.86,0.97,1.14), (1.0 - smoothstep(0.05,0.45,l)) * 0.45);    // cool shadows
        c = mix(c, c * vec3(1.10,1.0,0.84), smoothstep(0.4,0.95,l) * 0.45);            // warm highlights
        float g = dot(vUv - 0.5, vec2(0.7071, 0.7071));                                 // golden wash from the top-right
        c *= mix(vec3(0.9,0.96,1.06), vec3(1.1,1.02,0.88), smoothstep(-0.45,0.45,g));
        c = clamp((c - 0.5) * 1.1 + 0.5, 0.0, 1.0);                                     // contrast
        vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * (uRes.x > uRes.y ? 0.8 : 1.15);
        c *= mix(1.0, 0.45, smoothstep(0.32, 0.85, length(q)));                          // vignette
        c += (h(vUv * uRes + uTime) - 0.5) * 0.025;                                     // grain
        gl_FragColor = vec4(c, 1.0);
      }` });
  composer.addPass(gradePass);
} else document.getElementById('vig').classList.remove('hidden');

// ------------------------------------------------------------------ geometry helpers ---
function mergeParts(parts) {      // parts: [geometry, matrix, part, limb] -> one indexed geometry with aPart/aLimb (per-part smooth normals kept)
  let n = 0, ni = 0; const gs = parts.map(([g, m]) => { const q = (g.index ? g : mergeVertices(g, 1e-4)).clone().applyMatrix4(m); n += q.attributes.position.count; ni += q.index.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), ap = new Float32Array(n), al = new Float32Array(n), idx = new Uint32Array(ni); let o = 0, oi = 0;
  gs.forEach((g, i) => { const c = g.attributes.position.count, I = g.index.array; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); ap.fill(parts[i][2], o, o + c); al.fill(parts[i][3], o, o + c); for (let k = 0; k < I.length; k++) idx[oi + k] = I[k] + o; o += c; oi += I.length; });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(ap, 1)); out.setAttribute('aLimb', new THREE.BufferAttribute(al, 1)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
// parts: 0 skin 1 tunic 2 shield-face 3 helmet 4 wood 5 steel 6 trousers 7 leather 8 trim 9 face-shadow 10 tunic-dark (shoulders/skirt hem)
// limbs: 0 body 1 leg L 2 leg R 3 spear arm 4 shield arm 5 spear 6 helmet 7 shield 8 head
function kiteGeo(sc = 1, seg = 6) {
  const s = new THREE.Shape(); s.moveTo(0, 3.3 * sc); s.quadraticCurveTo(2.75 * sc, 3.2 * sc, 2.75 * sc, 1.3 * sc); s.quadraticCurveTo(2.4 * sc, -2.4 * sc, 0, -5.6 * sc); s.quadraticCurveTo(-2.4 * sc, -2.4 * sc, -2.75 * sc, 1.3 * sc); s.quadraticCurveTo(-2.75 * sc, 3.2 * sc, 0, 3.3 * sc);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.16, bevelSegments: seg > 4 ? 2 : 1, curveSegments: seg }); g.translate(0, 0, -0.15);
  const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i); P.setZ(i, P.getZ(i) - x * x * 0.09); }   // wraps the arm
  return g;
}
// smooth organic surfaces: weld seams, recompute soft normals (no flat facets)
function smooth(g) { g = g.index ? g : g; for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); g = mergeVertices(g, 1e-3); g.computeVertexNormals(); return g; }
const lathe = (prof, seg) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function buildSoldier(kind, hi = true) {
  const R = hi ? 12 : 8, V = hi ? 7 : 4;              // radial / vertical segments per LOD
  const P = [], Sp = (r) => new THREE.SphereGeometry(r, R, V), Cap = (r, l) => new THREE.CapsuleGeometry(r, l, hi ? 3 : 1, R);
  const add = (g, m, part, limb) => P.push([smooth(g), m, part, limb]);
  for (const sd of [-1, 1]) {
    const limb = sd < 0 ? 1 : 2;
    add(lathe([[0, 1.2], [0.78, 1.5], [0.82, 3.2], [1.0, 5.4], [1.08, 7.2], [0.9, 8.4], [0, 8.6]], R), M4(sd * 1.2, 0, 0), 6, limb);   // tapered leg (calf -> thigh)
    add(Sp(1.0), M4(sd * 1.2, 0.85, 0.4, 0, 0, 0, 0.9, 0.78, 1.45), 7, limb);                                                  // rounded boot
  }
  add(lathe([[0, 5.7], [3.7, 5.75], [3.95, 6.1], [3.55, 7.2], [3.0, 8.5], [2.6, 9.6], [0, 9.9]], R), M4(0, 0, 0, 0, 0, 0, 1, 1, 0.84), 1, 0);   // flared tunic skirt
  add(new THREE.TorusGeometry(3.82, 0.24, hi ? 4 : 3, R), M4(0, 5.95, 0, Math.PI / 2, 0, 0, 1, 0.84, 1), 10, 0);                             // hem
  add(lathe([[0, 9.0], [2.45, 9.2], [2.7, 10.8], [3.05, 12.6], [3.0, 14.1], [2.3, 15.2], [1.1, 15.6], [0, 15.7]], R), M4(0, 0, 0, 0, 0, 0, 1, 1, 0.74), 1, 0);   // tapered torso, round shoulders
  add(new THREE.TorusGeometry(2.62, 0.42, hi ? 4 : 3, R), M4(0, 9.75, 0, Math.PI / 2, 0, 0, 1, 0.8, 1), 7, 0);                               // belt
  add(Sp(0.45), M4(0, 9.75, 2.15, 0, 0, 0, 1.1, 0.9, 0.5), 8, 0);                                                                                // buckle
  for (const sd of [-1, 1]) add(Sp(1.5), M4(sd * 2.85, 14.6, 0, 0, 0, 0, 1.05, 0.8, 1), 10, sd < 0 ? 4 : 3);                                     // shoulders
  add(lathe([[0, 15.0], [1.0, 15.1], [0.95, 16.0], [0, 16.2]], R), M4(), 0, 8);                                                                  // neck
  add(Sp(1.55), M4(0, 16.95, 0.15, 0, 0, 0, 0.95, 1.05, 1), 0, 8);                                                                               // head
  add(Sp(1.2), M4(0, 16.6, 1.0, 0, 0, 0, 1.05, 0.85, 0.6), 9, 8);                                                                                // face in helmet shadow
  const armR = (rx) => M4(2.95, 12.6, 0.5, rx, 0, 0), armL = (z, rx) => M4(-2.95, 12.7, z, rx, 0, 0);
  if (kind === 'archer') {
    add(new THREE.SphereGeometry(1.75, R, V, 0, 6.283, 0, 1.45), M4(0, 17.15, 0), 3, 6);                                                         // skull cap
    add(new THREE.TorusGeometry(1.8, 0.2, 3, R), M4(0, 17.05, 0, Math.PI / 2), 7, 6);                                                         // leather band
    add(Cap(0.8, 5.0), M4(1.2, 13.2, -2.4, 0.15, 0, -0.35), 7, 0);                                                                                // quiver
    add(Cap(0.62, 3.6), M4(2.95, 12.6, 0.6, -0.6, 0, 0), 1, 3); add(Sp(0.72), M4(2.6, 10.9, 2.6), 0, 3);
    add(Cap(0.62, 3.6), M4(-2.95, 12.8, 1.0, -1.0, 0, 0), 1, 4); add(Sp(0.72), M4(-2.9, 11.5, 3.6), 0, 4);
    add(new THREE.TorusGeometry(5.2, 0.26, 3, R), M4(-2.9, 11.6, 3.0, 0, Math.PI / 2, -1.15 + Math.PI / 2), 4, 4);                       // bow
  } else {
    add(new THREE.SphereGeometry(1.8, R, V, 0, 6.283, 0, 1.57), M4(0, 17.1, 0, 0, 0, 0, 1, 1.1, 1), 3, 6);                                       // rounded kettle dome
    add(lathe([[1.7, 17.25], [2.05, 17.1], [2.4, 16.8], [2.45, 16.65], [2.05, 16.9], [1.7, 17.0], [1.7, 17.25]], R), M4(), 3, 6);                 // drooping brim (closed profile)
    add(new THREE.TorusGeometry(1.82, 0.2, 3, R), M4(0, 17.5, 0, Math.PI / 2), 7, 6);                                                         // leather band
    add(Cap(0.62, 3.5), M4(3.0, 12.6, 0.5, -0.5, 0, 0), 1, 3); add(Sp(0.72), M4(3.0, 10.6, 2.3), 0, 3);
    add(new THREE.CylinderGeometry(0.2, 0.2, 34, hi ? 6 : 4, 1, true), M4(3.0, 10.6 + 5.5, 2.3 + 11, Math.PI / 2 - 0.47, 0, 0), 4, 5);           // spear shaft (raised ~27deg)
    add(lathe([[0, -1.4], [0.5, -0.6], [0.55, 0.0], [0.3, 0.9], [0, 1.5]], hi ? 6 : 4), M4(3.0, 10.6 + 13.3, 2.3 + 26.6, Math.PI / 2 - 0.47, 0, 0, 1, 1, 0.45), 5, 5);   // leaf spearhead
    add(Cap(0.62, 3.5), M4(-3.0, 12.6, 0.6, -0.4, 0, 0), 1, 4);
    add(kiteGeo(1, hi ? 6 : 3), M4(-3.35, 10.8, 2.7, -0.22, -0.2, 0), 2, 7);                                                                     // kite shield, bevelled edge
    add(kiteGeo(1.07, hi ? 6 : 3), M4(-3.33, 10.75, 2.45, -0.22, -0.2, 0), 7, 7);                                                                // leather edging
    add(Sp(0.6), M4(-3.42, 11.6, 3.1, 0, 0, 0, 1, 1, 0.6), 3, 7);                                                                                // boss
  }
  return mergeParts(P);
}

// shared vertex animation: walk/run/charge legs + arms, lean + bob, spear thrust & lowered charge/brace,
// shield brace, hit recoil, idle sway with per-man seed, hide dropped gear. aAnim = (phase, speed, attack|-recoil, flags + seed)
const ANIM_HEAD = `attribute float aPart; attribute float aLimb; attribute vec4 aAnim; uniform float uTime; varying float vPart; varying float vSel; varying float vAO;
vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, p.y*c - p.z*s, p.y*s + p.z*c); }
vec3 rotZ(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x*c - p.y*s, p.x*s + p.y*c, p.z); }
`;
const ANIM_BODY = `vec3 transformed = vec3(position);
  float ph = aAnim.x, sp = aAnim.y, at = max(aAnim.z, 0.0), rc = max(-aAnim.z, 0.0), flr = floor(aAnim.w), seed = fract(aAnim.w);
  float sel = mod(flr, 2.0), helmOff = mod(floor(flr / 2.0), 2.0), bare = mod(floor(flr / 4.0), 2.0), brace = mod(floor(flr / 8.0), 2.0);
  vPart = aPart; vSel = sel;
  vAO = mix(0.5, 1.0, smoothstep(0.2, 4.5, position.y)) * (0.82 + 0.18 * smoothstep(5.0, 15.0, position.y));   // soft occlusion at the feet + vertical light gradient
  if (aLimb > 7.5 && aPart < 0.5) vAO *= mix(0.62, 1.0, smoothstep(15.3, 16.9, position.y));   // neck / jaw sitting in the brim's shadow
  float mv = step(0.03, sp), run = smoothstep(0.45, 0.9, sp);
  float sw = sin(ph) * (0.2 + 0.6 * sp) * mv;
  float idle = (1.0 - mv) * (1.0 - bare);
  float tI = uTime * (0.9 + seed * 0.5) + seed * 40.0;
  int L = int(aLimb + 0.5);
  vec3 HIP = vec3(0.0, 8.2, 0.0), SHR = vec3(3.0, 14.6, 0.0), SHL = vec3(-3.0, 14.6, 0.0), HAND = vec3(3.0, 10.6, 2.3), NECK = vec3(0.0, 15.6, 0.0);
  if (L == 1 || L == 2) {
    float s = L == 1 ? sw : -sw; float lift = max(0.0, -s) * 1.6 * run;
    transformed = rotX(transformed - HIP, s) + HIP; transformed.y += lift * smoothstep(6.0, 0.0, position.y);
    transformed = rotZ(transformed - HIP, (L == 1 ? 1.0 : -1.0) * (0.05 * brace + 0.14 * bare * sp)) + HIP;   // braced / fallen legs spread
  } else if (L == 3 || L == 5) {
    float lower = 0.42 * run + 0.22 * brace;                                                  // spear comes down for the charge / brace
    if (L == 5) transformed = rotX(transformed - HAND, 0.4 * at + lower + 0.05 * sin(tI * 1.3) * idle) + HAND;
    transformed = rotX(transformed - SHR, -sw * 0.35 * (1.0 - at) * (1.0 - run) - at * 0.55 - run * 0.25 + rc * 0.5) + SHR;
    transformed.z += at * 4.2 + run * 1.2;
    if (L == 5) transformed *= 1.0 - bare;
  } else if (L == 4 || L == 7) {
    transformed = rotX(transformed - SHL, sw * 0.25 * (1.0 - run) - brace * 0.3 - run * 0.2 - rc * 0.55) + SHL; transformed.z += brace * 0.9 + run * 0.6;
    if (L == 7) transformed *= 1.0 - bare;
  } else if (L == 6 || L == 8) {
    transformed = rotX(transformed - NECK, -rc * 0.35 + 0.06 * sin(tI * 0.7) * idle) + NECK;
    if (L == 6) transformed *= 1.0 - helmOff;
  }
  float lean = 0.04 + 0.12 * sp + 0.2 * run + at * 0.16 + brace * 0.12 - rc * 0.42 + 0.025 * sin(tI) * idle;
  if (L != 1 && L != 2) { transformed = rotX(transformed - HIP, lean) + HIP; transformed = rotZ(transformed - HIP, 0.04 * sin(tI * 0.6) * idle + rc * (seed - 0.5) * 0.4) + HIP; }
  transformed.z -= rc * 1.6;
  transformed.y += abs(cos(ph)) * (0.6 + 0.8 * run) * sp - brace * 0.6 - run * 0.3 + 0.12 * sin(tI * 1.9) * idle;
`;
const SOLDIER_T = { value: 0 };
function soldierMaterial() {
  const U = { uTunic: { value: new THREE.Color() }, uShield: { value: new THREE.Color() }, uHelm: { value: new THREE.Color() }, uTime: SOLDIER_T };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });   // smooth shading
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = ANIM_HEAD + sh.vertexShader.replace('#include <begin_vertex>', ANIM_BODY);
    sh.fragmentShader = `uniform vec3 uTunic, uShield, uHelm; varying float vPart; varying float vSel; varying float vAO;
      vec3 partCol(float p){ if (p < 0.5) return vec3(0.46,0.24,0.14); if (p < 1.5) return uTunic * 0.78; if (p < 2.5) return uShield * 0.85; if (p < 3.5) return mix(uHelm, vec3(0.36, 0.37, 0.40), 0.7) * 0.24; if (p < 4.5) return vec3(0.12,0.065,0.03); if (p < 5.5) return vec3(0.2,0.2,0.21); if (p < 6.5) return vec3(0.07,0.055,0.04); if (p < 7.5) return vec3(0.09,0.045,0.02); if (p < 8.5) return vec3(0.55,0.4,0.12); if (p < 9.5) return vec3(0.09,0.05,0.035); return uTunic * 0.45; }
      ` + sh.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( partCol(vPart) * vAO, opacity ); bool isMetal = (vPart > 2.5 && vPart < 3.5) || (vPart > 4.5 && vPart < 5.5) || (vPart > 7.5 && vPart < 8.5);')
      .replace('float roughnessFactor = roughness;', 'float roughnessFactor = isMetal ? 0.62 : (vPart > 1.5 && vPart < 2.5 ? 0.6 : 0.85);')
      .replace('float metalnessFactor = metalness;', 'float metalnessFactor = isMetal ? 0.45 : 0.0;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.16 * vSel + vec3(0.025,0.02,0.01) * vSel; { float fr = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0); totalEmissiveRadiance += (diffuseColor.rgb * 0.8 + vec3(0.12, 0.10, 0.07)) * pow(fr, 2.5) * (vPart > 8.5 && vPart < 9.5 ? 0.0 : vPart > 4.5 && vPart < 5.5 ? 0.08 : vPart > 2.5 && vPart < 3.5 ? 0.3 : 0.55); }');
  };
  m.userData.U = U;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = (sh) => { sh.uniforms.uTime = SOLDIER_T; sh.vertexShader = ANIM_HEAD + sh.vertexShader.replace('#include <begin_vertex>', ANIM_BODY); };
  return [m, d];
}

// dropped gear: small, dark weathered metal / wood (no bright glints)
function itemGeo(k) {
  const col = (g, c) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const merge = (list) => { let n = 0; list.forEach(([g]) => (n += g.attributes.position.count)); const p = new Float32Array(n * 3), no = new Float32Array(n * 3), c = new Float32Array(n * 3); let o = 0; for (const [g, m] of list) { g.applyMatrix4(m); const q = g.attributes.position.count; p.set(g.attributes.position.array, o * 3); no.set(g.attributes.normal.array, o * 3); c.set(g.attributes.color.array, o * 3); o += q; } const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(p, 3)); out.setAttribute('normal', new THREE.BufferAttribute(no, 3)); out.setAttribute('color', new THREE.BufferAttribute(c, 3)); return out; };
  if (k === 'helmet') return merge([[col(new THREE.SphereGeometry(1.7, 9, 5, 0, 6.283, 0, 1.55), '#ffffff'), M4(0, 0, 0, 0, 0, 0, 1, 1.08, 1)], [col(new THREE.CylinderGeometry(2.05, 2.5, 0.3, 12), '#d0d0d0'), M4()], [col(new THREE.CylinderGeometry(1.74, 1.74, 0.34, 10), '#2a1608'), M4(0, 0.45, 0)]]);
  if (k === 'shield') return merge([[col(kiteGeo(0.95), '#ffffff'), M4(0, 0, 0, -Math.PI / 2)], [col(kiteGeo(1.04), '#2a1608'), M4(0, -0.15, 0, -Math.PI / 2)], [col(new THREE.SphereGeometry(0.55, 6, 4), '#55524c'), M4(0, 0.3, -0.8)]]);
  if (k === 'spear') return merge([[col(new THREE.CylinderGeometry(0.2, 0.2, 30, 5), '#2e1c0f'), M4(0, 0, 0, 0, 0, Math.PI / 2)], [col(new THREE.ConeGeometry(0.5, 2.4, 5), '#55565a'), M4(16.2, 0, 0, 0, 0, -Math.PI / 2)]]);
  if (k === 'sword') return merge([[col(new THREE.BoxGeometry(7, 0.22, 0.75), '#5c5e62'), M4(3.5, 0, 0)], [col(new THREE.BoxGeometry(0.45, 0.35, 2.4), '#4a3c24'), M4()], [col(new THREE.BoxGeometry(2.0, 0.45, 0.5), '#2e1c0f'), M4(-1.2, 0, 0)]]);
  return merge([[col(new THREE.TorusGeometry(5.2, 0.28, 3, 12, 2.3), '#3a2412'), M4(0, 0, 0, Math.PI / 2, 0, 0)]]);   // bow
}


// ------------------------------------------------------------------ world objects (rebuilt per battle) ---
let SIM = null, ready = false;
const world = new THREE.Group(); scene.add(world);
let groundTex = null, groundMesh = null, outerMesh = null, grassMeshes = [], grassMat = null, trampleTex = null, trampleData = null;
const SOLD = [];            // [team*2 + archer] -> { mesh, cap, dead: {m: Float32Array, a: Float32Array, n} }
const ITEMS = {};           // kind -> { mesh, cap, landed: {m, c, n, head} }
let bloodMesh = null, arrowMesh = null, dust = null, flags = [];
const soldierGeo = { spearman: buildSoldier('spearman', true), archer: buildSoldier('archer', true) }, soldierGeoLo = { spearman: buildSoldier('spearman', false), archer: buildSoldier('archer', false) };

function makeGround() {
  const W = SIM.WW, H = SIM.WH;
  if (groundTex) groundTex.dispose();
  groundTex = new THREE.CanvasTexture(SIM.ground); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  groundTex.minFilter = THREE.LinearMipmapLinearFilter; groundTex.generateMipmaps = true;
  if (!groundMesh) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    groundMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 })); groundMesh.receiveShadow = true; world.add(groundMesh);
    outerMesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c3a16'), roughness: 1 }));
    outerMesh.position.y = -0.4; outerMesh.receiveShadow = true; world.add(outerMesh);
  }
  groundMesh.scale.set(W, 1, H); groundMesh.position.set(W / 2, 0, H / 2);
  groundMesh.material.map = groundTex; groundMesh.material.needsUpdate = true; outerMesh.position.x = W / 2; outerMesh.position.z = H / 2;
  // average ground colour for the outer field so the edge disappears in the haze
  const c = document.createElement('canvas'); c.width = c.height = 1; const q = c.getContext('2d'); q.drawImage(SIM.ground, 0, 0, 1, 1); const d = q.getImageData(0, 0, 1, 1).data;
  const oc = document.createElement('canvas'); oc.width = 512; oc.height = Math.round(512 * H / W); oc.getContext('2d').drawImage(SIM.ground, 0, 0, oc.width, oc.height);
  if (outerMesh.material.map) outerMesh.material.map.dispose();
  const ot = new THREE.CanvasTexture(oc); ot.colorSpace = THREE.SRGBColorSpace; ot.wrapS = ot.wrapT = THREE.MirroredRepeatWrapping; ot.anisotropy = 4;
  outerMesh.geometry.dispose(); const OS = 24000; outerMesh.geometry = new THREE.PlaneGeometry(OS, OS).rotateX(-Math.PI / 2);
  const uv = outerMesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) { uv.setXY(i, (uv.getX(i) - 0.5) * OS / W + 0.5, (uv.getY(i) - 0.5) * OS / H + 0.5); } uv.needsUpdate = true;
  outerMesh.material.map = ot; outerMesh.material.color.set(0xffffff); outerMesh.material.needsUpdate = true; void d;
  groundUploadT = 0; groundFull = true;
}

function makeGrass() {
  for (const m of grassMeshes) { world.remove(m); m.geometry.dispose(); } grassMeshes = [];
  const W = SIM.WW, H = SIM.WH;
  // trample/bend field from the sim (RG8: flatten, lateral lean)
  trampleData = new Uint8Array(SIM.TW * SIM.TH * 2);
  if (trampleTex) trampleTex.dispose();
  trampleTex = new THREE.DataTexture(trampleData, SIM.TW, SIM.TH, THREE.RGFormat, THREE.UnsignedByteType); trampleTex.magFilter = trampleTex.minFilter = THREE.LinearFilter; trampleTex.needsUpdate = true;
  if (!grassMat) {
    grassMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    grassMat.userData.U = { uTime: { value: 0 }, uTrample: { value: null }, uGround: { value: null }, uWorld: { value: new THREE.Vector2(W, H) }, uBladeH: { value: 8.4 }, uSun: { value: sunDir } };
    grassMat.onBeforeCompile = (sh) => {
      const GD = Q.get('gdbg');
      Object.assign(sh.uniforms, grassMat.userData.U);
      sh.vertexShader = `attribute vec4 aOff; uniform float uTime, uBladeH; uniform vec3 uSun; uniform sampler2D uTrample, uGround; uniform vec2 uWorld; varying vec3 vTint; varying float vH; varying float vBack; varying float vTr;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }\n` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          float hN = position.y; vec2 base = aOff.xy; vec2 tuv = base / uWorld;
          vec2 tr = texture2D(uTrample, tuv).rg; float t = tr.r; float tdx = tr.g * 2.0 - 1.0;
          float c = cos(aOff.z), s = sin(aOff.z);
          vec2 p = vec2(position.x * c - position.z * s, position.x * s + position.z * c);
          float meadowP = vnoise(base * 0.011 + 3.7) * 0.65 + vnoise(base * 0.037 - 1.3) * 0.35;   // meadow patches: tall lush / short dark
          float H = uBladeH * aOff.w * (0.6 + 0.85 * meadowP);
          float w1 = sin(uTime * 1.6 + base.x * 0.045 + base.y * 0.021) * 0.55 + sin(uTime * 0.57 + base.x * 0.011 - base.y * 0.007) * 0.45;
          float k = hN * hN;
          vec2 bend = vec2(0.42 * w1 + 0.25, 0.18 * w1) * k * H * (1.0 - 0.6 * t) + vec2(tdx * 0.9, 0.55) * t * k * H * 1.1;
          vec3 transformed = vec3(base.x + p.x + bend.x, hN * H * (1.0 - 0.88 * t), base.y + p.y + bend.y);
          vec2 mt = 1.0 - abs(mod(tuv, 2.0) - 1.0); vec2 guv = clamp(vec2(mt.x, 1.0 - mt.y), 0.002, 0.998); vec3 gLo = textureLod(uGround, guv, 4.0).rgb, gHi = textureLod(uGround, guv, 1.0).rgb; vTint = mix(gLo, gHi, 0.3) * (0.86 + 0.24 * fract(sin(dot(base, vec2(12.9898, 78.233))) * 43758.5453)); float inField = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0); vTint = mix(vTint * 0.92, vTint, inField); vTint *= 0.62 + 0.55 * smoothstep(0.15, 0.85, meadowP); vH = hN * (1.0 - 0.5 * t); vTr = t;
          vec3 vd = transformed - cameraPosition; float bk = dot(normalize(vd.xz), normalize(uSun.xz)); vBack = 0.25 + 0.75 * smoothstep(-0.3, 0.9, bk);`);
      sh.fragmentShader = `varying vec3 vTint; varying float vH; varying float vBack; varying float vTr;\n` + sh.fragmentShader
        .replace('#include <dithering_fragment>', GD === 'out' ? 'gl_FragColor = vec4(1.0,0.0,0.0,1.0);' : GD === 'nrm' ? 'gl_FragColor = vec4(normal*0.5+0.5,1.0);' : GD === 'light' ? 'gl_FragColor = vec4(reflectedLight.directDiffuse*0.5 + reflectedLight.indirectDiffuse*2.0, 1.0);' : '#include <dithering_fragment>')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);   // both blade faces lit like the sward (no black back-faces)')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', GD === 'red' ? 'vec4 diffuseColor = vec4(1.0,0.0,0.0,1.0);' : GD === 'tint' ? 'vec4 diffuseColor = vec4(vTint*4.0,1.0);' : 'vec4 diffuseColor = vec4( mix(mix(vTint * 1.5, vTint * 3.0 + vec3(0.10, 0.085, 0.0) * vH * vH, vH), vTint * 2.6 * vec3(1.12, 1.0, 0.62) + vec3(0.03, 0.025, 0.0), vTr * 0.55), opacity );')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += (vTint * 1.6 + vec3(0.07, 0.05, 0.0)) * vec3(1.0, 0.82, 0.38) * pow(vH, 3.0) * vBack * 0.9;   // sun shining through the blade tips');
    };
  }
  const U = grassMat.userData.U; U.uTrample.value = trampleTex; U.uGround.value = groundTex; U.uWorld.value.set(W, H);
  // one clump = several tapered blades (3 segments each), y normalised 0..1
  const B = QS.blades, pos = []; const r = Math.random;
  for (let b = 0; b < B; b++) {
    const ox = (r() - 0.5) * 5.5, oz = (r() - 0.5) * 5.5, a = r() * 6.283, w = 0.8 + r() * 0.7, hh = 0.5 + r() * 0.7, lean = (r() - 0.5) * 0.8;
    const ca = Math.cos(a), sa = Math.sin(a); const lv = [0, 0.4, 0.75, 1], wd = [1, 0.75, 0.42, 0];
    const P = (i, side) => { const y = lv[i] * hh, x = side * wd[i] * w * 0.5, z = lean * lv[i] * lv[i] * 1.5; return [ox + x * ca - z * sa, y, oz + x * sa + z * ca]; };
    for (let i = 0; i < 3; i++) {
      const a0 = P(i, -1), a1 = P(i, 1), b0 = P(i + 1, -1), b1 = P(i + 1, 1);
      if (i < 2) pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0); else pos.push(...a0, ...a1, ...b0);
    }
  }
  const blade = new Float32Array(pos);
  // place clumps on grassy terrain, in chunks for frustum culling
  const MG = 520, GX = W + MG * 2, GY = H + MG * 2;   // grass also outside the playfield so the world edge melts into the haze
  const CH = 7, cw = GX / CH, chh = GY / CH, buckets = Array.from({ length: CH * CH }, () => []);
  const dens = { grass: 1, clover: 1, flowers: 1, shrub: 1.4, reeds: 1.5, forest: 0.8, bank: 0.45, rocks: 0.25 };
  const NG = Math.round(QS.grass * Math.min(1.4, Math.max(1, GX * GY / (2080 * 2020))));   // keep blade density on a bigger field (capped)
  let placed = 0, guard = 0;
  while (placed < NG && guard++ < NG * 6) {
    const x = r() * GX - MG, y = r() * GY - MG, inside = x >= 0 && y >= 0 && x < W && y < H; const t = inside ? SIM.terrainAt(x, y) : 'grass', dd = (dens[t] || 0) * (inside ? 1 : 0.5); if (r() > dd) continue;
    const hs = (t === 'reeds' ? 1.7 : t === 'shrub' ? 1.35 : 1) * (0.65 + r() * 0.75);
    buckets[Math.min(CH - 1, ((y + MG) / chh) | 0) * CH + Math.min(CH - 1, ((x + MG) / cw) | 0)].push(x, y, r() * 6.283, hs); placed++;
  }
  buckets.forEach((arr, i) => {
    if (!arr.length) return;
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(blade, 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(blade.length), 3));
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(arr), 4)); g.instanceCount = arr.length / 4;
    const cx = (i % CH + 0.5) * cw - MG, cz = (((i / CH) | 0) + 0.5) * chh - MG; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 6, cz), Math.hypot(cw, chh) * 0.5 + 20);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - cw / 2 - 10, 0, cz - chh / 2 - 10), new THREE.Vector3(cx + cw / 2 + 10, 26, cz + chh / 2 + 10));
    const m = new THREE.Mesh(g, grassMat); m.receiveShadow = QS.shadow > 0; m.castShadow = false; world.add(m); grassMeshes.push(m);
  });
  stats.grassBlades = placed * B;
}

function makeSoldiers() {
  for (const s of SOLD) if (s) { world.remove(s.mesh); s.geoHi.dispose(); s.geoLo.dispose(); s.mesh.dispose(); } SOLD.length = 0;
  for (let ti = 0; ti < 2; ti++) for (let a = 0; a < 2; a++) {
    const type = a ? 'archer' : 'spearman'; const cnt = SIM.men.filter((m) => m.team === ti && (m.type === 'archer') === !!a).length; const cap = cnt * 2 + 64;
    const geo = soldierGeo[type].clone(), geoLo = soldierGeoLo[type].clone(); const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); anim.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aAnim', anim); geoLo.setAttribute('aAnim', anim);
    const [mat, dmat] = soldierMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, cap); mesh.customDepthMaterial = dmat; mesh.castShadow = QS.shadow > 0; mesh.receiveShadow = QS.shadow > 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; world.add(mesh);
    SOLD[ti * 2 + a] = { mesh, cap, team: ti, anim, geoHi: geo, geoLo, dead: { m: new Float32Array(cap * 16), a: new Float32Array(cap * 4), n: 0 } };
  }
}

function makeFx() {
  for (const k in ITEMS) { world.remove(ITEMS[k].mesh); ITEMS[k].mesh.dispose(); delete ITEMS[k]; }
  for (const k of ['helmet', 'shield', 'spear', 'bow', 'sword']) {
    const metal = k === 'helmet' || k === 'sword';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: metal ? 0.62 : 0.8, metalness: metal ? 0.55 : 0 });
    const cap = QS.items; const mesh = new THREE.InstancedMesh(itemGeo(k), mat, cap); mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = QUAL === 'high'; mesh.receiveShadow = QS.shadow > 0; world.add(mesh);
    ITEMS[k] = { mesh, cap, landed: { m: new Float32Array(cap * 16), c: new Float32Array(cap * 3), n: 0, head: 0 } };
  }
  if (!bloodMesh) {
    bloodMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#4a0605') }), QS.blood); bloodMesh.frustumCulled = false; bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); world.add(bloodMesh);
    const ag = new THREE.CylinderGeometry(0.12, 0.12, 7, 3).rotateX(Math.PI / 2);
    arrowMesh = new THREE.InstancedMesh(ag, new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a1c10') }), 900); arrowMesh.frustumCulled = false; arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); world.add(arrowMesh);
    // dust: soft round point sprites, lit warm, faded by distance haze
    const n = QS.dust, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aTone', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 400 }, uCol: { value: new THREE.Color('#867a66') }, uMud: { value: new THREE.Color('#2c1d10') }, uFog: { value: HAZE }, uNear: { value: 400 }, uFar: { value: 1600 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute float aTone; uniform float uScale, uNear, uFar; varying float vA; varying float vF; varying float vT; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; vA = aAlpha; vT = aTone; vF = smoothstep(uNear, uFar, -mv.z); }',
      fragmentShader: 'uniform vec3 uCol, uFog, uMud; varying float vA; varying float vF; varying float vT; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, mix(0.05, 0.3, vT), r) * vA; if (a < 0.004) discard; float lit = 0.66 + 0.4 * clamp(0.35 - d.y * 1.6 + d.x * 0.6, 0.0, 1.0); vec3 c = mix(uCol * lit * vec3(1.03, 1.0, 0.94), uMud, vT); gl_FragColor = vec4(mix(c, uFog, vF * (1.0 - vT * 0.5)), a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; world.add(pts);
    dust = { pts, n, am: new Float32Array(n), gr: new Float32Array(n), tone: new Float32Array(n), g: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n), life: new Float32Array(n), max: new Float32Array(n), s: new Float32Array(n), head: 0 };
  }
  dust.life.fill(0);
  // standards: pole + waving cloth with the team flag
  for (const f of flags) world.remove(f.group); flags = [];
  for (let ti = 0; ti < 2; ti++) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 36, 5), new THREE.MeshStandardMaterial({ color: new THREE.Color('#3b2a1c'), roughness: 0.8 })); pole.position.y = 18; pole.castShadow = QS.shadow > 0; grp.add(pole);
    const tex = new THREE.CanvasTexture(SIM.teams[ti].flagCanvas); tex.colorSpace = THREE.SRGBColorSpace;
    const cg = new THREE.PlaneGeometry(15, 10, 12, 3).translate(7.5, 0, 0);
    const cm = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }); const U = { uTime: { value: 0 } };
    cm.onBeforeCompile = (sh) => { sh.uniforms.uTime = U.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); float u = position.x / 15.0; transformed.z += sin(uTime * 6.0 - position.x * 0.55) * 1.3 * u; transformed.y -= u * u * 1.5;'); };
    const cloth = new THREE.Mesh(cg, cm); cloth.position.y = 30.5; cloth.castShadow = QS.shadow > 0; grp.add(cloth); grp.visible = false; world.add(grp);
    flags.push({ group: grp, U, tex, team: ti });
  }
}

// ------------------------------------------------------------------ instance writers ---
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
function writeUpright(arr, o, x, y, face, S) {    // T * Ry(pi/2 - face) * S, column-major
  const th = Math.PI / 2 - face, c = Math.cos(th) * S, s = Math.sin(th) * S;
  arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = S; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0; arr[o + 12] = x; arr[o + 13] = 0; arr[o + 14] = y; arr[o + 15] = 1;
}
function poseMatrix(x, h, y, yaw, pitch, roll, S) { _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e); _m.compose(_v.set(x, h, y), _q, _s.set(S, S, S)); return _m; }
const kindOf = (type) => (type === 'archer' ? 1 : 0);
const manScale = (id) => (window.CONFIG.r3d.manHeight || 1) * (0.95 + hash(id) * 0.1);

function addDead(p) {
  if (!ready) return; const S = SOLD[p.team * 2 + kindOf(p.type)]; if (!S) return; const d = S.dead; if (d.n >= S.cap - 70) return;
  const back = p._fs != null ? p._fs : (hash(p.x * 13.1 + p.y) < 0.6 ? -1 : 1);
  poseMatrix(p.x, 1.7, p.y, Math.PI / 2 - p.r, back * Math.PI / 2 * 0.97, (hash(p.y) - 0.5) * 0.5, manScale(p.x | 0)).toArray(d.m, d.n * 16);
  d.a.set([hash(p.x) * 6.28, 0.35 + hash(p.y) * 0.5, 0, 4 + (p.helmOff ? 2 : 0)], d.n * 4); d.n++;
  for (let i = 0; i < 6; i++) spawnDust(p.x + (Math.random() - 0.5) * 8, p.y + (Math.random() - 0.5) * 8, 0.8);
  if (p.heavy) for (let i = 0; i < 6; i++) spawnMud(p.x, p.y, 0.7);
}
function itemPose(k, x, y, z, r, tumble) {
  if (k === 'shield') return poseMatrix(x, 0.4 + z, y, -r, -Math.PI / 2 * 0 + tumble, 0.15 + tumble * 0.7, 1);
  if (k === 'helmet') return poseMatrix(x, 1.0 + z, y, -r, 1.1 + tumble, tumble * 0.5, 1);
  if (k === 'bow') return poseMatrix(x, 0.4 + z, y, -r, tumble, tumble * 0.6, 1);
  return poseMatrix(x, 0.35 + z, y, -r, tumble * 0.3, tumble, 1);   // spear / sword lie flat along their length
}
function teamItemColor(k, team) { const t = SIM.teams[team]; if (!t) return _c.set(1, 1, 1); if (k === 'helmet') return _c.set(t.helmet).lerp(_c2.set('#6b6d72'), 0.75).multiplyScalar(0.42); if (k === 'shield') return _c.set(t.shield).multiplyScalar(0.8); return _c.set(1, 1, 1); }
function addItem(p) {
  if (!ready) return; const I = ITEMS[p.k]; if (!I) return; const L = I.landed; const slot = L.head; L.head = (L.head + 1) % I.cap; L.n = Math.min(I.cap, L.n + 1);
  itemPose(p.k, p.x, p.y, 0, p.r, 0).toArray(L.m, slot * 16); const c = teamItemColor(p.k, p.team); L.c.set([c.r, c.g, c.b], slot * 3);
}

// dust
function spawnDust(x, y, k) {
  if (!dust) return; const i = dust.head; dust.head = (dust.head + 1) % dust.n; const r = Math.random;
  dust.x[i] = x; dust.z[i] = y; dust.y[i] = 1 + r() * 2; dust.vx[i] = (r() - 0.5) * 10 * k; dust.vz[i] = (r() - 0.5) * 10 * k; dust.vy[i] = 3 + r() * 5 * k;
  dust.max[i] = dust.life[i] = 1.4 + r() * 1.8; dust.s[i] = (5 + r() * 5.5) * (0.7 + 0.5 * k); dust.am[i] = 0.15; dust.gr[i] = 1.6; dust.tone[i] = 0; dust.g[i] = 0;
}
// big soft warm cloud rising over the melee
function spawnCloud(x, y, k) {
  if (!dust) return; const i = dust.head; dust.head = (dust.head + 1) % dust.n; const r = Math.random;
  dust.x[i] = x + (r() - 0.5) * 26; dust.z[i] = y + (r() - 0.5) * 26; dust.y[i] = 3 + r() * 5; dust.vx[i] = (r() - 0.5) * 6; dust.vz[i] = (r() - 0.5) * 6; dust.vy[i] = 5 + r() * 7 * k;
  dust.max[i] = dust.life[i] = 3 + r() * 2.5; dust.s[i] = (14 + r() * 14) * (0.8 + 0.3 * k); dust.am[i] = 0.05 + 0.035 * k; dust.gr[i] = 1.9; dust.tone[i] = 0; dust.g[i] = 0;
}
// heavy clods of mud / turf kicked up at impacts (ballistic, dark)
function spawnMud(x, y, k) {
  if (!dust) return; const i = dust.head; dust.head = (dust.head + 1) % dust.n; const r = Math.random, a = r() * 6.283, v = 10 + r() * 22 * k;
  dust.x[i] = x; dust.z[i] = y; dust.y[i] = 2; dust.vx[i] = Math.cos(a) * v; dust.vz[i] = Math.sin(a) * v; dust.vy[i] = 22 + r() * 30 * k;
  dust.max[i] = dust.life[i] = 0.7 + r() * 0.5; dust.s[i] = 1.3 + r() * 1.8; dust.am[i] = 0.9; dust.gr[i] = 0; dust.tone[i] = 1; dust.g[i] = 90;
}
function updateDust(dt) {
  const D = dust, pa = D.pts.geometry.attributes; const P = pa.position.array, S = pa.aSize.array, A = pa.aAlpha.array, TN = pa.aTone.array;
  for (let i = 0; i < D.n; i++) {
    if (D.life[i] <= 0) { A[i] = 0; continue; }
    D.life[i] -= dt; const t = 1 - D.life[i] / D.max[i];
    const mud = D.tone[i] > 0.5;
    D.x[i] += (D.vx[i] + (mud ? 0 : 4)) * dt; D.y[i] += D.vy[i] * dt; D.z[i] += D.vz[i] * dt;
    if (mud) { D.vy[i] -= D.g[i] * dt; if (D.y[i] < 0.3) { D.y[i] = 0.3; D.vx[i] = D.vz[i] = D.vy[i] = 0; } } else { D.vy[i] *= 1 - dt * 0.8; D.vx[i] *= 1 - dt; D.vz[i] *= 1 - dt; }
    P[i * 3] = D.x[i]; P[i * 3 + 1] = D.y[i]; P[i * 3 + 2] = D.z[i]; S[i] = D.s[i] * (0.6 + t * D.gr[i]); TN[i] = D.tone[i];
    A[i] = (mud ? Math.min(1, D.life[i] * 4) : Math.sin(Math.PI * Math.min(1, t * 1.3))) * D.am[i] * (D.life[i] > 0 ? 1 : 0);
  }
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aTone.needsUpdate = true;
}

// ------------------------------------------------------------------ camera: fit EVERY living man, eased ---
let RC = null;
const cam = { tx: 620, tz: 580, d: 900, init: false, shake: 0, hit: 0, hitCD: 0, yaw: 0 };
const _p = new THREE.Vector3();
function placeCam(c, tx, tz, d, yaw) {
  const pt = RC.pitchDeg * Math.PI / 180;
  c.position.set(tx + Math.sin(yaw) * Math.cos(pt) * d, Math.sin(pt) * d, tz + Math.cos(yaw) * Math.cos(pt) * d); c.lookAt(tx, 0, tz); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
}
const FP = []; for (let i = 0; i < 8; i++) FP.push(new THREE.Vector3());
function ndcBounds(c, pts) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of pts) { _p.copy(p).applyMatrix4(c.matrixWorldInverse); if (_p.z > -c.near) return null; _p.applyMatrix4(c.projectionMatrix); x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y); } return { x0, x1, y0, y1 }; }
function fits(tx, tz, d, yaw, pts) { placeCam(fitCam, tx, tz, d, yaw); const b = ndcBounds(fitCam, pts); const N = RC.ndc; return b && b.x0 >= -N.x && b.x1 <= N.x && b.y0 >= N.bottom && b.y1 <= N.top; }
function minDist(tx, tz, yaw, pts, lo = 60, hi = 8000) { if (!fits(tx, tz, hi, yaw, pts)) return hi; for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(tx, tz, mid, yaw, pts)) hi = mid; else lo = mid; } return hi; }
const _ray = new THREE.Raycaster(), _pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _nd = new THREE.Vector2();
function groundAtNdc(c, nx, ny, out) { _ray.setFromCamera(_nd.set(nx, ny), c); return _ray.ray.intersectPlane(_pl, out) ? out : null; }
function solveFit(box, yaw) {
  const ext = Math.max(box.x1 - box.x0, box.y1 - box.y0), P = RC.fitPad || {}, MX = RC.fitMargin + (P.x || 0) * ext, MZ = RC.fitMargin + (P.z || 0) * ext;   // proportional breathing room: open ground around the armies
  const x0 = box.x0 - MX, x1 = box.x1 + MX, z0 = box.y0 - MZ, z1 = box.y1 + MZ, HH = 22 * (RC.manHeight || 1);
  FP[0].set(x0, 0, z0); FP[1].set(x1, 0, z0); FP[2].set(x0, 0, z1); FP[3].set(x1, 0, z1); FP[4].set(x0, HH, z0); FP[5].set(x1, HH, z0); FP[6].set(x0, HH, z1); FP[7].set(x1, HH, z1);
  let tx = (x0 + x1) / 2, tz = (z0 + z1) / 2, d = 600; const A = new THREE.Vector3(), B = new THREE.Vector3(), N = RC.ndc;
  for (let it = 0; it < 4; it++) {
    d = minDist(tx, tz, yaw, FP); placeCam(fitCam, tx, tz, d, yaw); const b = ndcBounds(fitCam, FP); if (!b) break;
    if (!groundAtNdc(fitCam, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, A) || !groundAtNdc(fitCam, 0, (N.top + N.bottom) / 2, B)) break;
    tx += A.x - B.x; tz += A.z - B.z;
  }
  return { tx, tz, d: Math.max(RC.minDist, minDist(tx, tz, yaw, FP)) };
}
function updateCamera(dt) {
  const men = SIM.men; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const m of men) if (m.alive) { if (m.x < x0) x0 = m.x; if (m.x > x1) x1 = m.x; if (m.y < y0) y0 = m.y; if (m.y > y1) y1 = m.y; }
  if (x0 > x1) { x0 = 0; y0 = 0; x1 = SIM.WW; y1 = SIM.WH; }
  const st = SIM.state; if (st === 'menu' || st === 'setup') { x0 -= 40; x1 += 40; y0 -= 40; y1 += 40; }
  const yaw = (innerWidth > innerHeight * 1.15 ? (RC.landscapeYaw ?? Math.PI / 2) : 0) + (st === 'menu' ? Math.sin(time * 0.08) * 0.07 : 0);
  const box = { x0, y0, x1, y1 }; const want = solveFit(box, yaw);
  if (!cam.init) { Object.assign(cam, want, { init: true, yaw }); }
  else {
    const kz = 1 - Math.exp(-dt * (want.d > cam.d ? RC.zoomOutRate : RC.zoomInRate)), kp = 1 - Math.exp(-dt * RC.panRate);
    cam.d = lerp(cam.d, want.d, kz); cam.tx = lerp(cam.tx, want.tx, kp); cam.tz = lerp(cam.tz, want.tz, kp); cam.yaw = lerp(cam.yaw, yaw, kp);
    // hard guarantee: if the eased camera would cut anyone off, back out right now (ease never costs a unit)
    const need = minDist(cam.tx, cam.tz, cam.yaw, FP, 60, 8000); if (need > cam.d) cam.d = need;
  }
  if (window.R3D && window.R3D.debugCam) { const D = window.R3D.debugCam; cam.tx = D.tx; cam.tz = D.tz; cam.d = D.d; }   // test hook (screenshots of details only)
  placeCam(ctrlCam, cam.tx, cam.tz, cam.d, cam.yaw);
  // shake layered on top of the fit (render camera only; input uses the steady ctrlCam)
  cam.shake = Math.max(0, cam.shake - dt * 2.2); const sk = cam.shake * cam.shake * cam.d * 0.006 * RC.shake;
  camera.position.copy(ctrlCam.position); camera.quaternion.copy(ctrlCam.quaternion);
  if (sk > 0.01) { camera.position.x += (Math.random() - 0.5) * sk; camera.position.y += (Math.random() - 0.5) * sk; camera.position.z += (Math.random() - 0.5) * sk * 0.5; }
  camera.updateMatrixWorld();
  scene.fog.near = cam.d * 0.8; scene.fog.far = cam.d * 2.6;
  const far = cam.d * 3 + 1500; if (Math.abs(camera.far - far) > 50) { for (const c of [camera, ctrlCam, fitCam]) { c.far = far; c.updateProjectionMatrix(); } }
  return box;
}

// ------------------------------------------------------------------ ground decal upload (sub-rect, throttled) ---
let groundUploadT = 0, groundFull = true; const crop = document.createElement('canvas'), cropCtx = crop.getContext('2d');
function uploadGround(box, dt) {
  if (groundFull) { groundTex.needsUpdate = true; groundFull = false; groundUploadT = QS.groundEvery; return; }
  if ((groundUploadT -= dt) > 0) return; groundUploadT = QS.groundEvery;
  const tp = renderer.properties.get(groundTex); const gl = renderer.getContext(); const G = SIM.ground, Rr = window.CONFIG.world.groundRes;
  if (!tp.__webglTexture) { groundTex.needsUpdate = true; return; }
  const m = 70; let x0 = Math.max(0, Math.floor((box.x0 - m) * Rr)), y0 = Math.max(0, Math.floor((box.y0 - m) * Rr)), x1 = Math.min(G.width, Math.ceil((box.x1 + m) * Rr)), y1 = Math.min(G.height, Math.ceil((box.y1 + m) * Rr));
  const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
  try {
    if (crop.width !== w || crop.height !== h) { crop.width = w; crop.height = h; } else cropCtx.clearRect(0, 0, w, h);
    cropCtx.drawImage(G, x0, y0, w, h, 0, 0, w, h);
    renderer.state.bindTexture(gl.TEXTURE_2D, tp.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, G.height - y0 - h, gl.RGBA, gl.UNSIGNED_BYTE, crop);
    gl.generateMipmap(gl.TEXTURE_2D);
    stats.groundUploadPx = w * h;
  } catch (e) { groundTex.needsUpdate = true; }
}

// ------------------------------------------------------------------ per-frame ---
let time = 0, lastNow = performance.now(); const SOLDIER_TRIS = { hi: soldierGeo.spearman.index.count / 3, lo: soldierGeoLo.spearman.index.count / 3 };
const stats = { soldierTris: SOLDIER_TRIS, fps: 0, ms: 0, calls: 0, tris: 0, grassBlades: 0, groundUploadPx: 0, quality: QUAL };
const fpsEl = document.getElementById('fps'); let fpsShow = Q.has('fps') || localStorage.getItem('bf_fps') === '1', fpsAcc = 0, fpsN = 0;
const ENG = []; let cloudAcc = 0, lastSimT = 0, lodHi = true; const _l1 = new THREE.Vector3(), _l2 = new THREE.Vector3();
// LOD: smooth 16-segment figure when men are big on screen (or few remain), 8-segment one when zoomed out on big crowds
function manPx(x, y) { _l1.set(x, 0, y).project(ctrlCam); _l2.set(x, 18.9 * (RC.manHeight || 1), y).project(ctrlCam); return Math.hypot(_l2.x - _l1.x, (_l2.y - _l1.y) * innerHeight / innerWidth) * innerWidth / 2; }
function render(sim, simTime) {
  if (!ready) return;
  const now = performance.now(), rawDt = (now - lastNow) / 1000, dt = Math.min(0.05, rawDt); lastNow = now; time = simTime;
  renderer.info.autoReset = false; renderer.info.reset();
  const simDt = simTime - lastSimT; lastSimT = simTime; const box = updateCamera(Math.max(dt, Math.min(0.25, simDt > 0 ? simDt : 0)));   // ease by sim time too, so warped / low-fps frames don't leave the camera lagging
  const st = sim.state, sel = sim.selected, MV = window.CONFIG.move;
  // --- soldiers (alive -> flying -> dead per team/type mesh)
  const cnt = [0, 0, 0, 0]; ENG.length = 0;
  for (const m of sim.men) {
    if (!m.alive) continue; const k = m.team * 2 + kindOf(m.type), S = SOLD[k]; if (!S) continue; const i = cnt[k]++; if (i >= S.cap) continue;
    writeUpright(S.mesh.instanceMatrix.array, i * 16, m.x, m.y, m.face, manScale(m.id)); if (m.engaged) ENG.push(m);
    const sp = clamp(Math.hypot(m.vx, m.vy) / MV.charge, 0, 1), at = m.atk > 0 ? Math.sin(Math.PI * clamp(1 - m.atk / 0.3, 0, 1)) : 0;
    const fl = (st === 'battle' && sel && m.group === sel ? 1 : 0) + (m.engaged && m.atk <= 0 ? 8 : 0) + hash(m.id * 7.3) * 0.98;
    const rc = m.lastHit > 0 ? clamp(1 - (simTime - m.lastHit) / 0.4, 0, 1) : 0, rcv = rc > 0 ? Math.sin(Math.PI * Math.sqrt(1 - rc)) : 0;
    const a = S.anim.array, o = i * 4; a[o] = m.step * Math.PI / 2 + hash(m.id) * 6.28; a[o + 1] = sp; a[o + 2] = rcv > at ? -rcv : at; a[o + 3] = fl;
  }
  for (const p of sim.particles) {
    if (p.k !== 'body') continue; const k = p.team * 2 + kindOf(p.type), S = SOLD[k]; if (!S) continue; const i = cnt[k]++; if (i >= S.cap) continue;
    if (p._fs == null) { p._fs = Math.random() < 0.6 ? -1 : 1; p._age = 0; } p._age += dt;
    const pitch = p._fs * Math.PI / 2 * Math.min(1, p._age * 2.6);
    poseMatrix(p.x, p.z * 0.9 + 1.7 * Math.min(1, p._age * 2.6), p.y, Math.PI / 2 - p.r, pitch + (p.heavy ? p._fs * p._age * 3.2 : 0), Math.sin(p._age * 7) * 0.3, manScale(p.x | 0)).toArray(S.mesh.instanceMatrix.array, i * 16);
    S.anim.array.set([1.57, 1, 0, 4 + (p.helmOff ? 2 : 0)], i * 4);   // splayed legs, gear flying off
  }
  { let sx = 0, sy = 0, n = 0; for (const m of sim.men) if (m.alive) { sx += m.x; sy += m.y; n++; }
    const px = n ? manPx(sx / n, sy / n) : 99, tot = cnt[0] + cnt[1] + cnt[2] + cnt[3], L = RC.lod || {};
    const budget = (L.triBudget || {})[QUAL] ?? (QUAL === 'high' ? 2.4e6 : 1.0e6);   // never let the hi mesh blow the triangle budget
    const want = QUAL !== 'low' && tot * SOLDIER_TRIS.hi < budget && (px > (lodHi ? (L.pxOut ?? 20) : (L.pxIn ?? 26)) || tot < (L.few ?? 220));
    if (want !== lodHi) { lodHi = want; for (const S of SOLD) if (S) S.mesh.geometry = lodHi ? S.geoHi : S.geoLo; }
    stats.lod = lodHi ? 'hi' : 'lo'; stats.camD = Math.round(cam.d); stats.manPx = +px.toFixed(1); }
  for (let k = 0; k < 4; k++) {
    const S = SOLD[k]; if (!S) continue; const d = S.dead, i = Math.min(cnt[k], S.cap - d.n);
    S.mesh.instanceMatrix.array.set(d.m.subarray(0, d.n * 16), i * 16); S.anim.array.set(d.a.subarray(0, d.n * 4), i * 4);
    S.mesh.count = i + d.n; S.mesh.instanceMatrix.needsUpdate = true; S.anim.needsUpdate = true;
    const t = sim.teams[S.team], U = S.mesh.material.userData.U; U.uTunic.value.set(t.tunic); U.uShield.value.set(t.shield); U.uHelm.value.set(t.helmet);
  }
  // --- items (landed ring + flying), blood drops, arrows in flight
  const fly = {}; for (const k in ITEMS) fly[k] = 0;
  for (const k in ITEMS) { const I = ITEMS[k], L = I.landed; I.mesh.instanceMatrix.array.set(L.m.subarray(0, L.n * 16)); I.mesh.instanceColor.array.set(L.c.subarray(0, L.n * 3)); }
  let nb = 0; const BA = bloodMesh.instanceMatrix.array;
  for (const p of sim.particles) {
    if (p.k === 'blood') { if (nb < QS.blood) { const s = p.s || 1; BA.set([s, 0, 0, 0, 0, s * 1.4, 0, 0, 0, 0, s, 0, p.x, p.z, p.y, 1], nb * 16); nb++; } continue; }
    const I = ITEMS[p.k]; if (!I) continue; const L = I.landed, i = L.n + fly[p.k]; if (i >= I.cap) continue; fly[p.k]++;
    itemPose(p.k, p.x, p.y, p.z, p.r, p.r * 1.7).toArray(I.mesh.instanceMatrix.array, i * 16); const c = teamItemColor(p.k, p.team); I.mesh.instanceColor.array.set([c.r, c.g, c.b], i * 3);
  }
  for (const k in ITEMS) { const I = ITEMS[k]; I.mesh.count = Math.min(I.cap, I.landed.n + fly[k]); I.mesh.instanceMatrix.needsUpdate = true; I.mesh.instanceColor.needsUpdate = true; }
  bloodMesh.count = nb; bloodMesh.instanceMatrix.needsUpdate = true;
  let na = 0; const AA = arrowMesh.instanceMatrix.array, dummy = _dummy;
  for (const a of sim.arrows) {
    if (na >= 900) break; const t = clamp(a.t, 0, 1), t2 = Math.min(1, t + 0.02);
    const X = lerp(a.x0, a.x1, t), Y = lerp(a.y0, a.y1, t), H = 4 * a.h * t * (1 - t) + 10 * (1 - t) + 1, X2 = lerp(a.x0, a.x1, t2), Y2 = lerp(a.y0, a.y1, t2), H2 = 4 * a.h * t2 * (1 - t2) + 10 * (1 - t2) + 1;
    dummy.position.set(X, H, Y); dummy.lookAt(X2, H2, Y2); dummy.updateMatrix(); dummy.matrix.toArray(AA, na * 16); na++;
  }
  arrowMesh.count = na; arrowMesh.instanceMatrix.needsUpdate = true;
  // --- dust kick-up from running / charging / fighting men
  if (st === 'battle' || st === 'end') {
    const men = sim.men, n = men.length, tries = QUAL === 'low' ? 6 : QUAL === 'med' ? 12 : 20;
    for (let j = 0; j < tries; j++) { const m = men[(Math.random() * n) | 0]; if (!m || !m.alive) continue; const sp = Math.hypot(m.vx, m.vy); if (sp > MV.run * 0.9 || (m.engaged && Math.random() < 0.5)) spawnDust(m.x - m.vx * 0.1, m.y - m.vy * 0.1, sp / MV.charge + (m.engaged ? 0.6 : 0)); }
  }
  if (ENG.length && (st === 'battle' || st === 'end')) {          // rising warm dust / mud cloud over the melee
    cloudAcc += dt * Math.min(QUAL === 'low' ? 8 : QUAL === 'med' ? 16 : 28, 2 + ENG.length * 0.12);
    while (cloudAcc > 1) { cloudAcc -= 1; const m = ENG[(Math.random() * ENG.length) | 0]; spawnCloud(m.x, m.y, 0.6 + Math.random() * 0.6); if (Math.random() < 0.5) spawnMud(m.x, m.y, 0.6); }
  } else cloudAcc = 0;
  updateDust(dt);
  // --- standards
  for (const f of flags) {
    let b = null; for (const m of sim.men) if (m.alive && m.bearer && m.team === f.team) { b = m; break; }
    f.group.visible = !!b; if (b) { f.group.position.set(b.x - Math.cos(b.face) * 2, 0, b.y - Math.sin(b.face) * 2); f.group.rotation.y = -0.35; }
    f.U.uTime.value = time; if (f.tex.image !== sim.teams[f.team].flagCanvas) { f.tex.image = sim.teams[f.team].flagCanvas; f.tex.needsUpdate = true; }
  }
  // --- grass trample field
  const T = sim.trample, TD = sim.trampleDx, D = trampleData; for (let i = 0, n = T.length; i < n; i++) { D[i * 2] = (T[i] * 255) | 0; D[i * 2 + 1] = clamp((TD[i] * 0.5 + 0.5) * 255, 0, 255) | 0; } trampleTex.needsUpdate = true;
  grassMat.userData.U.uTime.value = time; SOLDIER_T.value = time;
  // --- sun & shadow frustum follow the fight
  const cx = (box.x0 + box.x1) / 2, cz = (box.y0 + box.y1) / 2, rad = Math.max(180, Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + 80);
  sun.target.position.set(cx, 0, cz); sun.position.set(cx + sunDir.x * 1200, sunDir.y * 1200, cz + sunDir.z * 1200);
  if (sun.castShadow) { const sc = sun.shadow.camera; if (Math.abs(sc.right - rad) > rad * 0.08) { sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.updateProjectionMatrix(); } }
  uploadGround(box, dt);
  // --- draw
  dust.pts.material.uniforms.uScale.value = renderer.getDrawingBufferSize(_v2).y * 0.5 * camera.projectionMatrix.elements[5];
  dust.pts.material.uniforms.uNear.value = scene.fog.near; dust.pts.material.uniforms.uFar.value = scene.fog.far;
  if (composer) { gradePass.uniforms.uTime.value = time % 10; composer.render(); } else renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
  fpsAcc += rawDt; fpsN++; if (fpsAcc > 0.5) { stats.fps = fpsN / fpsAcc; stats.ms = 1000 * fpsAcc / fpsN; fpsAcc = 0; fpsN = 0; if (fpsShow) { fpsEl.classList.remove('hidden'); fpsEl.textContent = `${stats.fps.toFixed(0)} fps · ${QUAL} · ${(stats.tris / 1000) | 0}k tris · ${stats.calls} calls`; } else fpsEl.classList.add('hidden'); }
}
const _dummy = new THREE.Object3D(), _v2 = new THREE.Vector2();

function resize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QS.dpr)); renderer.setSize(w, h, false);
  glc.style.width = w + 'px'; glc.style.height = h + 'px';
  if (RC && RC.safePx) { const S = RC.safePx; RC.ndc = { x: 1 - 2 * S.side / w, top: 1 - 2 * S.top / h, bottom: -(1 - 2 * S.bottom / h) }; }   // portrait-first: exact HUD clearance at any size
  for (const c of [camera, ctrlCam, fitCam]) { c.aspect = w / h; c.fov = RC ? RC.fov : 36; c.updateProjectionMatrix(); }
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); gradePass.uniforms.uRes.value.set(w, h); }
}
window.addEventListener('resize', () => { resize(); });

// ------------------------------------------------------------------ public hook used by game.js ---
const _w = new THREE.Vector3();
window.R3D = {
  quality: QUAL, stats, THREE, scene, renderer, camera,
  newBattle(sim) {
    SIM = sim; RC = window.CONFIG.r3d; if (RC.sunDir) sunDir.set(...RC.sunDir).normalize(); resize();
    makeGround(); makeGrass(); makeSoldiers(); makeFx(); cam.init = false; cam.shake = 0; ready = true;
  },
  render,
  toWorld(sx, sy) {
    if (!ready) return { x: 0, y: 0 };
    const w = window.innerWidth, h = window.innerHeight;
    if (!groundAtNdc(ctrlCam, (sx / w) * 2 - 1, -(sy / h) * 2 + 1, _w)) return { x: cam.tx, y: cam.tz };
    return { x: _w.x, y: _w.z };
  },
  toScreen(x, y) {
    if (!ready) return { x: -1e4, y: -1e4 };
    _w.set(x, 0, y).project(ctrlCam); return { x: (_w.x + 1) / 2 * window.innerWidth, y: (1 - _w.y) / 2 * window.innerHeight };
  },
  pxPerUnit(x, y) { const a = this.toScreen(x, y), b = this.toScreen(x + 10, y), c = this.toScreen(x, y + 10); return Math.max(0.05, (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 20); },
  addDead, addItem,
  impact(k) {                                  // k 0..1 from the sim's impact meter
    if (k > 0.18) cam.shake = Math.max(cam.shake, Math.min(1, k * 1.1));
    if (RC.hitStop && k > 0.55 && cam.hitCD <= 0) { cam.hit = 0.045 + 0.06 * k; cam.hitCD = 1.6; }
    if (ENG.length) for (let i = 0; i < 3 + k * 14; i++) { const m = ENG[(Math.random() * ENG.length) | 0]; if (!m.alive) continue; spawnDust(m.x, m.y, 1.2); spawnMud(m.x, m.y, 0.6 + k); if (i < 2 + k * 5) spawnCloud(m.x, m.y, 1 + k); }
  },
  timeScale(dt) { cam.hitCD -= dt; if (cam.hit > 0) { cam.hit -= dt; return 0.12; } return 1; },
};

// settings: quality + fps (reload to rebuild buffers at the new size)
function wireSettings() {
  const q = document.getElementById('setQuality'); if (q) { q.value = QUAL; q.onchange = () => { localStorage.setItem('bf_quality', q.value); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); }; }
  const f = document.getElementById('setFps'); if (f) { f.checked = fpsShow; f.onchange = () => { fpsShow = f.checked; localStorage.setItem('bf_fps', fpsShow ? '1' : '0'); }; }
}

// ------------------------------------------------------------------ boot: load the shared 2D-build scripts ---
const SCRIPTS = ['../audio/manifest.js', '../js/config.js', 'js/config3d.js', '../js/audio.js', '../js/art.js', '../js/game.js'];
(async () => {
  for (const src of SCRIPTS) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed ' + src)); document.body.appendChild(s); });
  wireSettings();
})();
