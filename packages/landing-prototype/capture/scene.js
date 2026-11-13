// PROTOTYPE. The landing hero's drive: Sam's car through air-city's City, in short shots with the car always in the
// middle of the frame. Renders one frame per call (window.renderAt(seconds)) so capture.mjs can step it.
//   ?w=1280&h=720   canvas size          ?ps=3      pixel size of the low-res render
//   ?t=4.5          show that moment     ?play=1    play in real time
//   ?over=x,z,height  look straight down at a tile (for laying out routes)
//   ?blur=9&band=0.16&low=0.07&lowEnd=0.27&lowR=1.7   the tilt-shift (see the blur shader); window.tune({ low: 0.1 }) changes it live
import { THREE } from '/air/src/engine/three-setup.js';
import { GB } from '/air/src/engine/geometry.js';
import { cityMap } from '/air/src/story/maps.js';
import { defaultStyle } from '/air/src/world/tilemap.js';
import { car, train } from '/air/src/assets/props.js';
import { SCENES, SHOT, TRAFFIC, CAR_SCALE } from './route.js';

const q = new URLSearchParams(location.search), num = (k, d) => (q.has(k) ? +q.get(k) : d);
const W = num('w', 1280), H = num('h', 720), PS = num('ps', 2), DEG = Math.PI / 180;
const canvas = document.getElementById('c');
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

// ---- the city, as air-city's view.js draws it
const SKY = new THREE.Color('#a7b7b3');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.BasicShadowMap;
const scene = new THREE.Scene(); scene.background = SKY; scene.fog = new THREE.Fog(SKY, 30, 120);
const FOV = num('fov', 28), cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 700);
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x6f7f66, 0.62 * Math.PI));
const sun = new THREE.DirectionalLight(0xfff0d0, 0.6 * Math.PI);
scene.add(sun, sun.target);
const SH = num('sh', 2048); sun.castShadow = SH > 0; sun.shadow.mapSize.set(SH || 1, SH || 1); sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.03;
const grad = new THREE.DataTexture(new Uint8Array([105, 185, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.generateMipmaps = false; grad.needsUpdate = true;
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad });
const decalMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });

