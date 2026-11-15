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
  let casingGroup, casingMats = [], plenMat = null, casingSolid = false, hoodKey = '', groundGrid, cageMats = [], fanGroup, fanKey = '', hoodGroup, cageGroup, filterGroup, sprayGroup, mist, spareGroup;
  let state = { fanX: [0], fan: 0.88, speed: 1.5, field: null, tmin: 0, tmax: 170, airOut: null, coilOn: false, hood: false, mistOn: false, tamb: 7, hoodH: 5, hoodOver: 2.5, dark: false };
  const FAN_Y = 2.35;                      // fan impeller plane (drawing: motor platform EL+17300, 2.1 m above the base)
  let running = false, built = false;

  const L = 10.5, W = 3.0, ROWS = 6, BUNDLES = 1, GAP = 0.35;   // ONE bundle 10.5 × 3.0 m, 6 rows (drawing VP-3212-A-1401-0001/-0010)
  const VS = 4.5;                          // vertical exaggeration of the bundle depth
  const Y0 = 4.0;                          // underside of the bundle (drawing: outlet nozzle 4.0 m above the base)
  const TPR = 46, PT = W / TPR, PL = PT * Math.sqrt(3) / 2 * VS, RAD = 0.0285;
  const SEGS = 16;
  const bundleZ = () => 0;
  const rowY = r => Y0 + 0.08 + r * PL;
  const topY = rowY(ROWS - 1) + 0.08;
  const FW = 3.4;                           // frame width (drawing: columns 3.2 m apart)
  const fanXs = n => Array.from({ length: n }, (_, i) => -L / 2 + L * (i + 0.5) / n);   // fans in a row along the tubes (drawing: 3 fans)
  const steelMat = () => new THREE.MeshStandardMaterial({ color: 0x6b7785, roughness: 0.7, metalness: 0.3 });
  function rod(a, b, r, mat) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
  }
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
    const steel = steelMat(), xs = fanXs(n);
    plenMat = glassMat(0xa9b3bd, 0.22); applyCasing();
    const bw = L / n, yT = Y0 - 0.02, yB = FAN_Y + 0.3, b = (D + 0.5) / 2, ax = bw / 2 + 0.02, az = W / 2 + 0.05;
    // pyramid hopper (rectangle under the bundle section → square round the fan ring), one per fan
    const T = [[-ax, yT, -az], [ax, yT, -az], [ax, yT, az], [-ax, yT, az]], B = [[-b, yB, -b], [b, yB, -b], [b, yB, b], [-b, yB, b]];
    const verts = [], idx = [];
    [...T, ...B].forEach(v => verts.push(...v));
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, j, 4 + j, i, 4 + j, 4 + i); }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); hg.setIndex(idx); hg.computeVertexNormals();
    // platform for the motors: a beam across the cooler under each fan, hung from the frame and braced from the column bases
    const yP = FAN_Y - 1.25;
    for (const x of xs) {
      const hm = new THREE.Mesh(hg, plenMat); hm.position.x = x; fanGroup.add(hm);
      const he = edgeLine(hg, 0x6b7785); he.position.x = x; fanGroup.add(he);
      const g = new THREE.Group(); g.position.set(x, FAN_Y, 0);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.08, D / 2 + 0.08, 0.6, 48, 1, true), ringMat));
      const rot = new THREE.Group();
      rot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.35, 16), ringMat));
      const nb = 4;                                                  // drawing: 4 blades
      for (let k = 0; k < nb; k++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(D / 2 - 0.2, 0.04, 0.36), bladeMat);
        bl.position.x = (D / 2 - 0.2) / 2 + 0.15; bl.rotation.x = 0.35;
        const arm = new THREE.Group(); arm.rotation.y = k * 2 * Math.PI / nb; arm.add(bl); rot.add(arm);
      }
      g.add(rot); fans.push(rot);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.75, 16), ringMat); motor.position.y = -0.7; g.add(motor);
      fanGroup.add(g);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, FW - 0.2), steel); beam.position.set(x, yP, 0); fanGroup.add(beam);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), ringMat); sh.position.set(x, yP + 0.35, 0); fanGroup.add(sh);   // motor support
      for (const sz of [-1, 1]) fanGroup.add(rod(new THREE.Vector3(x, yP, sz * 1.6), new THREE.Vector3(x, Y0 - 0.12, sz * 1.6), 0.04, steel));   // hanger to the frame
    }
    // V-braces (as on the drawing): from every column base up to the motor platforms next to it
    const cols = [-L / 2 - 0.15, 0, L / 2 + 0.15];
    for (const cx of cols) for (const sz of [-1, 1]) for (const x of xs) {
      if (Math.abs(x - cx) < 4.6 && Math.abs(x - cx) > 0.2) fanGroup.add(rod(new THREE.Vector3(cx, 0.25, sz * 1.6), new THREE.Vector3(x, yP, sz * 1.6), 0.045, steel));
    }
  }

  /** Hood: rises from the top row and turns 90° with a round fillet to a side outlet on the long side (+z),
   *  so rain, dust and insects cannot fall in from above. H = height above the top row
   *  (= outlet height); the roof is carried `over` metres past the bundle end. */
  /** Curved end wall with aerodynamic slots: canvas texture with rounded slots cut out (alpha). */
  let slotTex = null;
  function slotTexture() {
    if (slotTex) return slotTex;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#8fa6bd'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#4a5663'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y] of [[14, 20], [14, 84]]) { rr(x, y, 100, 26, 13); g.fill(); }  // two staggered rows of long rounded slots
    slotTex = new THREE.CanvasTexture(c); slotTex.wrapS = slotTex.wrapT = THREE.RepeatWrapping;
    return slotTex;
  }
  function buildHood(H, over) {
    clear(hoodGroup);
    // built in a local frame (local x = across the bundle, local z = along the tubes) and turned
    // so the open side face is on the long side of the cooler (+z), along the whole tube length
    hoodGroup.rotation.y = -Math.PI / 2;
    const x0 = -FW / 2, x1 = W / 2 + 0.4, y0 = topY + 0.05, t = 0.08;
    const R = Math.min(0.8 * H, x1 - x0), xe = x1 + over, depth = L + 0.4;
    const V = (x, y) => new THREE.Vector2(x, y);
    // curved end wall: vertical part, then a quarter round up to the roof. It is a separate,
    // slotted surface (air leaves through the slots as well as through the open side face).
    const cx = x0 + R, cy = y0 + H - R, path = [V(x0, y0), V(x0, cy)];
    for (let a = 1; a <= 24; a++) { const th = Math.PI - a * Math.PI / 2 / 24; path.push(V(cx + R * Math.cos(th), cy + R * Math.sin(th))); }
    const pos = [], uv = [], idx = []; let sl = 0;
    path.forEach((q, i) => {
      if (i) sl += Math.hypot(q.x - path[i - 1].x, q.y - path[i - 1].y);
      pos.push(q.x, q.y, -depth / 2, q.x, q.y, depth / 2);
      uv.push(0, sl / 1.8, depth / 1.8, sl / 1.8);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wg.setIndex(idx); wg.computeVertexNormals();
    hoodGroup.add(new THREE.Mesh(wg, glassMat(0x9fb3c8, 0.62)));
    // roof: flat from the end of the curved wall to the roof edge (no lip, so nothing hangs into the outlet flow)
    const roof = new THREE.Shape([V(x0 + R, y0 + H), V(xe, y0 + H), V(xe, y0 + H - t), V(x0 + R, y0 + H - t)]);
    const sg = new THREE.ExtrudeGeometry(roof, { depth, bevelEnabled: false });
    sg.translate(0, 0, -depth / 2);
    hoodGroup.add(new THREE.Mesh(sg, glassMat(0x9fb3c8, 0.62)), edgeLine(sg, 0x4a5663));
    // side cheeks (closed ends): curved outline, roof, and the slanted open face back to the bundle end
    const cheek = new THREE.Shape([...path, V(xe, y0 + H), V(x1, y0)]);
    for (const z of [-depth / 2, depth / 2]) {
      const cg = new THREE.ShapeGeometry(cheek); cg.translate(0, 0, z);
      hoodGroup.add(new THREE.Mesh(cg, glassMat(0x9fb3c8, 0.38)), edgeLine(cg, 0x4a5663));
    }
    const lb = label('curved hood end', 34); lb.scale.set(3.4, 1.3, 1); lb.position.set(x0 + 1.5, y0 + H + 0.9, 0); hoodGroup.add(lb);
  }
  const clear = g => { while (g.children.length) g.remove(g.children[0]); };

  function gridTexture(cell, line, color) {
    const c = document.createElement('canvas'); c.width = c.height = cell;
    const g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = line;
    g.strokeRect(line / 2, line / 2, cell - line, cell - line);
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
  }

  /** Mesh screen closing the open side face of the hood: a tilted panel from the bundle end up to
   *  the roof edge, so the whole opening, bottom included, is screened. */
  function buildCage(H, over) {
    clear(cageGroup); cageMats = [];
    cageGroup.rotation.y = -Math.PI / 2;                 // same local frame as the hood: open face on the long side
    const x1 = W / 2 + 0.4, xe = x1 + over, y0 = topY + 0.05, yt = y0 + H;
    const dx = xe - x1, dy = yt - y0, len = Math.hypot(dx, dy), depth = L + 0.4;
    const tx = gridTexture(64, 7, '#ffffff'); tx.repeat.set(len / 0.4, depth / 0.4);
    const mat = new THREE.MeshBasicMaterial({ map: tx, color: state.dark ? 0xc3ced8 : 0x4a5663, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 });
    cageMats.push(mat);
    const geo = () => { const g = new THREE.PlaneGeometry(len, depth); g.rotateX(Math.PI / 2); g.rotateZ(Math.atan2(dy, dx)); g.translate((x1 + xe) / 2, (y0 + yt) / 2, 0); return g; };
    cageGroup.add(new THREE.Mesh(geo(), mat), edgeLine(geo(), 0x4a5663));
    const lb = label('outlet screen', 34); lb.scale.set(3.4, 1.3, 1); lb.position.set(xe + 1.0, yt + 0.6, 2); cageGroup.add(lb);
  }

  /** Intake screens (as in the photo): black mesh fabric panels stretched on a frame round the whole
   *  under-structure, with a horizontal seam band, vertical corner trims with rivets and a black skirt. */
  let screenGroup, screenMats = [];
  function meshTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = 'rgba(14,17,20,0.50)'; g.fillRect(0, 0, 128, 128);                  // fabric
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
    for (let i = 0; i < 128; i += 4) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 128); g.moveTo(0, i + 0.5); g.lineTo(128, i + 0.5); g.stroke(); }
    g.strokeStyle = 'rgba(70,78,86,0.95)'; g.lineWidth = 3;                               // welded wire grid behind the fabric
    g.strokeRect(1, 1, 126, 126);
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
  }
  function sizeScreens() {
    if (!screenGroup) { screenGroup = new THREE.Group(); screenGroup.visible = false; scene.add(screenGroup); }
    clear(screenGroup); screenMats = [];
    const fl = L + 0.6, h = Y0 - 0.05, y = 0.05 + h / 2;
    const blk = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.8, metalness: 0.1 });
    const rivet = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.4, metalness: 0.7 });
    const side = (w, px, pz, ry) => {
      const grp = new THREE.Group(); grp.position.set(px, 0, pz); grp.rotation.y = ry;
      const tx = meshTexture(); tx.repeat.set(w / 0.9, h / 0.9);
      const m = new THREE.MeshBasicMaterial({ map: tx, transparent: true, side: THREE.DoubleSide, depthWrite: false }); screenMats.push(m);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); pl.position.y = y; grp.add(pl);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.07), blk); band.position.y = 0.05 + h * 0.58; grp.add(band);      // horizontal seam
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.32, 0.16), blk); skirt.position.y = 0.2; grp.add(skirt);          // black skirt
      const nSeam = Math.max(1, Math.round(w / 6));
      for (let i = 0; i <= nSeam; i++) {                                                                                                // vertical seam strips with rivets
        const x = -w / 2 + i * w / nSeam, st = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.07), blk); st.position.set(x, y, 0); grp.add(st);
        for (let k = 0; k < 7; k++) { const rv = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), rivet); rv.position.set(x + 0.09, 0.9 + k * 0.62, 0.05); grp.add(rv); }
      }
      screenGroup.add(grp);
    };
    side(FW, -fl / 2, 0, Math.PI / 2); side(FW, fl / 2, 0, Math.PI / 2); side(fl, 0, -FW / 2, 0); side(fl, 0, FW / 2, 0);
    const lb = label('intake screens', 36); lb.scale.set(3.6, 1.35, 1); lb.position.set(fl / 2 + 1.5, 2.2, FW / 2); screenGroup.add(lb);
  }

  /** Compressed-air cleaning robot: a rail-mounted bridge travels along the cooler, a carriage runs
   *  across it and a nozzle head blows compressed air straight down onto the tubes. An air receiver
   *  and compressor stand beside the cooler and feed the head through a hose. */
  let blastGroup, blastPts = null, blastBridge, blastCart, blastHose, blastT = 0;
  const NBL = 900, RAILY = () => topY + 0.9;
  function buildBlast() {
    blastGroup = new THREE.Group(); blastGroup.visible = false; scene.add(blastGroup);
    const orange = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.5, metalness: 0.3 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x5b6672, roughness: 0.6, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e3640, roughness: 0.6, metalness: 0.4 });
    const ry = RAILY(), rz = FW / 2 + 0.5, rl = L + 3;
    for (const sz of [-1, 1]) {                                  // two rails along x, on posts
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rl, 0.14, 0.2), grey); rail.position.set(0, ry, sz * rz); blastGroup.add(rail);
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, ry, 0.2), grey); post.position.set(sx * rl / 2, ry / 2, sz * rz); blastGroup.add(post); }
    }
    // bridge across the cooler (z) with wheels on the rails
    blastBridge = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 2 * rz + 0.6), orange); beam.position.y = 0.3; blastBridge.add(beam);
    for (const sz of [-1, 1]) for (const dx of [-0.35, 0.35]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 14), dark); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.05, sz * rz); blastBridge.add(w);
    }
    // carriage with the nozzle head
    blastCart = new THREE.Group();
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.9), dark); car.position.y = 0.3; blastCart.add(car);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 10), grey); arm.position.y = -0.3; blastCart.add(arm);
    const nz = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), orange); nz.rotation.x = Math.PI; nz.position.y = -0.95; blastCart.add(nz);
    blastBridge.add(blastCart); blastGroup.add(blastBridge);
    // air receiver + compressor beside the cooler
    const px = -L / 2 - 3.4, pz = 2.5;
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x8794a1, roughness: 0.45, metalness: 0.4 });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 20), tankMat); pot.position.set(px, 1.1, pz); blastGroup.add(pot);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.7, 20), tankMat); cone.rotation.x = Math.PI; cone.position.set(px, 0.35, pz); blastGroup.add(cone);
    const comp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 1.2), grey); comp.position.set(px - 2.2, 0.75, pz); blastGroup.add(comp);
    const lb = label('air robot', 36); lb.scale.set(3.4, 1.3, 1); lb.position.set(0, ry + 2.0, rz + 0.5); blastGroup.add(lb);
    const lb2 = label('air receiver', 34); lb2.scale.set(3.2, 1.2, 1); lb2.position.set(px, 3.0, pz); blastGroup.add(lb2);
    blastHose = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xd9822b }));
    blastHose.userData.from = new THREE.Vector3(px, 1.8, pz);
    blastGroup.add(blastHose);
    const pos = new Float32Array(NBL * 3), vel = new Float32Array(NBL * 3), age = new Float32Array(NBL).fill(0.6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    blastPts = { pos, vel, age, obj: new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8f1f8, size: 0.2, transparent: true, opacity: 0.6, depthWrite: false })) };
    blastGroup.add(blastPts.obj);
  }
  function tickBlast(dt) {
    blastT += dt;
    const tri = x => Math.abs(((x % 2) + 2) % 2 - 1);                       // 0..1..0
    const rz = FW / 2 + 0.5, ry = RAILY();
    const bx = Math.sin(blastT * 0.35) * (L / 2 - 0.6);                     // bridge along x
    const cz = (tri(blastT * 0.22) - 0.5) * (FW - 1.5);                    // carriage across z
    blastBridge.position.set(bx, ry, 0); blastCart.position.set(0, 0, cz);
    const lx = bx, lz = cz, ly = ry - 1.2;                                  // nozzle tip
    const a = blastHose.userData.from, hp = blastHose.geometry.attributes.position, top = new THREE.Vector3(lx, ry + 0.6, lz);
    for (let i = 0; i < 24; i++) { const u = i / 23;
      hp.setXYZ(i, a.x + (top.x - a.x) * u, a.y + (top.y - a.y) * u - 2.2 * Math.sin(Math.PI * u) * (1 - 0.4 * u), a.z + (top.z - a.z) * u); }
    hp.needsUpdate = true;
    const { pos, vel, age, obj } = blastPts, pa = obj.geometry.attributes.position;
    for (let i = 0; i < NBL; i++) {
      age[i] += dt;
      if (age[i] > 0.4) {                                                    // blown out of the nozzle, narrow fast air jet
        age[i] = Math.random() * 0.05;
        const sp = 12 + Math.random() * 6, ang = Math.random() * Math.PI * 2, spread = Math.random() * 0.22;
        pos[i * 3] = lx; pos[i * 3 + 1] = ly; pos[i * 3 + 2] = lz;
        vel[i * 3] = sp * spread * Math.cos(ang); vel[i * 3 + 1] = -sp; vel[i * 3 + 2] = sp * spread * Math.sin(ang);
      }
      for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
      if (pos[i * 3 + 1] < topY + 0.1) { vel[i * 3 + 1] *= -0.12; vel[i * 3] *= 1.8; vel[i * 3 + 2] *= 1.8; pos[i * 3 + 1] = topY + 0.12; age[i] += 0.2; }
    }
    pa.needsUpdate = true;
  }

  /** Filter house around the fan inlet: pleated panels (not used by the three solutions; kept for experiments). */
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
    filterGroup.add(m, e);
  }

  /** Vent ducts: from the upper edge of each pyramid hopper, up the outside of the bundle and under
   *  the hood to the open edge of the hood, so part of the air can leave straight to the outside.
   *  Visual only: not in the flow model. */
  let ventGroup;
  function buildVents() {
    ventGroup = new THREE.Group(); ventGroup.visible = false; scene.add(ventGroup);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.5, metalness: 0.3 });
    const xs = fanXs(3), zv = W / 2 + 0.4, x1 = L / 2 + 0.4, sz = 0.32;
    const box = (x0, y0, z0, x1_, y1, z1) => { const g = new THREE.BoxGeometry(Math.abs(x1_ - x0) + sz, Math.abs(y1 - y0) + sz, Math.abs(z1 - z0) + sz);
      const m = new THREE.Mesh(g, mat); m.position.set((x0 + x1_) / 2, (y0 + y1) / 2, (z0 + z1) / 2); ventGroup.add(m); ventGroup.add(edgeLine(g, 0x7a4a14)).position.copy(m.position); };
    xs.forEach((fx, i) => {
      const yh = topY + 1.15 - i * 0.42;                                   // staggered heights so the ducts do not cross
      box(fx, Y0 - 0.35, W / 2 + 0.05, fx, Y0 - 0.35, zv);                 // out of the hopper edge
      box(fx, Y0 - 0.35, zv, fx, yh, zv);                                  // up along the bundle side
      box(fx, yh, zv, fx, yh, zv + 0.9);                                   // under the hood towards its open long side
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 4), mat); cone.rotation.x = Math.PI / 2; cone.rotation.y = Math.PI / 4; cone.position.set(fx, yh, zv + 1.2); ventGroup.add(cone);
    });
    const lb = label('vent ducts (not modelled)', 30); lb.scale.set(3.6, 1.0, 1); lb.position.set(0, topY + 2.0, zv + 0.4); ventGroup.add(lb);
  }

  /** Water spray: nozzles round the air inlet throw droplets into the air drawn by the fan. */
  const NDROP = 2800;
  let drops = null;
  function buildSpray() {
    sprayGroup = new THREE.Group(); sprayGroup.visible = false; scene.add(sprayGroup);
  }
  function sizeSpray() {
    clear(sprayGroup);
    const yN = Y0 - 0.32, zE = W / 2 + 0.1, NN = 15;
    const nm = new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.4, metalness: 0.5 });
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2a86c9, roughness: 0.45, metalness: 0.4 });
    const hz = (len, x, y, z) => { const g = new THREE.CylinderGeometry(0.05, 0.05, len, 8); g.rotateZ(Math.PI / 2); const m = new THREE.Mesh(g, pipeMat); m.position.set(x, y, z); sprayGroup.add(m); };
    const noz = [];
    for (const sz of [-1, 1]) {
      hz(L, 0, yN - 0.08, sz * zE);                                      // spray header along the bottom edge of the tubes
      for (let k = 0; k < NN; k++) {
        const x = -L / 2 + (k + 0.5) * L / NN;
        const nn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.2, 8), nm); nn.position.set(x, yN, sz * zE); sprayGroup.add(nn);
        noz.push([x, sz * zE, -sz]);
      }
    }
    // feed pipes round the outside to the pump and the water tank
    const px = -L / 2 - 3.2, pz = W / 2 + 2.6;
    const vp = (a, b) => sprayGroup.add(rod(new THREE.Vector3(...a), new THREE.Vector3(...b), 0.05, pipeMat));
    vp([-L / 2 - 0.6, yN - 0.08, -zE], [-L / 2 - 0.6, yN - 0.08, zE]);   // cross pipe joining both edge headers
    vp([-L / 2, yN - 0.08, -zE], [-L / 2 - 0.6, yN - 0.08, -zE]); vp([-L / 2, yN - 0.08, zE], [-L / 2 - 0.6, yN - 0.08, zE]);
    vp([-L / 2 - 0.6, yN - 0.08, zE], [-L / 2 - 0.6, 0.9, zE + 0.6]); vp([-L / 2 - 0.6, 0.9, zE + 0.6], [px + 0.9, 0.9, pz]);
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 2.6), new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.8 })); base.position.set(px, 0.06, pz); sprayGroup.add(base);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 28), new THREE.MeshStandardMaterial({ color: 0x9ec9ea, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.92 }));
    tank.position.set(px - 1.2, 0.87, pz); sprayGroup.add(tank);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.5, metalness: 0.4 })); pump.position.set(px + 0.9, 0.4, pz); sprayGroup.add(pump);
    const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x4a5663, roughness: 0.6 })); mot.rotation.z = Math.PI / 2; mot.position.set(px + 0.2, 0.4, pz); sprayGroup.add(mot);
    vp([px - 0.5, 0.45, pz], [px + 0.4, 0.45, pz]);
    const pos = new Float32Array(NDROP * 3), vel = new Float32Array(NDROP * 3), age = new Float32Array(NDROP);
    drops = { pos, vel, age, noz, yN };
    for (let i = 0; i < NDROP; i++) spawnDrop(i, Math.random() * 0.6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mist = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x6cc6ff, size: 0.16, transparent: true, opacity: 0.95, depthWrite: false }));
    mist.visible = state.mistOn;
    sprayGroup.add(mist);
    const lb = label('pump + tank', 34); lb.scale.set(3.2, 1.2, 1); lb.position.set(px, 2.5, pz); sprayGroup.add(lb);
    const lb2 = label('summer spray', 34); lb2.scale.set(3.2, 1.2, 1); lb2.position.set(0, yN - 1.0, W / 2 + 1.0); sprayGroup.add(lb2);
  }
  function spawnDrop(i, a0) {
    const d = drops, n = d.noz[i % d.noz.length], sp = 0.9 + Math.random() * 0.9;
    d.pos[i * 3] = n[0]; d.pos[i * 3 + 1] = d.yN + 0.1; d.pos[i * 3 + 2] = n[1];
    // jet from the edge nozzle inward across the underside of the bottom row, fanned out along the tube
    d.vel[i * 3] = (Math.random() - 0.5) * 0.9; d.vel[i * 3 + 1] = 1.4 + Math.random() * 1.0; d.vel[i * 3 + 2] = n[2] * sp;
    d.age[i] = a0 || 0;
    if (a0) { for (let k = 0; k < 3; k++) d.pos[i * 3 + k] += d.vel[i * 3 + k] * a0; d.pos[i * 3 + 1] -= 0.5 * a0 * a0; }
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
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.55, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a5663, side: THREE.DoubleSide }));
    ring.position.y = FAN_Y; spareGroup.add(ring);
    const pg = new THREE.BoxGeometry(L, Y0 - FAN_Y - 0.25, FW - 0.6);
    const pl = new THREE.Mesh(pg, glassMat(0x9aa7b4, 0.12)); pl.position.y = FAN_Y + 0.25 + (Y0 - FAN_Y - 0.25) / 2; spareGroup.add(pl);
    const lb = label('standby unit', 40); lb.position.set(0, topY + 1.4, 0); lb.scale.set(3.6, 1.35, 1); spareGroup.add(lb);
    spareGroup.userData.label = lb;
    spareGroup.position.z = -SPARE_DZ; spareGroup.visible = false; scene.add(spareGroup);
  }

  /* ---------------- orbit controls (minimal, mouse + touch) ---------------- */
  function Orbit(cam, el) {
    const o = { theta: -1.05, phi: 1.25, r: 33, target: new THREE.Vector3(0.8, 5.6, 0) };
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
    ctl.target.set(0.5, 3.4, 0); ctl.r = 25; ctl.apply();
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0c8, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-12, 25, 18); scene.add(sun);

    // ground
    groundGrid = new THREE.GridHelper(90, 45, 0xc5ccd3, 0xdde2e8); scene.add(groundGrid);

    const steel = steelMat();
    const colX = [-L / 2 - 0.15, 0, L / 2 + 0.15], colZ = [-1.6, 1.6];
    for (const cx of colX) for (const cz of colZ) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.28, Y0, 0.28), steel); col.position.set(cx, Y0 / 2, cz); scene.add(col);
      const bp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), steel); bp.position.set(cx, 0.04, cz); scene.add(bp);
    }
    const bmL = new THREE.BoxGeometry(L + 0.9, 0.22, 0.22), bmW = new THREE.BoxGeometry(0.22, 0.22, 3.2);
    for (const z of colZ) { const b = new THREE.Mesh(bmL, steel); b.position.set(0, Y0 - 0.12, z); scene.add(b); }
    for (const x of colX) { const b = new THREE.Mesh(bmW, steel); b.position.set(x, Y0 - 0.12, 0); scene.add(b); }
    for (const z of colZ) for (let k = 0; k < 2; k++) {              // X-bracing in the side frames
      scene.add(rod(new THREE.Vector3(colX[k], 0.3, z), new THREE.Vector3(colX[k + 1], Y0 - 0.3, z), 0.045, steel));
      scene.add(rod(new THREE.Vector3(colX[k + 1], 0.3, z), new THREE.Vector3(colX[k], Y0 - 0.3, z), 0.045, steel));
    }
    // headers (tube-side boxes) at both ends of every bundle, with rows of plugs on the outer face
    const hdrMat = new THREE.MeshStandardMaterial({ color: 0x8794a1, roughness: 0.5, metalness: 0.4 });
    for (let b = 0; b < BUNDLES; b++) for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, topY - Y0 + 0.1, W), hdrMat);
      h.position.set(sx * (L / 2 + 0.15), (Y0 + topY) / 2, bundleZ(b)); scene.add(h);
    }
    {
      const plugGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6); plugGeo.rotateZ(Math.PI / 2);
      const plugs = new THREE.InstancedMesh(plugGeo, new THREE.MeshStandardMaterial({ color: 0xa9b3bd, roughness: 0.45, metalness: 0.6 }), BUNDLES * 2 * ROWS * TPR);
      const dm = new THREE.Object3D(); let n = 0;
      for (let b = 0; b < BUNDLES; b++) for (const sx of [-1, 1]) for (let r = 0; r < ROWS; r++) for (let t = 0; t < TPR; t++) {
        dm.position.set(sx * (L / 2 + 0.34), rowY(r), bundleZ(b) - W / 2 + (t + (r % 2 ? 1 : 0.5) + 0.0) * PT); dm.updateMatrix(); plugs.setMatrixAt(n++, dm.matrix);
      }
      scene.add(plugs);
    }
    // gas path (drawing): 2 inlet nozzles on top of the left header (top pass), 2 outlet nozzles
    // pointing down from the lower chamber of the same header, 1500 mm apart; 2 passes (3 rows each).
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0xaeb8c2, roughness: 0.4, metalness: 0.6 });
    const pipe = (r, len, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), hdrMat); m.position.set(x, y, z); scene.add(m); return m; };
    const xn = -L / 2 - 0.15;
    for (const zz of [-0.75, 0.75]) {
      pipe(0.24, 0.9, xn, topY + 0.1 + 0.45, zz);                                      // inlet nozzle (up)
      const fi = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28), flangeMat); fi.position.set(xn, topY + 1.05, zz); scene.add(fi);
      pipe(0.24, 1.1, xn, Y0 - 0.55, zz);                                              // outlet nozzle (down)
      const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28), flangeMat); fo.position.set(xn, Y0 - 1.1, zz); scene.add(fo);
    }
    // header divider (drawing: inlet chamber above, outlet chamber below) and return header on the right
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, W), new THREE.MeshStandardMaterial({ color: 0x3d4852 })); div.position.set(xn, (rowY(ROWS - 4) + rowY(ROWS - 3)) / 2, 0); scene.add(div);
    // pass arrows on the front face: pass 1 → (top 3 rows), pass 2 ← (bottom 3 rows)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xe8590c });
    const zf = W / 2 + 0.3;
    [[0, 1], [1, -1]].forEach(([k, dir]) => {
      const y = (rowY(ROWS - 1 - 3 * k) + rowY(ROWS - 3 - 3 * k)) / 2;
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 8), arrowMat); sh.rotation.z = Math.PI / 2; sh.position.set(0, y, zf); scene.add(sh);
      const hd = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 12), arrowMat); hd.rotation.z = -dir * Math.PI / 2; hd.position.set(dir * 2.3, y, zf); scene.add(hd);
      const pl = label('pass ' + (k + 1), 30); pl.scale.set(2.2, 0.85, 1); pl.position.set(-dir * 3.4, y, zf + 0.2); scene.add(pl);
    });

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
    const gl = label('gas in', 34); gl.position.set(-L / 2 - 0.4, topY + 2.3, -1.5); gl.scale.set(2.4, 1.2, 1); scene.add(gl);
    const go = label('gas out', 34); go.position.set(-L / 2 - 1.2, Y0 - 1.9, 1.5); go.scale.set(2.6, 1.2, 1); scene.add(go);

    // casing: side plates of the bundle stack (the plenum is built with the fan)
    casingGroup = new THREE.Group(); scene.add(casingGroup);
    const zE = W / 2 + 0.15, ch = topY - Y0 + 0.3;
    for (const sz of [-1, 1]) {
      const mt = glassMat(0x8794a1, 0.15); casingMats.push(mt);
      const pg2 = new THREE.PlaneGeometry(L + 0.3, ch);
      const pm = new THREE.Mesh(pg2, mt); pm.position.set(0, Y0 + ch / 2 - 0.15, sz * zE); casingGroup.add(pm);
      const pe = edgeLine(pg2, 0x8794a1); pe.position.copy(pm.position); casingGroup.add(pe);
    }
    hoodGroup = new THREE.Group(); hoodGroup.visible = false; scene.add(hoodGroup);
    cageGroup = new THREE.Group(); cageGroup.visible = false; scene.add(cageGroup);
    buildFilters(); buildSpray(); buildSpare(); buildBlast(); buildVents();

    // air particles
    const NP = 1800;
    const pos = new Float32Array(NP * 3), col = new Float32Array(NP * 3);
    pdata = new Float32Array(NP * 2);   // [column index x (0..1), z]
    const zMin = -W / 2, zMax = W / 2;
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
        // turn 90° under the hood and leave through the side outlet on the long side (+z)
        const k = Math.min(1, (y - topY) / (state.hoodH * 0.55));
        pa.array[i * 3 + 2] += dt * vBase * 1.6 * k;
        y += dt * vBase * (1 - k) * 1.2;
        out = pa.array[i * 3 + 2] > W / 2 + 0.4 + state.hoodOver + 1.5;
      } else y += dt * vBase * (inBundle ? 1.9 : 1);
      if (out || state.speed < 0.02 && y > top - 0.1) {
        y = FAN_Y + Math.random() * 0.3;
        const fx = state.fanX, bw = L / fx.length;
        pa.array[i * 3] = fx[Math.floor(Math.random() * fx.length)] + (Math.random() - 0.5) * (bw - 0.4);
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
    if (state.blast && blastPts) tickBlast(dt);
    if (state.mistOn && drops) {
      const d = drops, mp = mist.geometry.attributes.position;
      const pull = 0.6 + state.speed * 1.5;                    // the air drawn up by the fans carries the droplets onto the tubes
      for (let i = 0; i < NDROP; i++) {
        d.age[i] += dt;
        d.vel[i * 3 + 1] += (0.45 * pull - 1.0) * dt;
        for (let k = 0; k < 3; k++) d.pos[i * 3 + k] += d.vel[i * 3 + k] * dt;
        if (d.age[i] > 1.4 || d.pos[i * 3 + 1] < 0.05 || d.pos[i * 3 + 1] > Y0 + 0.05) spawnDrop(i);
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

  /** Casing (bundle side plates + plenum): see-through for the simulation, or solid as built. */
  function applyCasing() {
    const all = plenMat ? [...casingMats, plenMat] : casingMats;
    all.forEach(m => {
      m.opacity = casingSolid ? 1 : (m === plenMat ? 0.16 : 0.15);
      m.transparent = !casingSolid; m.depthWrite = casingSolid;
      m.color.set(casingSolid ? 0x8a96a3 : 0x8794a1); m.needsUpdate = true;
    });
  }
  S3.setCasing = function (solid) { casingSolid = !!solid; if (built) applyCasing(); return casingSolid; };

  /** Light or dark page: ground grid and cage mesh colours. */
  S3.setTheme = function (dark) {
    if (!built) return;
    // rebuild the ground grid in the theme's colours
    scene.remove(groundGrid); groundGrid.geometry.dispose();
    groundGrid = dark ? new THREE.GridHelper(90, 45, 0x3a4652, 0x252f39) : new THREE.GridHelper(90, 45, 0xc5ccd3, 0xdde2e8);
    scene.add(groundGrid);
    state.dark = dark;
    cageMats.forEach(m => m.color.set(dark ? 0xc3ced8 : 0x4a5663));
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
    if (fk !== fanKey) { fanKey = fk; buildFans(p.nFans, p.fanD); sizeFilters(p.fanD); sizeSpray(); sizeScreens(); state.fanX = fanXs(p.nFans); }
    const hk = p.hoodH + '|' + p.hoodOverhang;
    if (hk !== hoodKey) { hoodKey = hk; state.hoodH = p.hoodH; state.hoodOver = p.hoodOverhang; buildHood(p.hoodH, p.hoodOverhang); buildCage(p.hoodH, p.hoodOverhang); }
    hoodGroup.visible = !!p.hood; state.hood = !!p.hood;
    cageGroup.visible = !!p.cage;
    filterGroup.visible = !!p.filters;
    ventGroup.visible = !!p.hood;
    screenGroup.visible = !!p.screens; blastGroup.visible = !!p.blast; state.blast = !!p.blast;
    sprayGroup.visible = !!p.spray || !!p.sprayIdle;
    state.mistOn = res.sprayWater > 0; if (mist) mist.visible = state.mistOn;
    if (spareGroup.visible !== !!p.spare) {
      spareGroup.visible = !!p.spare;
      // frame both units, or just the main one
      ctl.target.set(0.5, 3.4, p.spare ? -SPARE_DZ / 2 : 0); ctl.r = p.spare ? 45 : 25; ctl.apply();
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
