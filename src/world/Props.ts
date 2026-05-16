import * as THREE from "three";
import { sharedToonRamp } from "../render/ToonRamp";
import { addOutline } from "../render/Outline";

// ===========================================================================
// SHARED MODULE-LEVEL RESOURCES
// ---------------------------------------------------------------------------
// Every prop factory below reuses these cached geometries, materials and
// textures. A prop instance is just `new THREE.Mesh(SHARED_GEOM, SHARED_MAT)`
// with per-instance transforms. Nothing is allocated per call except the
// lightweight Group + Mesh wrappers.
// ===========================================================================

const _geoms = new Map<string, THREE.BufferGeometry>();
const _toonMats = new Map<string, THREE.MeshToonMaterial>();
const _basicMats = new Map<string, THREE.MeshBasicMaterial>();
const _textures = new Map<string, THREE.Texture>();

// --- Geometry cache --------------------------------------------------------
function box(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `b|${w}|${h}|${d}`;
  let g = _geoms.get(k) as THREE.BoxGeometry | undefined;
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    _geoms.set(k, g);
  }
  return g;
}

function cyl(
  rt: number,
  rb: number,
  h: number,
  seg = 8,
  hSeg = 1,
  open = false,
  thetaStart = 0,
  thetaLen = Math.PI * 2,
): THREE.CylinderGeometry {
  const k = `c|${rt}|${rb}|${h}|${seg}|${hSeg}|${open}|${thetaStart}|${thetaLen}`;
  let g = _geoms.get(k) as THREE.CylinderGeometry | undefined;
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, hSeg, open, thetaStart, thetaLen);
    _geoms.set(k, g);
  }
  return g;
}

function cone(r: number, h: number, seg = 8): THREE.ConeGeometry {
  const k = `co|${r}|${h}|${seg}`;
  let g = _geoms.get(k) as THREE.ConeGeometry | undefined;
  if (!g) {
    g = new THREE.ConeGeometry(r, h, seg);
    _geoms.set(k, g);
  }
  return g;
}

function sphere(r: number, ws = 8, hs = 6): THREE.SphereGeometry {
  const k = `s|${r}|${ws}|${hs}`;
  let g = _geoms.get(k) as THREE.SphereGeometry | undefined;
  if (!g) {
    g = new THREE.SphereGeometry(r, ws, hs);
    _geoms.set(k, g);
  }
  return g;
}

function plane(w: number, h: number): THREE.PlaneGeometry {
  const k = `p|${w}|${h}`;
  let g = _geoms.get(k) as THREE.PlaneGeometry | undefined;
  if (!g) {
    g = new THREE.PlaneGeometry(w, h);
    _geoms.set(k, g);
  }
  return g;
}

function circle(r: number, seg = 16): THREE.CircleGeometry {
  const k = `ci|${r}|${seg}`;
  let g = _geoms.get(k) as THREE.CircleGeometry | undefined;
  if (!g) {
    g = new THREE.CircleGeometry(r, seg);
    _geoms.set(k, g);
  }
  return g;
}

function ring(ri: number, ro: number, seg = 16): THREE.RingGeometry {
  const k = `r|${ri}|${ro}|${seg}`;
  let g = _geoms.get(k) as THREE.RingGeometry | undefined;
  if (!g) {
    g = new THREE.RingGeometry(ri, ro, seg);
    _geoms.set(k, g);
  }
  return g;
}

function torus(r: number, t: number, rs: number, ts: number, arc: number): THREE.TorusGeometry {
  const k = `t|${r}|${t}|${rs}|${ts}|${arc}`;
  let g = _geoms.get(k) as THREE.TorusGeometry | undefined;
  if (!g) {
    g = new THREE.TorusGeometry(r, t, rs, ts, arc);
    _geoms.set(k, g);
  }
  return g;
}

// --- Material cache --------------------------------------------------------
function toon(color: number, emissive = 0, emissiveIntensity = 0): THREE.MeshToonMaterial {
  const k = `${color}|${emissive}|${emissiveIntensity}`;
  let m = _toonMats.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      emissive,
      emissiveIntensity,
      gradientMap: sharedToonRamp(),
    });
    _toonMats.set(k, m);
  }
  return m;
}

function basic(color: number, opacity = 1): THREE.MeshBasicMaterial {
  const k = `${color}|${opacity}`;
  let m = _basicMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    _basicMats.set(k, m);
  }
  return m;
}