const map = cityMap(), groups = map.geometry(defaultStyle());
{ // the grass round the map, part of the ground
  const a = groups.ground, S = 200, w = map.w, h = map.h, col = new THREE.Color('#6b8a4f');
  for (const [x0, x1, z0, z1] of [[w / 2 - S, w / 2 + S, h / 2 - S, 0], [w / 2 - S, w / 2 + S, h, h / 2 + S], [w / 2 - S, 0, 0, h], [w, w / 2 + S, 0, h]])
    for (let x = x0; x < x1; x += 20) for (let z = z0; z < z1; z += 20) a.quad([x, -0.01, z], [Math.min(x1, x + 20), -0.01, z], [Math.min(x1, x + 20), -0.01, Math.min(z1, z + 20)], [x, -0.01, Math.min(z1, z + 20)], col, [0, 1, 0]);
}
// Software GL draws every triangle it is given and the box has little memory, so one cut of the city is held at a
// time: what is within FAR tiles of the shot (the fog hides the edge), of which only what is within NEAR casts shadows.
const FAR = num('far', 22), NEAR = 8;
const SRC = {};
for (const k of ['ground', 'solid', 'decal']) { SRC[k] = { p: new Float32Array(groups[k].p), c: new Float32Array(groups[k].c) }; groups[k].p = groups[k].c = null; }
function cut({ p, c }, keep) {
  const on = new Uint8Array(p.length / 9); let n = 0;
  for (let i = 0, t = 0; i < p.length; i += 9, t++) if (keep((p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3)) { on[t] = 1; n++; }
  const P = new Float32Array(n * 9), C = new Float32Array(n * 9);
  for (let t = 0, o = 0; t < on.length; t++) if (on[t]) { P.set(p.subarray(t * 9, t * 9 + 9), o); C.set(c.subarray(t * 9, t * 9 + 9), o); o += 9; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.computeVertexNormals();
  return g;
}
let city = null, cityKey = '';
function cityAround(x, z, far = FAR) {
  const key = [x, z, far].join();
  if (key === cityKey) return;
  if (city) { for (const me of city.children) me.geometry.dispose(); scene.remove(city); }
  cityKey = key; city = new THREE.Group();
  const d = (px, pz) => Math.hypot(px - x, pz - z);
  const add = (geo, cast, m = mat) => { const me = new THREE.Mesh(geo, m); me.castShadow = cast; me.receiveShadow = true; me.frustumCulled = false; city.add(me); };
  add(cut(SRC.ground, (a, b) => d(a, b) < far), false);
  add(cut(SRC.solid, (a, b) => d(a, b) < NEAR), true);
  add(cut(SRC.solid, (a, b) => { const r = d(a, b); return r >= NEAR && r < far; }), false);
  add(cut(SRC.decal, (a, b) => d(a, b) < far), false, decalMat);
  scene.add(city);
}
const heightAt = (x, z) => { const f = map.heightAt(Math.floor(x), Math.floor(z)); return f ? f.h(x, z) : 0; };

// ---- cars: each its own mesh, built pointing along +x at the origin
function carMesh(look) {
  const g = new GB(), tram = look.kind === 'tram';
  if (tram) train(g, 0, 0, 'x', 1, 'tram', map.trains?.tram, 0.012); else car(g, 0, 0, 1, 0, look, 0);   // a tram in the city's livery, true to size for its track and wire
  const me = new THREE.Mesh(g.geo(), mat); me.castShadow = true; me.receiveShadow = true; me.scale.setScalar(tram ? 1 : CAR_SCALE); scene.add(me); return me;
}
// Wheels ride RIDE above the road's base height: clear of the asphalt and its paint. `floor` (Sam only) is what else is
// underfoot, for a car that leaves the road: a driveway apron and the sidewalk stand higher than the asphalt.
const RIDE = 0.012, AXLE = 0.075;
function put(me, p, floor) {
  // the height under each axle, taken over a wheel's length so a curb is climbed rather than jumped
  const under = (x, z) => Math.max(heightAt(x, z) + RIDE, floor ? floor(x, z) + 0.001 : -1e9);
  const axle = a => { let y = 0; for (let k = -2; k <= 2; k++) { const o = a + k * 0.015; y += under(p.x + p.ux * o, p.z + p.uz * o); } return y / 5; };
  const f = axle(AXLE), r = axle(-AXLE);
  me.visible = true; me.position.set(p.x, (f + r) / 2, p.z); me.rotation.set(0, Math.atan2(-p.uz, p.ux), 0);
  // nose up or down a ramp or a curb
  me.userData.tilt = Math.atan2(f - r, 2 * AXLE); me.rotateZ(me.userData.tilt);
}
// The top of whatever lies flat under (x, z) within `box` of a path: the highest face of the city no more than a curb
// above the road there (so not a roof, a tree or a bridge overhead). Triangles are gathered once per shot.
function floorOf(P, margin = 0.3) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of P.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 -= margin; x1 += margin; z0 -= margin; z1 += margin;
  const T = [];
  for (const { p } of Object.values(SRC)) for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
    if (Math.max(ax, bx, cx) < x0 || Math.min(ax, bx, cx) > x1 || Math.max(az, bz, cz) < z0 || Math.min(az, bz, cz) > z1) continue;
    if (Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) < 1e-9) continue;   // a wall: no area seen from above
    T.push(ax, p[i + 1], az, bx, p[i + 4], bz, cx, p[i + 7], cz);
  }
  return (x, z) => {
    const top = heightAt(x, z) + 0.06; let y = -1e9;
    for (let i = 0; i < T.length; i += 9) {
      const ax = T[i], az = T[i + 2], bx = T[i + 3], bz = T[i + 5], cx = T[i + 6], cz = T[i + 8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz), u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const h = u * T[i + 1] + v * T[i + 4] + w * T[i + 7];
      if (h <= top && h > y) y = h;
    }
    return y;
  };
}

// ---- paths: waypoints joined by straight runs with rounded corners, walked by distance
function path(pts, r = 0.16) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    if (!a || !b) { out.push(p); continue; }
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), k = Math.min(r, la / 2, lb / 2);
    const p0 = [p[0] + (a[0] - p[0]) * k / la, p[1] + (a[1] - p[1]) * k / la], p1 = [p[0] + (b[0] - p[0]) * k / lb, p[1] + (b[1] - p[1]) * k / lb];
    for (let j = 0; j <= 10; j++) { const t = j / 10, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p1[1]]); }
  }
  const len = [0];
  for (let i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { pts: out, len, total: len.at(-1) };
}
function at(P, s) {
  s = Math.max(0, Math.min(P.total, s));
  let i = 1; while (i < P.len.length - 1 && P.len[i] < s) i++;
  const a = P.pts[i - 1], b = P.pts[i], l = P.len[i] - P.len[i - 1] || 1, t = (s - P.len[i - 1]) / l;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, ux: (b[0] - a[0]) / l, uz: (b[1] - a[1]) / l };
}
// distance along a path at time u in [0, 1]: 'go' sets off from rest, 'stop' comes to rest, otherwise steady
const EASE = { steady: u => u, go: u => u * u * (2 - u), stop: u => 1 - (1 - u) * (1 - u) * (1 + u) };

