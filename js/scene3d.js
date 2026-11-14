/* scene3d.js — simplified three.js model of A-1401 (not to scale vertically).
 * Tube length runs along x, the three sections side by side along z, y is up.
 * Tubes are coloured cell by cell with the model's gas temperature; the debris
 * shell on fouled rows thickens with blockage and R_f; air particles rise from the
 * fans at a speed that follows the computed face velocity and change colour with
 * the local air temperature. */
(function () {
  'use strict';
  const S3 = {};
  let renderer, scene, camera, container, ctl, clock;
  let rowMeshes = [], debrisMeshes = [], mats = [], coilGroup, fans = [], particles, pdata;
  let state = { fan: 0.88, speed: 1.5, field: null, tmin: 0, tmax: 170, airOut: null, coilOn: false };
  let running = false, built = false;

  const L = 10.5, W = 3.0, ROWS = 6, BUNDLES = 6, GAP = 0.35;
  const VS = 4.5;                          // vertical exaggeration of the bundle depth
  const Y0 = 5.0;                          // underside of the bundles
  const TPR = 46, PT = W / TPR, PL = PT * Math.sqrt(3) / 2 * VS, RAD = 0.0285;
  const SEGS = 16;
  const bundleZ = b => { const sec = Math.floor(b / 2); return (sec - 1) * (2 * W + 2 * GAP) + (b % 2 ? W / 2 + GAP / 2 : -W / 2 - GAP / 2); };
  const rowY = r => Y0 + 0.08 + r * PL;
  const topY = rowY(ROWS - 1) + 0.08;

  /* ---------------- orbit controls (minimal, mouse + touch) ---------------- */
  function Orbit(cam, el) {
    const o = { theta: -1.05, phi: 1.28, r: 27, target: new THREE.Vector3(0, 4.6, 0) };
    const apply = () => {
      o.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.02, o.phi));
      o.r = Math.max(6, Math.min(80, o.r));
      cam.position.set(o.target.x + o.r * Math.sin(o.phi) * Math.sin(o.theta), o.target.y + o.r * Math.cos(o.phi),
        o.target.z + o.r * Math.sin(o.phi) * Math.cos(o.theta));
      cam.lookAt(o.target);
    };
    const ptrs = new Map(); let mode = null, last = null, pinch = null;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'; last = { x: e.clientX, y: e.clientY };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: o.r, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; }
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); o.r = pinch.r * pinch.d / Math.max(d, 1);
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; pan(c.x - pinch.c.x, c.y - pinch.c.y); pinch.c = c;
        apply(); return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
      if (mode === 'rot') { o.theta -= dx * 0.006; o.phi -= dy * 0.006; } else pan(dx, dy);
      apply();
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); o.r *= Math.exp(e.deltaY * 0.002); apply(); }, { passive: false });
    function pan(dx, dy) {
      const s = o.r * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
      o.target.addScaledVector(right, -dx * s).addScaledVector(upv, dy * s);
    }
    apply();
    return o;
  }

  /* ---------------- textures ---------------- */
  function finTexture() {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    for (let y = 0; y < 64; y++) { g.fillStyle = y % 4 < 2 ? '#ffffff' : '#b9bec4'; g.fillRect(0, y, 4, 1); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6);
    return t;
  }
  function debrisTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#8a6d4b'; g.fillRect(0, 0, 128, 128);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1400; i++) {
      const v = rnd(); g.fillStyle = v < 0.33 ? '#a88c66' : v < 0.66 ? '#6b5236' : '#c9bca4';
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function label(text, size) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d'); g.font = `600 ${size || 56}px system-ui, sans-serif`; g.fillStyle = '#17202a';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(2.4, 0.9, 1); return sp;
  }

  /* ---------------- build ---------------- */
  function build() {
    scene = new THREE.Scene();
    scene.background = null;
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    ctl = Orbit(camera, renderer.domElement);
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0c8, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-12, 25, 18); scene.add(sun);

    // ground
    const grid = new THREE.GridHelper(60, 30, 0xc5ccd3, 0xdde2e8); scene.add(grid);

    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7785, roughness: 0.7, metalness: 0.3 });
    const frameW = 3 * (2 * W + 2 * GAP) + 0.6, frameL = L + 0.6;
    // columns + beams
    for (const sx of [-1, 1]) for (let k = 0; k <= 3; k++) {
      const z = -frameW / 2 + k * frameW / 3;
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.25, Y0, 0.25), steel);
      col.position.set(sx * frameL / 2, Y0 / 2, z); scene.add(col);
    }
    const beamGeo = new THREE.BoxGeometry(frameL, 0.22, 0.22);
    for (const z of [-frameW / 2, frameW / 2]) { const b = new THREE.Mesh(beamGeo, steel); b.position.set(0, Y0 - 0.12, z); scene.add(b); }
    // headers (tube-side boxes) at both ends of every bundle
    const hdrMat = new THREE.MeshStandardMaterial({ color: 0x8794a1, roughness: 0.5, metalness: 0.4 });
    for (let b = 0; b < BUNDLES; b++) for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, topY - Y0 + 0.1, W), hdrMat);
      h.position.set(sx * (L / 2 + 0.15), (Y0 + topY) / 2, bundleZ(b)); scene.add(h);
    }
    // gas inlet nozzle on top header row (visual cue)
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 16), hdrMat);
    noz.position.set(-L / 2 - 0.15, topY + 0.45, bundleZ(0)); scene.add(noz);

    // tubes: one InstancedMesh per row, SEGS segments along each tube, per-instance colour
    const finTex = finTexture();
    const segLen = L / SEGS;
    const geo = new THREE.CylinderGeometry(RAD, RAD, segLen * 0.995, 10, 1, true);
    geo.rotateZ(Math.PI / 2);
    const dummy = new THREE.Object3D();
    for (let r = 0; r < ROWS; r++) {
      const m = new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.55, metalness: 0.15 });
      const count = BUNDLES * TPR * SEGS;
      const mesh = new THREE.InstancedMesh(geo, m, count);
      let i = 0;
      for (let b = 0; b < BUNDLES; b++) for (let t = 0; t < TPR; t++) for (let s = 0; s < SEGS; s++) {
        const z = bundleZ(b) - W / 2 + PT * (t + 0.5 + (r % 2 ? 0.25 : -0.25));
        dummy.position.set(-L / 2 + segLen * (s + 0.5), rowY(r), z); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, new THREE.Color(0.7, 0.7, 0.7)); i++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh); rowMeshes.push(mesh); mats.push(m);
    }

    // debris shells: one InstancedMesh per row, one full-length cylinder per tube
    const dTex = debrisTexture(); dTex.repeat.set(1, 30);
    const dGeo = new THREE.CylinderGeometry(1, 1, L, 10, 1, true); dGeo.rotateZ(Math.PI / 2);
    for (let r = 0; r < ROWS; r++) {
      const m = new THREE.MeshStandardMaterial({ map: dTex, transparent: true, opacity: 0.0, roughness: 1, depthWrite: false });
      const mesh = new THREE.InstancedMesh(dGeo, m, BUNDLES * TPR);
      mesh.userData.r = r; mesh.visible = false;
      debrisMeshes.push(mesh); scene.add(mesh);
    }
    // debris mat on the air-inlet face (underside of the bottom row / coil)
    const matGeo = new THREE.BoxGeometry(L, 1, W);
    S3.mats = [];
    for (let b = 0; b < BUNDLES; b++) {
      const mm = new THREE.Mesh(matGeo, new THREE.MeshStandardMaterial({ map: dTex, transparent: true, opacity: 0, roughness: 1, depthWrite: false }));
      mm.position.set(0, Y0, bundleZ(b)); mm.visible = false; scene.add(mm); S3.mats.push(mm);
    }

    // steam coil row below the bundle
    coilGroup = new THREE.Group();
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.5, metalness: 0.3 });
    const cGeo = new THREE.CylinderGeometry(RAD, RAD, L, 8, 1, true); cGeo.rotateZ(Math.PI / 2);
    const coil = new THREE.InstancedMesh(cGeo, coilMat, BUNDLES * TPR);
    let ci = 0;
    for (let b = 0; b < BUNDLES; b++) for (let t = 0; t < TPR; t++) {
      dummy.position.set(0, Y0 - 0.22, bundleZ(b) - W / 2 + PT * (t + 0.5)); dummy.updateMatrix(); coil.setMatrixAt(ci++, dummy.matrix);
    }
    coilGroup.add(coil); coilGroup.visible = false; scene.add(coilGroup);

    // plenums + fans (forced draft, underneath)
    const plenMat = new THREE.MeshStandardMaterial({ color: 0x9aa7b4, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8794a1 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x4a5663, roughness: 0.6, metalness: 0.4 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0b5cad, roughness: 0.5, metalness: 0.2 });
    const FAN_Y = 2.3, FD = 2.4;
    for (let sec = 0; sec < 3; sec++) {
      const zc = (sec - 1) * (2 * W + 2 * GAP);
      const pg = new THREE.BoxGeometry(L, Y0 - FAN_Y - 0.4, 2 * W + GAP);
      const pl = new THREE.Mesh(pg, plenMat); pl.position.set(0, (Y0 + FAN_Y + 0.4) / 2 - 0.2, zc); scene.add(pl);
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(pg), edgeMat); ed.position.copy(pl.position); scene.add(ed);
      for (const fx of [-L / 4, L / 4]) {
        const g = new THREE.Group(); g.position.set(fx, FAN_Y, zc);
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(FD / 2 + 0.08, FD / 2 + 0.08, 0.5, 40, 1, true), ringMat);
        ring.material.side = THREE.DoubleSide; g.add(ring);
        const rot = new THREE.Group();
        rot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 16), ringMat));
        for (let k = 0; k < 4; k++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(FD / 2 - 0.15, 0.03, 0.26), bladeMat);
          bl.position.x = (FD / 2 - 0.15) / 2 + 0.1; bl.rotation.x = 0.35;
          const arm = new THREE.Group(); arm.rotation.y = k * Math.PI / 2; arm.add(bl); rot.add(arm);
        }
        g.add(rot); fans.push(rot);
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), ringMat); motor.position.y = -0.6; g.add(motor);
        scene.add(g);
      }
      const lb = label('Section ' + 'ABC'[sec]); lb.position.set(L / 2 + 1.6, topY + 0.6, zc); scene.add(lb);
    }
    const gl = label('gas in, top row', 34); gl.position.set(-L / 2 - 0.4, topY + 1.4, bundleZ(0)); gl.scale.set(3.2, 1.2, 1); scene.add(gl);
    const al = label('air in ↑', 40); al.position.set(-L / 2 - 1.6, 1.0, 0); scene.add(al);

    // air particles
    const NP = 1800;
    const pos = new Float32Array(NP * 3), col = new Float32Array(NP * 3);
    pdata = new Float32Array(NP * 2);   // [column index x (0..1), z]
    const zMin = bundleZ(0) - W / 2, zMax = bundleZ(5) + W / 2;
    for (let i = 0; i < NP; i++) {
      pos[i * 3] = (Math.random() - 0.5) * L; pos[i * 3 + 1] = FAN_Y + Math.random() * (topY + 2.5 - FAN_Y);
      pos[i * 3 + 2] = zMin + Math.random() * (zMax - zMin);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    particles.userData = { FAN_Y, zMin, zMax };
    scene.add(particles);

    new ResizeObserver(resize).observe(container);
    resize();
    built = true;
  }

  function resize() {
    if (!renderer) return;
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1);
    camera.fov = w < 600 ? 55 : 40; camera.updateProjectionMatrix();
  }

  /* ---------------- per-frame ---------------- */
  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const w = state.fan * 14;                         // visual rotation rate, rad/s
    fans.forEach(f => { f.rotation.y += w * dt; });
    const pa = particles.geometry.attributes.position, ca = particles.geometry.attributes.color;
    const { FAN_Y, zMin, zMax } = particles.userData;
    const vBase = state.speed;
    const top = topY + 2.5;
    for (let i = 0; i < pa.count; i++) {
      let y = pa.array[i * 3 + 1];
      const inBundle = y > Y0 - 0.3 && y < topY;
      y += dt * vBase * (inBundle ? 1.9 : 1);
      if (y > top || state.speed < 0.02 && y > top - 0.1) {
        y = FAN_Y + Math.random() * 0.3;
        pa.array[i * 3] = (Math.random() - 0.5) * L;
        pa.array[i * 3 + 2] = zMin + Math.random() * (zMax - zMin);
      }
      pa.array[i * 3 + 1] = y;
      // colour by local air temperature
      let T = state.tamb;
      if (state.field && y > Y0) {
        const N = state.field.N;
        const xi = Math.min(N - 1, Math.max(0, Math.floor((pa.array[i * 3] / L + 0.5) * N)));
        const rr = Math.min(ROWS - 1, Math.max(-1, Math.floor((y - Y0 - 0.08) / PL)));
        T = rr < 0 ? state.tamb : state.field.TaOut[rr][xi];
      }
      const c = UI.cmap((T - state.tmin) / Math.max(1, state.tmax - state.tmin));
      ca.array[i * 3] = c[0]; ca.array[i * 3 + 1] = c[1]; ca.array[i * 3 + 2] = c[2];
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    renderer.render(scene, camera);
  }

  /* ---------------- public API ---------------- */
  S3.init = function (el) {
    container = el;
    if (!window.THREE) { el.insertAdjacentHTML('beforeend', '<p style="padding:20px">three.js did not load.</p>'); return; }
    build();
  };
  S3.setRunning = function (on) {
    if (!built) return;
    if (on && !running) { running = true; clock.getDelta(); resize(); tick(); }
    else if (!on) running = false;
  };

  /** Update visuals from a model result. */
  S3.update = function (res) {
    if (!built) return;
    const p = res.params, N = res.field.N;
    state.tmin = Math.min(p.Tamb, 0); state.tmax = Math.max(p.Tin, 60); state.tamb = p.Tamb;
    state.field = res.field; state.fan = p.fanPct / 100;
    state.speed = Math.max(0.0, res.airflow.faceV) * 1.3;
    document.getElementById('cbMin').textContent = Math.round(state.tmin);
    document.getElementById('cbMax').textContent = Math.round(state.tmax);

    // tube colours from cell gas temperatures (model rows r = 0 bottom … 5 top)
    const col = new THREE.Color();
    for (let r = 0; r < ROWS; r++) {
      const mesh = rowMeshes[r]; let i = 0;
      for (let b = 0; b < BUNDLES; b++) for (let t = 0; t < TPR; t++) for (let s = 0; s < SEGS; s++) {
        const x = Math.min(N - 1, Math.floor(s * N / SEGS));
        const T = res.field.cellTg[r][x];
        const c = UI.cmap((T - state.tmin) / (state.tmax - state.tmin));
        col.setRGB(c[0], c[1], c[2]); mesh.setColorAt(i++, col);
      }
      mesh.instanceColor.needsUpdate = true;
    }

    // debris: shell thickness grows with blockage and R_f (visual scale)
    const blk = res.blockage, dummy = new THREE.Object3D();
    const g = res.geom;
    const rf = Math.min(1, p.Rf / 0.6);
    for (let r = 0; r < ROWS; r++) {
      const w = blk.fouled[r];
      const sev = w * (0.7 * Math.min(1, p.blockage / 0.7) + 0.5 * rf);
      const mesh = debrisMeshes[r];
      mesh.visible = sev > 0.01;
      if (!mesh.visible) continue;
      const rad = RAD * (1.05 + 0.9 * sev);
      let i = 0;
      for (let b = 0; b < BUNDLES; b++) for (let t = 0; t < TPR; t++) {
        dummy.position.set(0, rowY(r), bundleZ(b) - W / 2 + PT * (t + 0.5 + (r % 2 ? 0.25 : -0.25)));
        dummy.scale.set(1, rad, rad); dummy.updateMatrix(); mesh.setMatrixAt(i++, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.material.opacity = Math.min(0.55, 0.12 + 0.4 * sev);
    }
    // mat on the air-inlet face (below bottom row, or below the steam coil)
    const matSev = Math.min(1, (p.blockage / 0.7) * (blk.fouled[0] || 0) * 0.8 + 0.4 * rf * (blk.fouled[0] || 0));
    S3.mats.forEach(m => {
      m.visible = matSev > 0.02;
      const th = 0.01 + 0.12 * matSev;
      m.scale.set(1, th, 1);
      m.position.y = (p.steamCoil ? Y0 - 0.22 - 0.05 : Y0 + 0.02) - th / 2;
      m.material.opacity = Math.min(0.85, 0.15 + 0.7 * matSev);
    });
    coilGroup.visible = !!p.steamCoil;
  };

  window.Scene3D = S3;
})();
