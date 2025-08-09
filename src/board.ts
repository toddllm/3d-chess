import * as THREE from 'three';

export type BoardSquare = {
  mesh: THREE.Mesh;
  name: string; // algebraic square like 'e4'
  fileIndex: number; // 0-7 for a-h
  rankIndex: number; // 0-7 for 1-8
};

export const SQUARE_SIZE = 1.0;
export const BOARD_SIZE = 8;

export function fileIndexToFileLetter(fileIndex: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + fileIndex);
}

export function rankIndexToRankNumber(rankIndex: number): number {
  return rankIndex + 1;
}

export function toSquareName(fileIndex: number, rankIndex: number): string {
  return `${fileIndexToFileLetter(fileIndex)}${rankIndexToRankNumber(rankIndex)}`;
}

export function squareNameToIndices(square: string): { fileIndex: number; rankIndex: number } {
  const fileLetter = square[0];
  const rankChar = square[1];
  const fileIndex = fileLetter.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankIndex = parseInt(rankChar, 10) - 1;
  return { fileIndex, rankIndex };
}

export function squareToPosition(square: string): THREE.Vector3 {
  const { fileIndex, rankIndex } = squareNameToIndices(square);
  return indicesToPosition(fileIndex, rankIndex);
}

export function indicesToPosition(fileIndex: number, rankIndex: number): THREE.Vector3 {
  const x = (fileIndex - (BOARD_SIZE - 1) / 2) * SQUARE_SIZE;
  const z = (rankIndex - (BOARD_SIZE - 1) / 2) * SQUARE_SIZE;
  return new THREE.Vector3(x, 0, z);
}

export function positionToSquare(point: THREE.Vector3): string | null {
  const fileIndex = Math.round(point.x / SQUARE_SIZE + (BOARD_SIZE - 1) / 2);
  const rankIndex = Math.round(point.z / SQUARE_SIZE + (BOARD_SIZE - 1) / 2);
  if (
    fileIndex < 0 || fileIndex >= BOARD_SIZE ||
    rankIndex < 0 || rankIndex >= BOARD_SIZE
  ) return null;
  return toSquareName(fileIndex, rankIndex);
}

export function createBoard(): { group: THREE.Group; squares: BoardSquare[]; squareMeshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.name = 'Board';

  const squares: BoardSquare[] = [];
  const squareMeshes: THREE.Mesh[] = [];

  const plane = new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE);

  for (let rankIndex = 0; rankIndex < BOARD_SIZE; rankIndex++) {
    for (let fileIndex = 0; fileIndex < BOARD_SIZE; fileIndex++) {
      const isDark = (fileIndex + rankIndex) % 2 === 1;
      const baseColor = isDark ? 0x8B5A2B : 0xEEE7D0;
      const material = new THREE.MeshPhysicalMaterial({ color: baseColor, roughness: 0.85, metalness: 0.0 });
      const mesh = new THREE.Mesh(plane, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;

      const name = toSquareName(fileIndex, rankIndex);
      const pos = indicesToPosition(fileIndex, rankIndex);
      mesh.position.copy(pos);
      mesh.userData.square = name;
      // Ensure the board squares are raycastable even if materials change
      mesh.userData.isSquare = true;
      mesh.name = `square-${name}`;

      group.add(mesh);
      squareMeshes.push(mesh);
      squares.push({ mesh, name, fileIndex, rankIndex });
    }
  }

  // Add a thin border frame
  const frameThickness = 0.15 * SQUARE_SIZE;
  const frameHeight = 0.1 * SQUARE_SIZE;
  const boardExtent = BOARD_SIZE * SQUARE_SIZE;
  const outer = new THREE.BoxGeometry(boardExtent + frameThickness * 2, frameHeight, boardExtent + frameThickness * 2);
  const inner = new THREE.BoxGeometry(boardExtent, frameHeight + 0.02, boardExtent);
  const frameMaterial = new THREE.MeshPhysicalMaterial({ color: 0x3a2912, roughness: 0.7, metalness: 0.1, clearcoat: 0.4 });

  const outerMesh = new THREE.Mesh(outer, frameMaterial);
  const innerMesh = new THREE.Mesh(inner, frameMaterial);
  outerMesh.position.y = -frameHeight / 2 - 0.01;
  innerMesh.position.y = -frameHeight / 2;
  outerMesh.castShadow = false; outerMesh.receiveShadow = true;
  innerMesh.castShadow = false; innerMesh.receiveShadow = true;
  // CSG-like look by simply layering
  group.add(outerMesh);
  group.add(innerMesh);

  return { group, squares, squareMeshes };
}