const sam = carMesh({ kind: 'hatch', paint: '#d06a25' });
const scenes = SCENES.map(s => { const P = path(s.path, s.radius), mid = at(P, P.total / 2); return { ...s, P, mid, floor: floorOf(P) }; });
const others = TRAFFIC.map(t => ({ from: 0, to: 1, ...t, P: path(t.path), me: carMesh(t.look) }));
const DUR = scenes.length * SHOT;

const mix = (a, b, t) => a + (b - a) * t, sm = t => t * t * (3 - 2 * t);
function frame(T, render = true) {
  T = ((T % DUR) + DUR) % DUR;
  const i = Math.min(scenes.length - 1, Math.floor(T / SHOT)), s = scenes[i], u = (T - i * SHOT) / SHOT;
  const p = at(s.P, s.P.total * (EASE[s.ease] || EASE.steady)(u));
  const far = s.far || FAR;
  cityAround(s.mid.x, s.mid.z, far); scene.fog.near = Math.max(far * 0.45, s.cam.dist * 1.6); scene.fog.far = far - 1;
  put(sam, p, s.floor);
  for (const o of others) {
    if (o.scene !== i) { o.me.visible = false; continue; }
    const d = o.from + (o.to - o.from) * u;   // fractions of its path at the shot's start and end
    if (d < 0 || d > 1) { o.me.visible = false; continue; }
    put(o.me, at(o.P, o.P.total * d));
  }
  // camera: looks at the car from `yaw` round it (0 = from the south, 90 = from the east), `pitch` down, `dist` away
  const c0 = s.cam, c1 = s.camTo || s.cam, k = sm(u);
  const yaw = mix(c0.yaw, c1.yaw, k) * DEG, pitch = mix(c0.pitch, c1.pitch, k) * DEG, dist = mix(c0.dist, c1.dist, k);
  const y = heightAt(p.x, p.z) + 0.03, tgt = new THREE.Vector3(p.x, y, p.z);
  cam.position.set(p.x + Math.sin(yaw) * Math.cos(pitch) * dist, y + Math.sin(pitch) * dist, p.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.up.set(0, 1, 0); cam.lookAt(tgt); cam.updateMatrixWorld();
  focusDist = dist;
  // shadows: a tight box round the shot, still for the whole shot so they don't crawl
  const mid = s.mid, m = 7;
  sun.position.set(mid.x + 34, 58, mid.z + 14); sun.target.position.set(mid.x, 0, mid.z); sun.target.updateMatrixWorld();
  Object.assign(sun.shadow.camera, { left: -m, right: m, top: m, bottom: -m, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
  if (render) draw();
}
let focusDist = 5;

// ---- post: low-res render with depth outlines (as view.js), then a tilt-shift blur that grows away from the car's
// depth, a little more colour, a vignette
const rtW = Math.ceil(W / PS), rtH = Math.ceil(H / PS);
const rt = new THREE.WebGLRenderTarget(rtW, rtH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
rt.depthTexture = new THREE.DepthTexture(rtW, rtH); rt.depthTexture.type = THREE.UnsignedIntType;
const full = () => new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const rtA = full(), rtB = full();
const VS = 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}';
const outline = new THREE.ShaderMaterial({
  uniforms: { tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, rtSize: { value: new THREE.Vector2(rtW, rtH) }, scale: { value: PS }, cn: { value: cam.near }, cf: { value: cam.far }, pxk: { value: 2 * Math.tan(FOV * Math.PI / 360) / rtH } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 rtSize; uniform float scale; uniform float cn; uniform float cf; uniform float pxk;
    void main(){
      vec2 px=min(floor(gl_FragCoord.xy/scale),rtSize-1.0);
      vec2 uv=(px+0.5)/rtSize; vec2 t=1.0/rtSize;
      vec3 c=texture2D(tColor,uv).rgb; float d=texture2D(tDepth,uv).r;
      float r=texture2D(tDepth,uv+vec2(t.x,0.0)).r, l=texture2D(tDepth,uv-vec2(t.x,0.0)).r;
      float u=texture2D(tDepth,uv+vec2(0.0,t.y)).r, b=texture2D(tDepth,uv-vec2(0.0,t.y)).r;
      float m=max(max(min(r-d,r+l-2.0*d),min(l-d,r+l-2.0*d)),max(min(u-d,u+b-2.0*d),min(b-d,u+b-2.0*d)));
      float q=cf-d*(cf-cn), lin=cn*cf/q, dl=cn*cf*(cf-cn)/(q*q);
      gl_FragColor=vec4(mix(c,c*0.42,step(3.2*lin*pxk,m*dl)*step(d,0.99999)),1.0);
    }`,
});
// Sharp within `band` of the middle row, fully blurred at the top edge. Below the middle the blur starts sooner (`low`)
// and is whole by `lowEnd`, with `lowR` times the radius: the page sets its headline and report card on the bottom third.
const BLUR = num('blur', 9), BAND = num('band', 0.16), LOW = num('low', 0.07), LOW_END = num('lowEnd', 0.27), LOW_R = num('lowR', 1.7);
const blur = new THREE.ShaderMaterial({
  uniforms: { tColor: { value: null }, tDepth: { value: rt.depthTexture }, size: { value: new THREE.Vector2(W, H) }, dir: { value: new THREE.Vector2(1, 0) }, cn: { value: cam.near }, cf: { value: cam.far }, focus: { value: 5 }, maxR: { value: BLUR }, band: { value: BAND }, low: { value: LOW }, lowEnd: { value: LOW_END }, lowR: { value: LOW_R }, grade: { value: 0 } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 size; uniform vec2 dir; uniform float cn; uniform float cf; uniform float focus; uniform float maxR; uniform float band; uniform float low; uniform float lowEnd; uniform float lowR; uniform float grade;
    void main(){
      vec2 uv=gl_FragCoord.xy/size;
      // blur by screen height (the classic tilt-shift band) and by how far the depth is from the car's
      float d=texture2D(tDepth,uv).r, lin=cn*cf/(cf-d*(cf-cn));
      float below=0.5-uv.y;   // uv.y = 0 is the bottom of the frame
      float byY=below>0.0 ? lowR*smoothstep(low,lowEnd,below) : smoothstep(band,0.5,-below);
      float byZ=smoothstep(0.12,0.9,abs(lin-focus)/focus);
      float r=maxR*max(byY,byZ*0.8);
      vec3 c=vec3(0.0); float w=0.0;
      for(int i=-10;i<=10;i++){ float f=float(i)/10.0, g=exp(-2.5*f*f); c+=texture2D(tColor,uv+dir*f*r/size).rgb*g; w+=g; }
      c/=w;
      if(grade>0.5){
        float l=dot(c,vec3(0.299,0.587,0.114));
        c=mix(vec3(l),c,1.28); c=(c-0.5)*1.06+0.5;
        vec2 v=uv-0.5; c*=1.0-0.35*dot(v,v)*1.6;
      }
      gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
    }`,
});
const postScene = new THREE.Scene(), postCam = new THREE.Camera();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outline); quad.frustumCulled = false; postScene.add(quad);
function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(postScene, postCam); }
function draw() {
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  if (!BLUR) { pass(outline, null); return; }
  pass(outline, rtA);
  blur.uniforms.focus.value = focusDist;
  blur.uniforms.tColor.value = rtA.texture; blur.uniforms.dir.value.set(1, 0); blur.uniforms.grade.value = 0; pass(blur, rtB);
  blur.uniforms.tColor.value = rtB.texture; blur.uniforms.dir.value.set(0, 1); blur.uniforms.grade.value = 1; pass(blur, null);
}

// ---- driving it
window.META = { duration: DUR, shot: SHOT, scenes: scenes.map(s => s.name) };
window.renderAt = T => { frame(T); return true; };
window.tune = o => { for (const k of ['band', 'low', 'lowEnd', 'lowR']) if (o[k] != null) blur.uniforms[k].value = +o[k]; if (o.blur != null) blur.uniforms.maxR.value = +o.blur; };
// where Sam's car stands at T, without drawing: [height above the road's base, nose-up angle]
window.poseAt = T => { frame(T, false); return [sam.position.y - heightAt(sam.position.x, sam.position.z), sam.userData.tilt]; };
window.overAt = (x, z, h = 14) => {
  sam.visible = false; scene.fog.far = 1e4; scene.fog.near = 1e3;
  for (const o of others) o.me.visible = false;
  cityAround(x, z, Math.max(20, h * 1.2));
  cam.position.set(x, h, z + 0.001); cam.lookAt(x, 0, z); cam.updateMatrixWorld(); focusDist = h;
  sun.position.set(x + 34, 58, z + 14); sun.target.position.set(x, 0, z); sun.target.updateMatrixWorld();
  const m = Math.max(9, h); Object.assign(sun.shadow.camera, { left: -m, right: m, top: m, bottom: -m, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
  blur.uniforms.maxR.value = 0; draw();
};
if (q.has('over')) { window.overAt(...q.get('over').split(',').map(Number));
} else if (q.has('play')) {
  const t0 = performance.now(); (function loop() { frame((performance.now() - t0) / 1000); requestAnimationFrame(loop); })();
} else frame(num('t', 0));
window.INFO = () => ({ tris: city.children.map(m => m.geometry.attributes.position.count / 3), src: Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, v.p.length / 9])), renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER) });
window.READY = true;