function texturedToon(tex: THREE.Texture, emissive = 0, emissiveIntensity = 0): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    map: tex,
    emissive,
    emissiveIntensity,
    gradientMap: sharedToonRamp(),
  });
}

// A textured basic material, cached by texture identity + tint + opacity.
function texturedBasic(
  key: string,
  tex: THREE.Texture,
  color = 0xffffff,
  opacity = 1,
): THREE.MeshBasicMaterial {
  const k = `tb|${key}|${color}|${opacity}`;
  let m = _basicMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: tex,
      color,
      transparent: opacity < 1 || tex.userData?.transparent === true,
      opacity,
    });
    _basicMats.set(k, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------
type CarVariant = "sedan" | "van" | "muscle" | "hatchback";

interface CarSpec {
  bodyW: number;
  bodyH: number;
  bodyL: number;
  roofW: number;
  roofH: number;
  roofL: number;
  roofZ: number;
  hoodL: number;
  trunkL: number;
  color: number;
  wheelR: number;
}

function carSpec(variant: CarVariant): CarSpec {
  switch (variant) {
    case "van":
      return {
        bodyW: 1.7, bodyH: 0.8, bodyL: 4.2,
        roofW: 1.65, roofH: 1.0, roofL: 3.2, roofZ: -0.2,
        hoodL: 0.8, trunkL: 0.1,
        color: 0xb04a2a, wheelR: 0.34,
      };
    case "muscle":
      return {
        bodyW: 1.85, bodyH: 0.55, bodyL: 4.6,
        roofW: 1.55, roofH: 0.45, roofL: 1.6, roofZ: -0.1,
        hoodL: 1.3, trunkL: 1.1,
        color: 0xc81f3a, wheelR: 0.38,
      };
    case "hatchback":
      return {
        bodyW: 1.65, bodyH: 0.65, bodyL: 3.4,
        roofW: 1.55, roofH: 0.55, roofL: 1.9, roofZ: -0.2,
        hoodL: 0.7, trunkL: 0.4,
        color: 0x2e8a55, wheelR: 0.3,
      };
    case "sedan":
    default:
      return {
        bodyW: 1.75, bodyH: 0.6, bodyL: 4.4,
        roofW: 1.6, roofH: 0.5, roofL: 2.0, roofZ: -0.1,
        hoodL: 1.1, trunkL: 0.9,
        color: 0x2a3aa8, wheelR: 0.33,
      };
  }
}

export function makeCar(variant: CarVariant = "sedan"): THREE.Object3D {
  const spec = carSpec(variant);
  const group = new THREE.Group();
  group.name = `car_${variant}`;

  // Main body
  const body = new THREE.Mesh(
    box(spec.bodyW, spec.bodyH, spec.bodyL),
    toon(spec.color, spec.color, 0.04),
  );
  body.position.y = spec.wheelR + spec.bodyH / 2;
  group.add(body);
  addOutline(body, 1.06); // outline only on the main body

  // Roof / cabin
  const roof = new THREE.Mesh(
    box(spec.roofW, spec.roofH, spec.roofL),
    toon(spec.color, spec.color, 0.02),
  );
  roof.position.y = body.position.y + spec.bodyH / 2 + spec.roofH / 2;
  roof.position.z = spec.roofZ;
  group.add(roof);

  // Hood / trunk subtle relief
  const hood = new THREE.Mesh(box(spec.bodyW * 0.95, 0.04, spec.hoodL), toon(spec.color));
  hood.position.set(0, body.position.y + spec.bodyH / 2 + 0.02, spec.bodyL / 2 - spec.hoodL / 2 - 0.05);
  group.add(hood);

  const trunk = new THREE.Mesh(box(spec.bodyW * 0.95, 0.04, spec.trunkL), toon(spec.color));
  trunk.position.set(0, body.position.y + spec.bodyH / 2 + 0.02, -spec.bodyL / 2 + spec.trunkL / 2 + 0.05);
  group.add(trunk);

  // Windows (shared canvas-textured glass)
  const glassMat = getGlassMat();

  const windshield = new THREE.Mesh(plane(spec.roofW * 0.95, spec.roofH * 0.9), glassMat);
  windshield.position.set(0, roof.position.y, spec.roofZ + spec.roofL / 2 + 0.01);
  group.add(windshield);

  const rearWindow = new THREE.Mesh(plane(spec.roofW * 0.95, spec.roofH * 0.9), glassMat);
  rearWindow.position.set(0, roof.position.y, spec.roofZ - spec.roofL / 2 - 0.01);
  rearWindow.rotation.y = Math.PI;
  group.add(rearWindow);

  for (const side of [-1, 1]) {
    const sideWin = new THREE.Mesh(plane(spec.roofL * 0.92, spec.roofH * 0.85), glassMat);
    sideWin.position.set(side * (spec.roofW / 2 + 0.01), roof.position.y, spec.roofZ);
    sideWin.rotation.y = (side * Math.PI) / 2;
    group.add(sideWin);
  }

  // Wheels (shared geometry + material; 8 radial segments)
  const wheelGeom = cyl(spec.wheelR, spec.wheelR, 0.22, 8);
  const wheelMat = toon(0x111111);
  const hubGeom = cyl(spec.wheelR * 0.45, spec.wheelR * 0.45, 0.24, 6);
  const hubMat = toon(0xbbbbbb);
  const wheelDX = spec.bodyW / 2 + 0.05;
  const wheelDZ = spec.bodyL / 2 - 0.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * wheelDX, spec.wheelR, sz * wheelDZ);
      group.add(wheel);

      const hub = new THREE.Mesh(hubGeom, hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      group.add(hub);
    }
  }

  // Headlights
  const headLightMat = basic(0xfff4c2);
  const hlGeom = cyl(0.1, 0.1, 0.04, 8);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeom, headLightMat);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(sx * spec.bodyW * 0.32, body.position.y, spec.bodyL / 2 + 0.02);
    group.add(hl);
  }

  // Taillights
  const tailMat = basic(0xff2a30);
  const tlGeom = box(0.35, 0.12, 0.04);
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(tlGeom, tailMat);
    tl.position.set(sx * spec.bodyW * 0.32, body.position.y + 0.08, -spec.bodyL / 2 - 0.02);
    group.add(tl);
  }

  // License plate (shared texture)
  const plate = new THREE.Mesh(
    plane(0.5, 0.18),
    texturedBasic("plate", getLicensePlateTexture()),
  );
  plate.position.set(0, body.position.y - 0.15, -spec.bodyL / 2 - 0.03);
  plate.rotation.y = Math.PI;
  group.add(plate);

  return group;
}

