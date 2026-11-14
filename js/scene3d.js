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
  let groundGrid, cageMats = [], fanGroup, fanKey = '', hoodGroup, cageGroup, filterGroup, sprayGroup, mist, spareGroup;
  let state = { fan: 0.88, speed: 1.5, field: null, tmin: 0, tmax: 170, airOut: null, coilOn: false, hood: false, mistOn: false, tamb: 7 };
  const FAN_Y = 2.3;
  const HOOD_H = 3.2, HOOD_R = 2.6;          // hood height above the top row and fillet radius
  let running = false, built = false;

  const L = 10.5, W = 3.0, ROWS = 6, BUNDLES = 6, GAP = 0.35;
  const VS = 4.5;                          // vertical exaggeration of the bundle depth
  const Y0 = 5.0;                          // underside of the bundles
  const TPR = 46, PT = W / TPR, PL = PT * Math.sqrt(3) / 2 * VS, RAD = 0.0285;
  const SEGS = 16;
  const bundleZ = b => { const sec = Math.floor(b / 2); return (sec - 1) * (2 * W + 2 * GAP) + (b % 2 ? W / 2 + GAP / 2 : -W / 2 - GAP / 2); };
  const rowY = r => Y0 + 0.08 + r * PL;
  const topY = rowY(ROWS - 1) + 0.08;
  const FW = 3 * (2 * W + 2 * GAP) + 0.6;    // frame width (across the three sections)
  const SPARE_DZ = FW + 9;                   // standby cooler placed beside the main one

  /* ---------------- solution hardware ---------------- */
  const glassMat = (color, opacity) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2,
    transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const edgeLine = (geo, color) => new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color }));

  /** Tapered plenum (fan ring → whole bundle face) and the fan(s). */
  function buildFans(n, D) {
    while (fanGroup.children.length) fanGroup.remove(fanGroup.children[0]);
    fans = [];
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x4a5663, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0b5cad, roughness: 0.5, metalness: 0.2 });
    // fan positions: n fans spread along z (one fan sits in the middle)
    const zs = []; for (let i = 0; i < n; i++) zs.push(n === 1 ? 0 : -FW / 2 + FW * (i + 0.5) / n);
    // plenum: a box whose bottom face shrinks to the fan ring(s)
    const h = Y0 - FAN_Y - 0.25;
    const pg = new THREE.BoxGeometry(1, h, 1);
    const pa = pg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const top = pa.getY(i) > 0;
      pa.setX(i, pa.getX(i) * (top ? L : Math.min(L, D + 0.5)));
      pa.setZ(i, pa.getZ(i) * (top ? FW - 0.6 : (n === 1 ? D + 0.5 : FW - 0.6)));
    }
    pg.computeVertexNormals();
    const pl = new THREE.Mesh(pg, glassMat(0x9aa7b4, 0.16)); pl.position.set(0, FAN_Y + 0.25 + h / 2, 0);
    const pe = edgeLine(pg, 0x8794a1); pe.position.copy(pl.position);
    fanGroup.add(pl, pe);
    for (const z of zs) {
      const g = new THREE.Group(); g.position.set(0, FAN_Y, z);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.1, D / 2 + 0.1, 0.55, 48, 1, true), ringMat));
      const rot = new THREE.Group();
      rot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.35, 16), ringMat));
      const nb = 6;
      for (let k = 0; k < nb; k++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(D / 2 - 0.2, 0.04, 0.38), bladeMat);
        bl.position.x = (D / 2 - 0.2) / 2 + 0.15; bl.rotation.x = 0.35;
        const arm = new THREE.Group(); arm.rotation.y = k * 2 * Math.PI / nb; arm.add(bl); rot.add(arm);
      }
      g.add(rot); fans.push(rot);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 16), ringMat); motor.position.y = -0.75; g.add(motor);
      fanGroup.add(g);
    }
  }

  /** Hood: rises from the top row and turns 90° with a round fillet to a side outlet (+x),
   *  so rain, dust and insects cannot fall in from above. */
  function buildHood() {
    hoodGroup = new THREE.Group();
    const x0 = -L / 2 - 0.4, x1 = L / 2 + 0.4, y0 = topY + 0.05, t = 0.08;
    const prof = (o) => {                                    // roof line, offset o inward
      const pts = [new THREE.Vector2(x0 + o, y0)];
      const cx = x0 + HOOD_R, cy = y0 + HOOD_H - HOOD_R;
      pts.push(new THREE.Vector2(x0 + o, cy));
      for (let a = 1; a <= 16; a++) {
        const th = Math.PI - a * Math.PI / 2 / 16;
        pts.push(new THREE.Vector2(cx + (HOOD_R - o) * Math.cos(th), cy + (HOOD_R - o) * Math.sin(th)));
      }
      pts.push(new THREE.Vector2(x1 + 1.2, y0 + HOOD_H - o));
      return pts;
    };
    const outer = prof(0), inner = prof(t).reverse();
    const shell = new THREE.Shape([...outer, new THREE.Vector2(x1 + 1.2, y0 + HOOD_H - 0.6), new THREE.Vector2(x1 + 1.2 - t, y0 + HOOD_H - 0.6), ...inner]);
    const depth = FW + 0.4;
    const sg = new THREE.ExtrudeGeometry(shell, { depth, bevelEnabled: false, curveSegments: 4 });
    sg.translate(0, 0, -depth / 2);
    const mat = glassMat(0x9fb3c8, 0.62);
    hoodGroup.add(new THREE.Mesh(sg, mat), edgeLine(sg, 0x4a5663));
    // side cheeks (closed ends)
    const cheek = new THREE.Shape([...outer, new THREE.Vector2(x1 + 1.2, y0 + HOOD_H - 0.6), new THREE.Vector2(x1, y0)]);
    for (const z of [-depth / 2, depth / 2]) {
      const cg = new THREE.ShapeGeometry(cheek); cg.translate(0, 0, z);
      hoodGroup.add(new THREE.Mesh(cg, glassMat(0x9fb3c8, 0.38)), edgeLine(cg, 0x4a5663));
    }
    const lb = label('hood', 40); lb.position.set(x0 + 1.5, y0 + HOOD_H + 0.7, 0); hoodGroup.add(lb);
    hoodGroup.visible = false; scene.add(hoodGroup);
  }

  function gridTexture(cell, line, color) {
    const c = document.createElement('canvas'); c.width = c.height = cell;
    const g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = line;
    g.strokeRect(line / 2, line / 2, cell - line, cell - line);
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
  }

  /** Outer wire-mesh cage around the whole cooler (sides, from grade to the hood). */
  function buildCage() {
    cageGroup = new THREE.Group();
    const cx = L + 3.8, cz = FW + 2.0, h = topY + HOOD_H + 0.2;
    const make = (w, rep) => {
      const tx = gridTexture(64, 2, '#ffffff'); tx.repeat.set(rep, h / 0.35);
      const mat = new THREE.MeshBasicMaterial({ map: tx, color: 0x6b7785, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.55 });
      cageMats.push(mat);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    };
    const faces = [[cx, 0, cz / 2, 0], [cx, 0, -cz / 2, 0], [cz, cx / 2, 0, Math.PI / 2], [cz, -cx / 2, 0, Math.PI / 2]];
    for (const [w, x, z, ry] of faces) {
      const m = make(w, w / 0.35); m.position.set(x, h / 2, z); m.rotation.y = ry; cageGroup.add(m);
    }
    const posts = new THREE.MeshStandardMaterial({ color: 0x56606b });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), posts); p.position.set(sx * cx / 2, h / 2, sz * cz / 2); cageGroup.add(p);
    }
    const lb = label('cage', 40); lb.position.set(-cx / 2, h + 0.5, cz / 2); cageGroup.add(lb);
    cageGroup.visible = false; scene.add(cageGroup);
  }

  /** Filter house around the fan inlet: pleated panels on the sides and in front (below). */
  function buildFilters() {
    filterGroup = new THREE.Group();
    const c = document.createElement('canvas'); c.width = 64; c.height = 8;
    const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) { g.fillStyle = x % 8 < 4 ? '#f4f1e8' : '#cfc9b8'; g.fillRect(x, 0, 1, 8); }
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    filterGroup.userData.tex = tx;
    filterGroup.visible = false; scene.add(filterGroup);
  }
  function sizeFilters(D) {
    while (filterGroup.children.length) filterGroup.remove(filterGroup.children[0]);
    const s = D + 2.2, h = FAN_Y - 0.15, y = 0.15 + h / 2;
    const tx = filterGroup.userData.tex.clone(); tx.needsUpdate = true; tx.repeat.set(s * 3, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tx, side: THREE.DoubleSide, transparent: true, opacity: 0.9, roughness: 0.9 });
    const box = new THREE.BoxGeometry(s, h, s);
    const m = new THREE.Mesh(box, mat); m.position.y = y;
    const e = edgeLine(box, 0x8a826c); e.position.y = y;
    // frame on top joins the fan ring
    filterGroup.add(m, e);
    const lb = label('filters', 40); lb.position.set(s / 2 + 1.2, 1.2, s / 2); filterGroup.add(lb);
  }

  /** Water spray: nozzle ring around the air inlet and a mist that is shown when spraying. */
  function buildSpray() {
    sprayGroup = new THREE.Group();
    const nm = new THREE.MeshStandardMaterial({ color: 0x2a7fc4, roughness: 0.4, metalness: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.06, 8, 64), nm); ring.rotation.x = Math.PI / 2; ring.position.y = 0.6;
    sprayGroup.add(ring);
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, n = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 0.25, 8), nm);
      n.position.set(3.3 * Math.cos(a), 0.75, 3.3 * Math.sin(a)); sprayGroup.add(n);
    }
    const NP = 500, pos = new Float32Array(NP * 3);
    for (let i = 0; i < NP; i++) { const a = Math.random() * 6.283, r = 2.6 + Math.random() * 1.2;
      pos[i * 3] = r * Math.cos(a); pos[i * 3 + 1] = 0.7 + Math.random() * 1.5; pos[i * 3 + 2] = r * Math.sin(a); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mist = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x7fc4ff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false }));
    sprayGroup.add(mist);
    const lb = label('water spray', 34); lb.position.set(-4.2, 0.9, 3); lb.scale.set(3.2, 1.2, 1); sprayGroup.add(lb);
    sprayGroup.visible = false; scene.add(sprayGroup);
  }

  /** Second, identical cooler on standby (simplified): swapped in while the other is cleaned. */
  function buildSpare() {
    spareGroup = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7785, roughness: 0.7, metalness: 0.3 });
    const bt = finTexture(); bt.repeat.set(1, 18);
    const bmat = new THREE.MeshStandardMaterial({ color: 0xc3cad1, map: bt, roughness: 0.6 });
    const bh = topY - Y0;
    for (let b = 0; b < BUNDLES; b++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(L, bh, W), bmat); m.position.set(0, Y0 + bh / 2, bundleZ(b)); spareGroup.add(m);
    }
    for (const sx of [-1, 1]) for (let k = 0; k <= 3; k++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.25, Y0, 0.25), steel);
      col.position.set(sx * (L + 0.6) / 2, Y0 / 2, -FW / 2 + k * FW / 3); spareGroup.add(col);
    }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.55, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a5663, side: THREE.DoubleSide }));
    ring.position.y = FAN_Y; spareGroup.add(ring);
    const pg = new THREE.BoxGeometry(L, Y0 - FAN_Y - 0.25, FW - 0.6);
    const pl = new THREE.Mesh(pg, glassMat(0x9aa7b4, 0.12)); pl.position.y = FAN_Y + 0.25 + (Y0 - FAN_Y - 0.25) / 2; spareGroup.add(pl);
    const lb = label('standby unit', 40); lb.position.set(0, topY + 1.4, 0); lb.scale.set(3.6, 1.35, 1); spareGroup.add(lb);
    spareGroup.userData.label = lb;
    spareGroup.position.z = -SPARE_DZ; spareGroup.visible = false; scene.add(spareGroup);
  }

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
    o.apply = apply;
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
    const g = c.getContext('2d'); g.font = `600 ${size || 56}px system-ui, sans-serif`;
    // pill behind the text: readable on light and dark backgrounds
    const w = Math.min(248, g.measureText(text).width + 28), h = (size || 56) * 1.25;
    g.fillStyle = 'rgba(255,255,255,0.82)';
    g.beginPath(); g.roundRect ? g.roundRect(128 - w / 2, 48 - h / 2, w, h, h / 2) : g.rect(128 - w / 2, 48 - h / 2, w, h); g.fill();
    g.fillStyle = '#17202a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48);
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
    groundGrid = new THREE.GridHelper(90, 45, 0xc5ccd3, 0xdde2e8); scene.add(groundGrid);

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

    // fans (forced draft, underneath) — rebuilt when the number or size changes
    fanGroup = new THREE.Group(); scene.add(fanGroup);
    for (let sec = 0; sec < 3; sec++) {
      const lb = label('Section ' + 'ABC'[sec]); lb.position.set(L / 2 + 1.6, topY + 0.6, (sec - 1) * (2 * W + 2 * GAP)); scene.add(lb);
    }
    const gl = label('gas in, top row', 34); gl.position.set(-L / 2 - 0.4, topY + 1.4, bundleZ(0)); gl.scale.set(3.2, 1.2, 1); scene.add(gl);

    buildHood(); buildCage(); buildFilters(); buildSpray(); buildSpare();

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
      let out = y > top;
      if (state.hood && y > topY) {
        // turn 90° under the hood and leave through the side outlet (+x)
        const k = Math.min(1, (y - topY) / (HOOD_H * 0.55));
        pa.array[i * 3] += dt * vBase * 1.6 * k;
        y += dt * vBase * (1 - k) * 1.2;
        out = pa.array[i * 3] > L / 2 + 3.5;
      } else y += dt * vBase * (inBundle ? 1.9 : 1);
      if (out || state.speed < 0.02 && y > top - 0.1) {
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
    if (state.mistOn) {
      const mp = mist.geometry.attributes.position;
      for (let i = 0; i < mp.count; i++) {
        let y = mp.array[i * 3 + 1] + dt * (0.8 + state.speed * 0.6);
        if (y > FAN_Y - 0.2) y = 0.7;
        mp.array[i * 3 + 1] = y;
      }
      mp.needsUpdate = true;
    }
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

  /** Light or dark page: ground grid and cage mesh colours. */
  S3.setTheme = function (dark) {
    if (!built) return;
    // rebuild the ground grid in the theme's colours
    scene.remove(groundGrid); groundGrid.geometry.dispose();
    groundGrid = dark ? new THREE.GridHelper(90, 45, 0x3a4652, 0x252f39) : new THREE.GridHelper(90, 45, 0xc5ccd3, 0xdde2e8);
    scene.add(groundGrid);
    cageMats.forEach(m => m.color.set(dark ? 0xa9b6c3 : 0x6b7785));
  };

  /** Update visuals from a model result. */
  S3.update = function (res) {
    if (!built) return;
    const p = res.params, N = res.field.N;
    // fixed colour scale so that cases can be compared by eye
    state.tmin = Math.min(-5, p.Tamb); state.tmax = 170; state.tamb = res.airflow.Tin;
    state.field = res.field; state.fan = p.fanPct / 100;
    state.speed = 0.15 + Math.max(0.0, res.airflow.faceV) * 1.6;

    // hardware of the solutions
    const fk = p.nFans + '|' + p.fanD;
    if (fk !== fanKey) { fanKey = fk; buildFans(p.nFans, p.fanD); sizeFilters(p.fanD); }
    hoodGroup.visible = !!p.hood; state.hood = !!p.hood;
    cageGroup.visible = !!p.cage;
    filterGroup.visible = !!p.filters;
    sprayGroup.visible = !!p.spray || !!p.sprayIdle;
    state.mistOn = res.sprayWater > 0; mist.visible = state.mistOn;
    if (spareGroup.visible !== !!p.spare) {
      spareGroup.visible = !!p.spare;
      // frame both units, or just the main one
      ctl.target.set(0, 4.6, p.spare ? -SPARE_DZ / 2 : 0); ctl.r = p.spare ? 50 : 30; ctl.apply();
    }
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
