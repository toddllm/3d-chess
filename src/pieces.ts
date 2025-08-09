import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';

export function createPieceMesh(pieceType: PieceType, pieceColor: PieceColor): THREE.Mesh {
  const geometry = buildGeometryForPiece(pieceType);
  const color = pieceColor === 'w' ? 0xeeeeee : 0x222222;
  const metalness = 0.25;
  const roughness = 0.2;
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness,
    roughness,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    sheen: 0.5,
    sheenRoughness: 0.5,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = `piece-${pieceColor}${pieceType}`;
  return mesh;
}

function buildGeometryForPiece(pieceType: PieceType): THREE.BufferGeometry {
  switch (pieceType) {
    case 'p':
      return buildPawnGeometry();
    case 'r':
      return buildRookGeometry();
    case 'n':
      return buildKnightGeometry();
    case 'b':
      return buildBishopGeometry();
    case 'q':
      return buildQueenGeometry();
    case 'k':
      return buildKingGeometry();
  }
}

const BASE_RADIUS = 0.38;
const BASE_HEIGHT = 0.1;

function addBase(geometries: THREE.BufferGeometry[]) {
  const base = new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 48);
  base.translate(0, BASE_HEIGHT / 2, 0);
  geometries.push(base);
}

function buildPawnGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  const lower = new THREE.CylinderGeometry(0.22, 0.32, 0.28, 32);
  lower.translate(0, BASE_HEIGHT + 0.14, 0);
  parts.push(lower);
  const upper = new THREE.CylinderGeometry(0.18, 0.22, 0.24, 32);
  upper.translate(0, BASE_HEIGHT + 0.28 + 0.12, 0);
  parts.push(upper);
  const head = new THREE.SphereGeometry(0.16, 32, 16);
  head.translate(0, BASE_HEIGHT + 0.28 + 0.24 + 0.16, 0);
  parts.push(head);
  return mergeGeometries(parts, false)!;
}

function buildRookGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  const tower = new THREE.CylinderGeometry(0.30, 0.35, 0.6, 48);
  tower.translate(0, BASE_HEIGHT + 0.3, 0);
  parts.push(tower);
  const crown = new THREE.CylinderGeometry(0.36, 0.3, 0.1, 12);
  crown.translate(0, BASE_HEIGHT + 0.6 + 0.05, 0);
  parts.push(crown);
  // Simple crenellations as four small boxes
  const crenel = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const y = BASE_HEIGHT + 0.6 + 0.11;
  const positions: [number, number][] = [[0.2,0],[ -0.2,0 ],[0,0.2],[0,-0.2]];
  for (const [x,z] of positions) {
    const c = crenel.clone();
    c.translate(x, y, z);
    parts.push(c);
  }
  return mergeGeometries(parts, false)!;
}

function buildKnightGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  const body = new THREE.CylinderGeometry(0.28, 0.34, 0.45, 24);
  body.translate(0, BASE_HEIGHT + 0.225, 0);
  parts.push(body);
  // Stylized head/neck shape using a tilted box to approximate a knight
  const neck = new THREE.BoxGeometry(0.22, 0.38, 0.18);
  neck.rotateZ(THREE.MathUtils.degToRad(20));
  neck.translate(0.05, BASE_HEIGHT + 0.45 + 0.19, 0);
  parts.push(neck);
  const snout = new THREE.BoxGeometry(0.14, 0.12, 0.16);
  snout.translate(0.16, BASE_HEIGHT + 0.45 + 0.32, 0);
  parts.push(snout);
  return mergeGeometries(parts, false)!;
}

function buildBishopGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  // Taller stem for bishop
  const stem = new THREE.CylinderGeometry(0.24, 0.34, 0.58, 32);
  stem.translate(0, BASE_HEIGHT + 0.29, 0);
  parts.push(stem);

  // Collar ring below head
  const collar = new THREE.TorusGeometry(0.22, 0.045, 12, 24);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, BASE_HEIGHT + 0.58 + 0.04, 0);
  parts.push(collar);

  // Ovoid head
  const head = new THREE.SphereGeometry(0.21, 32, 16);
  head.scale(1, 1.2, 1);
  head.translate(0, BASE_HEIGHT + 0.58 + 0.17, 0);
  parts.push(head);

  // Mitre cap
  const tip = new THREE.ConeGeometry(0.16, 0.2, 32);
  tip.translate(0, BASE_HEIGHT + 0.58 + 0.34, 0);
  parts.push(tip);

  // Diagonal fin to suggest the mitre notch (silhouette cue)
  const fin = new THREE.BoxGeometry(0.06, 0.30, 0.14);
  fin.rotateY(Math.PI / 4);
  fin.rotateZ(Math.PI / 7);
  fin.translate(0.03, BASE_HEIGHT + 0.58 + 0.20, 0);
  parts.push(fin);

  return mergeGeometries(parts, false)!;
}

function buildQueenGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  const stem = new THREE.CylinderGeometry(0.26, 0.36, 0.6, 48);
  stem.translate(0, BASE_HEIGHT + 0.3, 0);
  parts.push(stem);
  const crownBase = new THREE.TorusGeometry(0.22, 0.05, 12, 24);
  crownBase.rotateX(Math.PI / 2);
  crownBase.translate(0, BASE_HEIGHT + 0.6 + 0.06, 0);
  parts.push(crownBase);
  const crownBalls = new THREE.SphereGeometry(0.06, 16, 8);
  const y = BASE_HEIGHT + 0.6 + 0.12;
  const positions: [number, number][] = [[0.18,0],[ -0.18,0 ],[0,0.18],[0,-0.18]];
  for (const [x,z] of positions) {
    const s = crownBalls.clone();
    s.translate(x, y, z);
    parts.push(s);
  }
  return mergeGeometries(parts, false)!;
}

function buildKingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  addBase(parts);
  const stem = new THREE.CylinderGeometry(0.28, 0.38, 0.62, 48);
  stem.translate(0, BASE_HEIGHT + 0.31, 0);
  parts.push(stem);
  const collar = new THREE.TorusGeometry(0.22, 0.05, 12, 24);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, BASE_HEIGHT + 0.62 + 0.06, 0);
  parts.push(collar);
  const crossVertical = new THREE.BoxGeometry(0.06, 0.22, 0.06);
  crossVertical.translate(0, BASE_HEIGHT + 0.62 + 0.2, 0);
  parts.push(crossVertical);
  const crossHorizontal = new THREE.BoxGeometry(0.18, 0.06, 0.06);
  crossHorizontal.translate(0, BASE_HEIGHT + 0.62 + 0.2, 0);
  parts.push(crossHorizontal);
  return mergeGeometries(parts, false)!;
}