// ---------------------------------------------------------------------------
// Lamppost
// ---------------------------------------------------------------------------
export function makeLamppost(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "lamppost";

  const pole = new THREE.Mesh(cyl(0.06, 0.1, 3.4, 8), toon(0x1a0f22));
  pole.position.y = 1.7;
  group.add(pole);
  addOutline(pole, 1.08);

  const head = new THREE.Mesh(cone(0.3, 0.35, 8), toon(0x2a1f33));
  head.position.y = 3.55;
  head.rotation.x = Math.PI;
  group.add(head);

  const bulb = new THREE.Mesh(sphere(0.18, 8, 6), basic(0xffb050));
  bulb.position.y = 3.4;
  group.add(bulb);

  return group;
}

// ---------------------------------------------------------------------------
// Fire hydrant
// ---------------------------------------------------------------------------
export function makeFireHydrant(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "fire_hydrant";

  const base = new THREE.Mesh(cyl(0.22, 0.26, 0.5, 8), toon(0xc81f1f, 0xc81f1f, 0.03));
  base.position.y = 0.25;
  group.add(base);
  addOutline(base, 1.07);

  const cap = new THREE.Mesh(cyl(0.16, 0.22, 0.18, 8), toon(0xc81f1f));
  cap.position.y = 0.6;
  group.add(cap);

  const top = new THREE.Mesh(sphere(0.16, 8, 6), toon(0xc81f1f));
  top.position.y = 0.72;
  top.scale.y = 0.6;
  group.add(top);

  const boltGeom = cyl(0.07, 0.07, 0.12, 6);
  const boltMat = toon(0xeac247, 0xeac247, 0.05);
  for (const side of [-1, 1]) {
    const bolt = new THREE.Mesh(boltGeom, boltMat);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(side * 0.26, 0.32, 0);
    group.add(bolt);
  }

  const frontBolt = new THREE.Mesh(boltGeom, boltMat);
  frontBolt.rotation.x = Math.PI / 2;
  frontBolt.position.set(0, 0.32, 0.26);
  group.add(frontBolt);

  return group;
}

// ---------------------------------------------------------------------------
// Dumpster
// ---------------------------------------------------------------------------
export function makeDumpster(variant = 0): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "dumpster";

  const graffitiColors = [0xff2bd6, 0x00f0ff, 0xeac247, 0xff7a2b];
  const tagColor = graffitiColors[variant % graffitiColors.length];

  // Body
  const body = new THREE.Mesh(box(1.2, 0.85, 0.7), toon(0x1f5a30, 0x0a2010, 0.04));
  body.position.y = 0.55;
  group.add(body);
  addOutline(body, 1.06);

  // Graffiti decal (texture cached per color)
  const decal = new THREE.Mesh(
    plane(1.1, 0.7),
    texturedBasic(`graf|${tagColor}`, getGraffitiTexture(tagColor), 0xffffff, 0.999),
  );
  decal.position.set(0, 0.55, 0.36);
  group.add(decal);

  // Lid
  const lid = new THREE.Mesh(box(1.22, 0.08, 0.72), toon(0x163f22));
  lid.position.y = 1.0;
  group.add(lid);

  // Wheels
  const wheelGeom = cyl(0.12, 0.12, 0.1, 8);
  const wheelMat = toon(0x111111);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeom, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.45, 0.12, 0);
    group.add(wheel);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Mailbox
// ---------------------------------------------------------------------------
export function makeMailbox(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "mailbox";

  const mat = toon(0x1a4a9a, 0x05132f, 0.04);

  const body = new THREE.Mesh(box(0.7, 0.9, 0.55), mat);
  body.position.y = 0.55;
  group.add(body);
  addOutline(body, 1.07);

  const top = new THREE.Mesh(cyl(0.35, 0.35, 0.7, 8, 1, false, 0, Math.PI), mat);
  top.rotation.z = Math.PI / 2;
  top.rotation.y = Math.PI / 2;
  top.position.y = 1.0;
  group.add(top);

  const slot = new THREE.Mesh(box(0.45, 0.06, 0.02), basic(0x05132f));
  slot.position.set(0, 0.9, 0.28);
  group.add(slot);

  const label = new THREE.Mesh(
    plane(0.55, 0.18),
    texturedBasic("mail_label", getLabelTexture("U.S. MAIL", 0xffffff, 0x1a4a9a), 0xffffff, 0.999),
  );
  label.position.set(0, 0.6, 0.28);
  group.add(label);

  const legGeom = cyl(0.04, 0.04, 0.5, 6);
  const legMat = toon(0x222222);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(side * 0.25, 0.25, 0);
    group.add(leg);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Payphone
// ---------------------------------------------------------------------------
export function makePayphone(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "payphone";

  const back = new THREE.Mesh(box(0.55, 1.6, 0.1), toon(0x9a9a9a, 0x101010, 0.02));
  back.position.y = 1.3;
  group.add(back);
  addOutline(back, 1.05);

  const housing = new THREE.Mesh(box(0.5, 0.8, 0.22), toon(0x6a6a6a));
  housing.position.set(0, 1.55, 0.16);
  group.add(housing);

  const keypad = new THREE.Mesh(
    plane(0.35, 0.4),
    texturedBasic("keypad", getKeypadTexture()),
  );
  keypad.position.set(0, 1.45, 0.28);
  group.add(keypad);

  const receiver = new THREE.Mesh(box(0.08, 0.32, 0.08), toon(0x222222));
  receiver.position.set(-0.28, 1.5, 0.1);
  receiver.rotation.z = 0.3;
  group.add(receiver);

  const cord = new THREE.Mesh(torus(0.12, 0.012, 6, 8, Math.PI), toon(0x111111));
  cord.position.set(-0.2, 1.25, 0.1);
  cord.rotation.x = Math.PI / 2;
  group.add(cord);

  const pole = new THREE.Mesh(cyl(0.05, 0.06, 1.3, 8), toon(0x444444));
  pole.position.y = 0.65;
  group.add(pole);

  return group;
}

// ---------------------------------------------------------------------------
// Neon sign
// ---------------------------------------------------------------------------
export function makeNeonSign(text: string, color = 0xff2bd6): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "neon_sign";

  const tex = getNeonTexture(text, color);
  const width = Math.max(1.2, Math.min(3.5, text.length * 0.32));
  const sign = new THREE.Mesh(
    plane(width, 0.9),
    texturedBasic(`neon|${text}|${color}`, tex, 0xffffff, 0.999),
  );
  group.add(sign);

  const back = new THREE.Mesh(box(width + 0.1, 1.0, 0.08), toon(0x0a0814));
  back.position.z = -0.05;
  group.add(back);
  addOutline(back, 1.04);

  const halo = new THREE.Mesh(plane(width * 1.25, 1.15), basic(color, 0.25));
  halo.position.z = 0.01;
  group.add(halo);

  return group;
}

// ---------------------------------------------------------------------------
// Billboard
// ---------------------------------------------------------------------------
export function makeBillboard(theme: "strip" | "subway" | "rooftop"): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "billboard";

  const tex = getBillboardTexture(theme);
  const w = 6;
  const h = 3;

  const panel = new THREE.Mesh(plane(w, h), texturedBasic(`bb|${theme}`, tex));
  panel.position.y = 4.5;
  group.add(panel);

  const back = new THREE.Mesh(box(w + 0.3, h + 0.3, 0.15), toon(0x1a1426));
  back.position.y = 4.5;
  back.position.z = -0.1;
  group.add(back);
  addOutline(back, 1.03);

  const legGeom = box(0.18, 3.0, 0.18);
  const legMat = toon(0x141022);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(side * (w / 2 - 0.6), 1.5, -0.1);
    group.add(leg);
  }

  const bar = new THREE.Mesh(box(w * 0.7, 0.06, 0.06), toon(0x111111));
  bar.position.set(0, 3.0, 0.25);
  group.add(bar);

  const lightGeom = sphere(0.08, 8, 6);
  const lightMat = basic(0xffe9a0);
  for (let i = -1; i <= 1; i++) {
    const light = new THREE.Mesh(lightGeom, lightMat);
    light.position.set(i * (w / 4), 3.05, 0.3);
    group.add(light);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Trash bag
// ---------------------------------------------------------------------------
export function makeTrashBag(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "trash_bag";

  const bag = new THREE.Mesh(sphere(0.35, 8, 6), toon(0x0a0a10, 0x000000, 0.0));
  bag.scale.set(1.0, 0.7, 0.9);
  bag.position.y = 0.25;
  group.add(bag);
  addOutline(bag, 1.07);

  const knot = new THREE.Mesh(cone(0.08, 0.18, 6), toon(0x141420));
  knot.position.y = 0.5;
  group.add(knot);

  const nubGeom = sphere(0.08, 6, 4);
  const nubMat = toon(0x111118);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const nub = new THREE.Mesh(nubGeom, nubMat);
    nub.position.set(Math.cos(ang) * 0.28, 0.18 + i * 0.04, Math.sin(ang) * 0.22);
    group.add(nub);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Vending machine
// ---------------------------------------------------------------------------
export function makeVendingMachine(variant: "drinks" | "snacks" = "drinks"): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `vending_${variant}`;

  const baseColor = variant === "drinks" ? 0xc81f3a : 0xeac247;
  const body = new THREE.Mesh(box(0.9, 1.9, 0.7), toon(baseColor, baseColor, 0.05));
  body.position.y = 0.95;
  group.add(body);
  addOutline(body, 1.05);

  const front = new THREE.Mesh(
    plane(0.78, 1.4),
    texturedBasic(`vend|${variant}`, getVendingFrontTexture(variant)),
  );
  front.position.set(0, 1.15, 0.36);
  group.add(front);

  const lowerPanel = new THREE.Mesh(plane(0.78, 0.4), basic(0x222222));
  lowerPanel.position.set(0, 0.3, 0.36);
  group.add(lowerPanel);

  const slot = new THREE.Mesh(box(0.18, 0.03, 0.02), basic(0x000000));
  slot.position.set(0.18, 0.45, 0.37);
  group.add(slot);

  const disp = new THREE.Mesh(box(0.55, 0.12, 0.04), basic(0x000000));
  disp.position.set(0, 0.15, 0.37);
  group.add(disp);

  return group;
}

// ---------------------------------------------------------------------------
// Manhole
// ---------------------------------------------------------------------------
export function makeManhole(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "manhole";

  const disc = new THREE.Mesh(
    circle(0.5, 16),
    texturedBasic("manhole", getManholeTexture()),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  group.add(disc);

  const rim = new THREE.Mesh(ring(0.5, 0.55, 16), basic(0x161616));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.021;
  group.add(rim);

  return group;
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------
export function makeBench(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "bench";

  const woodMat = toon(0x6a3a1a);

  const seatGeom = box(1.6, 0.06, 0.14);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(seatGeom, woodMat);
    slat.position.set(0, 0.5, -0.18 + i * 0.18);
    group.add(slat);
    if (i === 1) addOutline(slat, 1.05);
  }

  const backGeom = box(1.6, 0.12, 0.05);
  for (let i = 0; i < 2; i++) {
    const slat = new THREE.Mesh(backGeom, woodMat);
    slat.position.set(0, 0.85 + i * 0.18, -0.25);
    group.add(slat);
  }

  const legMat = toon(0x222228);
  const legGeom = box(0.08, 0.5, 0.4);
  const armGeom = box(0.06, 0.5, 0.06);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(side * 0.7, 0.25, -0.05);
    group.add(leg);

    const armRise = new THREE.Mesh(armGeom, legMat);
    armRise.position.set(side * 0.7, 0.78, -0.25);
    group.add(armRise);
  }

  return group;
}

// ===========================================================================
// Texture generation helpers (each procedural texture is generated ONCE and
// cached in _textures; parametric ones are keyed by their arguments).
// ===========================================================================
function makeCanvas(size = 256): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");
  return { canvas, ctx };
}

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

// Generic cache wrapper: builds (or returns) a CanvasTexture for `key`.
function cachedTexture(
  key: string,
  build: (ctx: CanvasRenderingContext2D, size: number) => void,
  transparent = false,
): THREE.Texture {
  let tex = _textures.get(key);
  if (!tex) {
    const { canvas, ctx } = makeCanvas(256);
    build(ctx, 256);
    tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.userData = { transparent };
    _textures.set(key, tex);
  }
  return tex;
}

function getGraffitiTexture(color: number): THREE.Texture {
  return cachedTexture(`graffiti|${color}`, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    const css = hexToCss(color);

    ctx.strokeStyle = css;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(40, 160);
    ctx.lineTo(70, 90);
    ctx.lineTo(100, 160);
    ctx.moveTo(55, 130);
    ctx.lineTo(90, 130);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(120, 90);
    ctx.bezierCurveTo(120, 170, 180, 170, 180, 90);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(200, 90);
    ctx.lineTo(200, 170);
    ctx.lineTo(230, 170);
    ctx.stroke();

    ctx.fillStyle = css;
    ctx.beginPath();
    ctx.arc(70, 180, 5, 0, Math.PI * 2);
    ctx.arc(140, 190, 4, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.5, 0, Math.PI * 2);
      ctx.fillStyle = css;
      ctx.fill();
    }
  }, true);
}

// Cap unique neon textures to a small reused set. Identical (text,color)
// pairs share one texture; otherwise we still cache by exact key so a level
// with a handful of distinct signs only ever builds a handful of canvases.
function getNeonTexture(text: string, color: number): THREE.Texture {
  return cachedTexture(`neon|${text}|${color}`, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    const css = hexToCss(color);

    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = css;
    for (let i = 0; i < 5; i++) {
      ctx.shadowBlur = 20 + i * 6;
      ctx.fillStyle = css;
      ctx.fillText(text, 128, 128);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 128, 128);
  }, true);
}

function getBillboardTexture(theme: string): THREE.Texture {
  return cachedTexture(`billboard|${theme}`, (ctx) => {
    let bg = "#1a0e22";
    let accent = "#ff2bd6";
    let title = "AXE FM";
    let sub = "TONIGHT @ 10";
    if (theme === "subway") {
      bg = "#0e1820";
      accent = "#eac247";
      title = "RIDE METRO";
      sub = "DAY PASS $5";
    } else if (theme === "rooftop") {
      bg = "#06050d";
      accent = "#00f0ff";
      title = "NEO COLA";
      sub = "ICE COLD";
    }

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 240, 240);

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = accent;
    for (let i = -8; i < 16; i++) {
      ctx.fillRect(i * 24, 0, 8, 256);
    }
    ctx.restore();

    ctx.fillStyle = accent;
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.fillText(title, 128, 110);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(sub, 128, 170);
  });
}

function getVendingFrontTexture(variant: string): THREE.Texture {
  return cachedTexture(`vending|${variant}`, (ctx) => {
    const isDrinks = variant === "drinks";
    const bg = isDrinks ? "#c81f3a" : "#eac247";
    const accent = isDrinks ? "#ffffff" : "#1a0e22";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = "#0a0814";
    ctx.fillRect(0, 0, 256, 50);
    ctx.fillStyle = accent;
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isDrinks ? "AXE POP" : "OUTRUN", 128, 25);

    ctx.fillStyle = "#1a1a22";
    ctx.fillRect(16, 60, 224, 180);

    const cols = 4;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 24 + c * 54;
        const y = 70 + r * 42;
        if (isDrinks) {
          ctx.fillStyle = ["#ff2bd6", "#00f0ff", "#eac247", "#c7ff2b"][(r + c) % 4];
          ctx.fillRect(x + 8, y, 28, 36);
          ctx.fillStyle = "#0a0814";
          ctx.fillRect(x + 8, y + 12, 28, 6);
        } else {
          ctx.fillStyle = ["#ff7a2b", "#ffd02b", "#c7ff2b", "#ff2bd6"][(r + c) % 4];
          ctx.beginPath();
          ctx.ellipse(x + 22, y + 18, 16, 14, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${r + 1}${String.fromCharCode(65 + c)}`, x, y + 40);
      }
    }
  });
}

function getGlassTexture(): THREE.Texture {
  return cachedTexture("glass", (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, "#16202e");
    grad.addColorStop(0.5, "#2a3a55");
    grad.addColorStop(1.0, "#0a0a14");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#9ac8ff";
    ctx.fillRect(0, 90, 256, 12);
    ctx.globalAlpha = 0.2;
    ctx.fillRect(0, 130, 256, 6);
    ctx.restore();
  });
}

// Shared glass material reused by every car's six windows.
function getGlassMat(): THREE.MeshBasicMaterial {
  const k = "glassMat";
  let m = _basicMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: getGlassTexture(),
      color: 0x223344,
      transparent: true,
      opacity: 0.85,
    });
    _basicMats.set(k, m);
  }
  return m;
}

function getLabelTexture(text: string, fg: number, bg: number): THREE.Texture {
  return cachedTexture(`label|${text}|${fg}|${bg}`, (ctx) => {
    ctx.fillStyle = hexToCss(bg);
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = hexToCss(fg);
    ctx.font = "bold 56px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 128);
  });
}

function getLicensePlateTexture(): THREE.Texture {
  return cachedTexture("plate", (ctx) => {
    ctx.fillStyle = "#eae6c8";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#1a2a6a";
    ctx.font = "bold 64px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OUTRUN", 128, 110);
    ctx.font = "bold 44px monospace";
    ctx.fillText("AXE 84", 128, 170);
  });
}

function getKeypadTexture(): THREE.Texture {
  return cachedTexture("keypad", (ctx) => {
    ctx.fillStyle = "#222222";
    ctx.fillRect(0, 0, 256, 256);

    const labels = [
      "1", "2", "3",
      "4", "5", "6",
      "7", "8", "9",
      "*", "0", "#",
    ];
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 50 + c * 80;
        const y = 40 + r * 60;
        ctx.fillStyle = "#444444";
        ctx.fillRect(x - 24, y - 22, 48, 44);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(labels[r * 3 + c], x, y);
      }
    }
  });
}

function getManholeTexture(): THREE.Texture {
  return cachedTexture("manhole", (ctx) => {
    ctx.fillStyle = "#1a1a1f";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "#080808";
    ctx.lineWidth = 4;
    for (let r = 30; r < 120; r += 18) {
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#2a2a30";
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const x = 128 + Math.cos(ang) * 100;
      const y = 128 + Math.sin(ang) * 100;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#3a3a44";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SEWER", 128, 128);
  });
}

// ===========================================================================
// Teardown: free shared geometries/materials/textures (best-effort).
// Callers may invoke this on level teardown. After calling, the next prop
// factory invocation will lazily rebuild whatever it needs.
// ===========================================================================
export function disposeProps(): void {
  for (const g of _geoms.values()) g.dispose();
  _geoms.clear();
  for (const m of _toonMats.values()) m.dispose();
  _toonMats.clear();
  for (const m of _basicMats.values()) m.dispose();
  _basicMats.clear();
  for (const t of _textures.values()) t.dispose();
  _textures.clear();
}

// Re-export texturedToon to avoid unused-warning if not used elsewhere yet.
export { texturedToon };
