import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Chess, Move } from 'chess.js';
import { createBoard, squareToPosition, positionToSquare, BoardSquare, SQUARE_SIZE } from './board';
import { createPieceMesh, PieceColor, PieceType } from './pieces';
import { ModeManager, MODES, ModeId, getPortalSquares, consumeLastTeleport, getPortalRerollInfo } from './modes';
import { PUZZLES } from './puzzles';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
// Vite supports importing JSON; three Font constructor accepts JSON data
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import helvetikerFontData from 'three/examples/fonts/helvetiker_regular.typeface.json';

// BufferGeometryUtils is imported within pieces.ts for merges

type PieceMesh = THREE.Mesh & { userData: { square: string; type: PieceType; color: PieceColor } };

type PromotionRequest = {
  from: string;
  to: string;
  resolve: (choice: Exclude<PieceType, 'p' | 'k'>) => void;
  reject: (reason?: unknown) => void;
};

class Chess3DApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private chess = new Chess();

  private boardGroup: THREE.Group;
  private boardSquares: BoardSquare[] = [];
  private squareMeshes: THREE.Mesh[] = [];

  private squareToPiece: Map<string, PieceMesh> = new Map();
  private selectedSquare: string | null = null;
  private highlightedSquares: string[] = [];
  private moveTargetsBySquare: Map<string, Move[]> = new Map();

  private promotionRequest: PromotionRequest | null = null;

  private canvas: HTMLCanvasElement;
  private statusEl: HTMLElement;
  private newGameBtn: HTMLButtonElement;
  private autoPromoteCheckbox: HTMLInputElement;
  private flipOnTurnCheckbox: HTMLInputElement;
  private promotionModal: HTMLElement;
  private createLanBtn: HTMLButtonElement;
  private leaveLanBtn: HTMLButtonElement;
  private lanLinkSpan: HTMLSpanElement;
  private youAreSpan: HTMLSpanElement;
  private lanShareSpan: HTMLSpanElement;
  private lanLinkInput: HTMLInputElement;
  private copyLanLinkBtn: HTMLButtonElement;
  private serverUrlInput: HTMLInputElement;

  // Modes
  private modeManager: ModeManager;
  private modeSelect: HTMLSelectElement | null = null;
  private puzzleBar: HTMLElement | null = null;
  private puzzleSelect: HTMLSelectElement | null = null;
  private puzzleGoalSpan: HTMLSpanElement | null = null;
  private puzzleNextBtn: HTMLButtonElement | null = null;
  private puzzleResetBtn: HTMLButtonElement | null = null;
  private puzzleAutoNextCheckbox: HTMLInputElement | null = null;
  private activePuzzleIndex: number = 0;
  // Banner for end conditions
  private bannerEl: HTMLElement | null = null;
  private bannerTextEl: HTMLElement | null = null;
  private bannerActionBtn: HTMLButtonElement | null = null;
  private puzzleSolverColor: PieceColor = 'w';
  private puzzleGoalMoves: number = 0;
  private puzzleSolverMovesUsed: number = 0;
  private puzzleSolved = false;
  private puzzleFailed = false;
  // Networking / mode
  private isLanMode = false;
  private myColor: PieceColor = 'w';
  private ws: WebSocket | null = null;
  private gameId: string | null = null;

  // Visual indicators
  private hoveredSquare: string | null = null;
  private hoverIndicator: THREE.Mesh | null = null;
  private selectionIndicator: THREE.Mesh | null = null;
  private legalMoveMarkers: THREE.Mesh[] = [];
  private markerGeometry: THREE.CylinderGeometry | null = null;
  private markerMatQuiet: THREE.MeshBasicMaterial | null = null;
  private markerMatCapture: THREE.MeshBasicMaterial | null = null;
  private portalMarkers: THREE.Mesh[] = [];
  private coordLabelsGroup: THREE.Group | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.statusEl = document.getElementById('status')!;
    this.newGameBtn = document.getElementById('newGameBtn') as HTMLButtonElement;
    this.autoPromoteCheckbox = document.getElementById('autoPromoteQueen') as HTMLInputElement;
    this.flipOnTurnCheckbox = document.getElementById('flipOnTurn') as HTMLInputElement;
    this.promotionModal = document.getElementById('promotionModal') as HTMLElement;
    this.createLanBtn = document.getElementById('createLanBtn') as HTMLButtonElement;
    this.leaveLanBtn = document.getElementById('leaveLanBtn') as HTMLButtonElement;
    this.lanLinkSpan = document.getElementById('lanLink') as HTMLSpanElement;
    this.youAreSpan = document.getElementById('youAre') as HTMLSpanElement;
    this.lanShareSpan = document.getElementById('lanShare') as HTMLSpanElement;
    this.lanLinkInput = document.getElementById('lanLinkInput') as HTMLInputElement;
    this.copyLanLinkBtn = document.getElementById('copyLanLinkBtn') as HTMLButtonElement;
    this.serverUrlInput = document.getElementById('serverUrlInput') as HTMLInputElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    const fov = 45;
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 100);
    // Start behind White: look from negative Z toward the board center
    this.camera.position.set(0, 6.5, -10);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 18;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -8; dir.shadow.camera.right = 8; dir.shadow.camera.top = 8; dir.shadow.camera.bottom = -8;
    dir.shadow.camera.near = 1; dir.shadow.camera.far = 30;
    this.scene.add(dir);

    const hemi = new THREE.HemisphereLight(0x8888aa, 0x111109, 0.35);
    this.scene.add(hemi);

    // Ground for soft shadow catch
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Board
    const { group, squares, squareMeshes } = createBoard();
    this.boardGroup = group;
    this.boardSquares = squares;
    this.squareMeshes = squareMeshes;
    this.scene.add(group);

    // Pieces
    this.buildAllPiecesFromGameState();

    // Modes
    this.modeManager = new ModeManager(this.chess);
    this.injectModeUI();
    this.modeManager.init('classic');
    this.injectPuzzleUI();

    // Indicators
    this.createIndicators();
    this.updatePortalMarkers();
    this.addCoordinateLabels();

    // Event listeners
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    // Prevent default touch actions to ensure proper pointer events
    this.canvas.style.touchAction = 'none';

    this.newGameBtn.addEventListener('click', () => this.resetGame());
    this.createLanBtn.addEventListener('click', () => this.createLanGame());
    this.leaveLanBtn.addEventListener('click', () => this.leaveLanGame());
    this.copyLanLinkBtn.addEventListener('click', () => this.copyLanLink());
    // Banner
    this.bannerEl = document.getElementById('banner');
    this.bannerTextEl = document.getElementById('bannerText');
    this.bannerActionBtn = document.getElementById('bannerActionBtn') as HTMLButtonElement | null;
    this.bannerActionBtn?.addEventListener('click', () => {
      this.hideBanner();
      this.resetGame();
    });

    // Promotion UI
    this.promotionModal.querySelectorAll('button[data-piece]')!.forEach((btn) => {
      btn.addEventListener('click', () => {
        const piece = (btn as HTMLButtonElement).dataset.piece as 'q' | 'r' | 'b' | 'n';
        if (this.promotionRequest) {
          this.hidePromotionModal();
          this.promotionRequest.resolve(piece);
          this.promotionRequest = null;
        }
      });
    });

    this.updateStatus();

    this.animate();

    // Auto-join via URL params if provided
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const game = params.get('game');
    const serverParam = params.get('server');
    const puzzleParam = params.get('puzzle');
    if (serverParam) this.serverUrlInput.value = decodeURIComponent(serverParam);
    if (mode === 'lan' && game) {
      this.joinLanGame(game);
    }
    if (mode && this.modeSelect) {
      const id = (mode as ModeId);
      if ([...this.modeSelect.options].some(o => o.value === id)) {
        this.modeSelect.value = id;
        this.modeManager.init(id);
        if (id === 'puzzles') {
          if (puzzleParam) this.activePuzzleIndex = Math.max(0, Math.min(PUZZLES.length - 1, parseInt(puzzleParam, 10) || 0));
          this.puzzleBar?.classList.remove('hidden');
          this.injectPuzzleUI();
          if (this.puzzleSelect) this.puzzleSelect.value = String(this.activePuzzleIndex);
          this.loadPuzzle(this.activePuzzleIndex);
        }
      }
    }
  }

  private resetGame() {
    this.chess.reset();
    // Remove existing piece meshes
    for (const [square, mesh] of this.squareToPiece) {
      this.boardGroup.remove(mesh);
      mesh.geometry.dispose();
      // Do not dispose material as it is shared among pieces types implicitly
    }
    this.squareToPiece.clear();
    this.selectedSquare = null;
    this.clearHighlights();
    this.buildAllPiecesFromGameState();
    this.modeManager.onReset();
    this.controlsTargetByTurn();
    this.updateStatus();
  }

  private buildAllPiecesFromGameState() {
    const board = this.chess.board();
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const cell = board[rank][file];
        if (!cell) continue;
        // chess.board() returns row 0 as rank 8 (top). Convert to algebraic rank number.
        const rankNumber = 8 - rank;
        const square = String.fromCharCode('a'.charCodeAt(0) + file) + String(rankNumber);
        const pieceType = cell.type as PieceType;
        const pieceColor = cell.color as PieceColor;
        const mesh = createPieceMesh(pieceType, pieceColor) as PieceMesh;
        mesh.userData.square = square;
        mesh.userData.type = pieceType;
        mesh.userData.color = pieceColor;
        const pos = squareToPosition(square);
        mesh.position.copy(pos);
        mesh.position.y = 0.05; // slightly above board
        this.boardGroup.add(mesh);
        this.squareToPiece.set(square, mesh);
      }
    }
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  private onPointerMove = (event: PointerEvent) => {
    this.updatePointerFromEvent(event);
    // Update hovered square and hover indicator
    const sq = this.pickSquareUnderPointer();
    this.setHoveredSquare(sq);
  };

  private onPointerDown = (event: PointerEvent) => {
    // Only handle primary button
    if (event.button !== 0) return;

    // Ensure pointer coords are up-to-date on click
    this.updatePointerFromEvent(event);

    // In puzzle mode, block further moves after solved/failed
    if (this.modeManager.currentMode === 'puzzles' && (this.puzzleSolved || this.puzzleFailed)) return;

    const clickedSquare = this.pickSquareUnderPointer();
    if (!clickedSquare) return;

    // In LAN mode, only allow selecting your own color to move
    if (this.isLanMode) {
      const turn = this.chess.turn() as PieceColor;
      if (turn !== this.myColor) return;
    }

    if (this.selectedSquare == null) {
      // Select if piece of side to move
      const piece = this.squareToPiece.get(clickedSquare);
      if (piece && piece.userData.color === this.chess.turn()) {
        this.selectSquare(clickedSquare);
      }
      return;
    }

    if (clickedSquare === this.selectedSquare) {
      this.clearSelection();
      return;
    }

    // If clicked contains a friendly piece, switch selection instead of attempting move
    const occupant = this.squareToPiece.get(clickedSquare);
    if (occupant && occupant.userData.color === this.chess.turn()) {
      this.selectSquare(clickedSquare);
      return;
    }

    // Try to move
    this.tryMove(this.selectedSquare, clickedSquare).catch(() => {});
  };

  private updatePointerFromEvent(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.pointer.x = x * 2 - 1;
    this.pointer.y = -(y * 2 - 1);
  }

  private selectSquare(square: string) {
    this.selectedSquare = square;
    this.highlightLegalMoves(square);
    // Move selection indicator
    if (this.selectionIndicator) {
      const p = squareToPosition(square);
      this.selectionIndicator.position.set(p.x, 0.003, p.z);
      this.selectionIndicator.visible = true;
    }
  }

  private clearSelection() {
    this.selectedSquare = null;
    this.clearHighlights();
    if (this.selectionIndicator) this.selectionIndicator.visible = false;
  }

  private clearHighlights() {
    for (const s of this.highlightedSquares) {
      const mesh = this.squareMeshes.find((m) => m.userData.square === s);
      if (mesh) {
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        material.emissive?.setHex(0x000000);
      }
    }
    this.highlightedSquares = [];
    this.moveTargetsBySquare.clear();

    // Remove legal move markers
    for (const m of this.legalMoveMarkers) {
      this.boardGroup.remove(m);
    }
    this.legalMoveMarkers = [];
    // Remove portal markers
    for (const m of this.portalMarkers) this.boardGroup.remove(m);
    this.portalMarkers = [];
  }

  private highlightLegalMoves(from: string) {
    this.clearHighlights();
    const verboseMoves = this.chess.moves({ square: from, verbose: true }) as Move[];
    this.moveTargetsBySquare.set(from, verboseMoves);
    for (const m of verboseMoves) {
      const square = m.to;
      const mesh = this.squareMeshes.find((sq) => sq.userData.square === square);
      if (mesh) {
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        material.emissive = new THREE.Color(0x2266aa);
        material.emissiveIntensity = 0.6;
        this.highlightedSquares.push(square);
      }

      // Add center dot marker
      const pos = squareToPosition(square);
      const isCapture = this.isCaptureMoveVerbose(m);
      const marker = new THREE.Mesh(this.getMarkerGeometry(), isCapture ? this.getMarkerMatCapture() : this.getMarkerMatQuiet());
      marker.position.set(pos.x, 0.008, pos.z);
      marker.rotation.x = 0; // cylinder stands upright
      // Make capture markers slightly larger
      if (isCapture) marker.scale.set(1.4, 1, 1.4);
      marker.renderOrder = 3;
      this.boardGroup.add(marker);
      this.legalMoveMarkers.push(marker);
    }
  }

  private pickSquareUnderPointer(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Combine pieces and squares so clicks on pieces work naturally
    const pieceMeshes: THREE.Object3D[] = Array.from(this.squareToPiece.values());
    const targets = [...pieceMeshes, ...this.squareMeshes];
    const intersections = this.raycaster.intersectObjects(targets, true);
    if (intersections.length === 0) return null;
    const hit = intersections[0];
    const square = hit.object.userData.square as string | undefined;
    return square ?? null;
  }

  private async tryMove(from: string, to: string): Promise<void> {
    try {
      const pendingPromotion = this.isPromotionMove(from, to);
      let promotion: 'q' | 'r' | 'b' | 'n' | undefined;
      if (pendingPromotion) {
        if (this.autoPromoteCheckbox.checked) {
          promotion = 'q';
        } else {
          promotion = await this.askPromotion();
        }
      }

      this.modeManager.beforeMove({ from, to, promotion });
      const move = this.chess.move({ from, to, promotion });
      if (!move) {
        // Illegal move
        this.flashStatus('Illegal move');
        return;
      }

      await this.syncMeshesWithMove(move as Move);
      this.modeManager.afterAppliedMove(move as Move);
      this.updatePortalMarkers();
      this.checkPuzzleProgress(move as Move);
      this.afterMoveUpdate();

      // Broadcast move in LAN mode
      if (this.isLanMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'move', gameId: this.gameId, move: { from, to, promotion }, fen: this.chess.fen() }));
      }
    } finally {
      this.clearSelection();
    }
  }

  private isPromotionMove(from: string, to: string): boolean {
    const piece = this.squareToPiece.get(from);
    if (!piece || piece.userData.type !== 'p') return false;
    const toRank = parseInt(to[1], 10);
    if (piece.userData.color === 'w' && toRank === 8) return true;
    if (piece.userData.color === 'b' && toRank === 1) return true;
    return false;
  }

  private askPromotion(): Promise<'q' | 'r' | 'b' | 'n'> {
    return new Promise((resolve, reject) => {
      this.promotionRequest = { from: this.selectedSquare!, to: '', resolve, reject } as PromotionRequest;
      this.showPromotionModal();
    });
  }

  private showPromotionModal() {
    this.promotionModal.classList.remove('hidden');
  }
  private hidePromotionModal() {
    this.promotionModal.classList.add('hidden');
  }

  private async syncMeshesWithMove(move: Move): Promise<void> {
    // Handle captures (including en passant)
    if ((move as any).captured) {
      const capturedSquare = this.getCapturedSquareFromMove(move);
      if (capturedSquare) {
        const capturedMesh = this.squareToPiece.get(capturedSquare);
        if (capturedMesh) {
          await this.animateCapture(capturedMesh);
          this.boardGroup.remove(capturedMesh);
          this.squareToPiece.delete(capturedSquare);
        }
      }
    }

    // Move the piece mesh
    const mover = this.squareToPiece.get(move.from);
    if (mover) {
      this.squareToPiece.delete(move.from);
      this.squareToPiece.set(move.to, mover);
      mover.userData.square = move.to;
      // Promotion visual: replace geometry if needed
      if ((move as any).promotion) {
        const newType = (move as any).promotion as PieceType;
        mover.userData.type = newType;
        // Swap geometry
        const clone = mover; // reuse mesh & material; swap geometry
        clone.geometry.dispose();
        clone.geometry = (createPieceMesh(newType, mover.userData.color) as THREE.Mesh).geometry;
      }

      await this.animatePieceMove(mover, move.to);
    }

    // Castling: the rook also moves
    if ((move.flags as string).includes('k') || (move.flags as string).includes('q')) {
      const rookFromTo = this.getCastlingRookMove(move);
      if (rookFromTo) {
        const rookMesh = this.squareToPiece.get(rookFromTo.from);
        if (rookMesh) {
          this.squareToPiece.delete(rookFromTo.from);
          this.squareToPiece.set(rookFromTo.to, rookMesh);
          rookMesh.userData.square = rookFromTo.to;
          await this.animatePieceMove(rookMesh, rookFromTo.to);
        }
      }
    }
    // Portal teleport visual if occurred
    const tp = consumeLastTeleport(this.modeManager);
    if (tp) {
      const mesh = this.squareToPiece.get(tp.to);
      if (mesh) {
        await this.animateTeleport(mesh as PieceMesh, tp);
      }
    }
  }

  private getCastlingRookMove(move: Move): { from: string; to: string } | null {
    if (move.piece !== 'k') return null;
    const isWhite = move.color === 'w';
    // Squares relative to ranks
    if (move.to[0] === 'g') {
      // king side
      return { from: isWhite ? 'h1' : 'h8', to: isWhite ? 'f1' : 'f8' };
    }
    if (move.to[0] === 'c') {
      // queen side
      return { from: isWhite ? 'a1' : 'a8', to: isWhite ? 'd1' : 'd8' };
    }
    return null;
  }

  private getCapturedSquareFromMove(move: Move): string | null {
    if ((move.flags as string).includes('e')) {
      // En passant captured pawn is behind the dest square
      const dir = move.color === 'w' ? -1 : 1;
      const file = move.to[0];
      const rank = parseInt(move.to[1], 10) + dir;
      return `${file}${rank}`;
    }
    return (move as any).captured ? move.to : null;
  }

  private animatePieceMove(mesh: PieceMesh, toSquare: string): Promise<void> {
    const toPos = squareToPosition(toSquare);
    toPos.y = mesh.position.y;
    const from = mesh.position.clone();
    const control = from.clone().lerp(toPos, 0.5);
    control.y += 0.35; // hop

    const durationMs = 180 + from.distanceTo(toPos) * 120;
    const start = performance.now();

    return new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        const t = Math.min(1, (now - start) / durationMs);
        // Quadratic Bezier
        const p0 = from; const p1 = control; const p2 = toPos;
        const a = new THREE.Vector3().copy(p0).multiplyScalar((1 - t) * (1 - t));
        const b = new THREE.Vector3().copy(p1).multiplyScalar(2 * (1 - t) * t);
        const c = new THREE.Vector3().copy(p2).multiplyScalar(t * t);
        mesh.position.copy(a.add(b).add(c));
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  private animateCapture(mesh: PieceMesh): Promise<void> {
    const start = performance.now();
    const durationMs = 200;
    const fromY = mesh.position.y;
    return new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / durationMs);
        mesh.scale.setScalar(1 - t);
        mesh.position.y = fromY + t * 0.5;
        if (t < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  private animateTeleport(mesh: PieceMesh, tp: { from: string; to: string }): Promise<void> {
    // Brief scale pulse and fade trail
    const start = performance.now();
    const duration = 220;
    const fromPos = squareToPosition(tp.from);
    const toPos = squareToPosition(tp.to);
    const trailGeom = new THREE.RingGeometry(0.15, 0.25, 24);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x8a2be2, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    const trail = new THREE.Mesh(trailGeom, trailMat);
    trail.rotation.x = -Math.PI / 2;
    trail.position.set(fromPos.x, 0.03, fromPos.z);
    this.boardGroup.add(trail);
    return new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        const s = 1 + Math.sin(t * Math.PI) * 0.25;
        mesh.scale.setScalar(s);
        trail.scale.setScalar(1 + t * 2);
        (trail.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
        if (t < 1) requestAnimationFrame(tick); else {
          mesh.scale.setScalar(1);
          this.boardGroup.remove(trail);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  private afterMoveUpdate() {
    this.updateStatus();
    if (!this.isLanMode) this.controlsTargetByTurn();
    // Sudden death banner
    if (this.modeManager.currentMode === 'sudden-death') {
      const winner = (this.chess as any)._suddenDeathWinner as ('w'|'b') | undefined;
      if (winner && this.bannerEl && this.bannerTextEl) {
        this.bannerTextEl.textContent = `Sudden Death — ${winner === 'w' ? 'White' : 'Black'} wins`;
        this.bannerEl.classList.remove('hidden');
      }
    }
  }

  private controlsTargetByTurn() {
    if (!this.flipOnTurnCheckbox.checked) return;
    const whiteToMove = this.chess.turn() === 'w';
    // Target angles: -PI/2 (behind White at z<0), +PI/2 (behind Black at z>0)
    const targetAngle = whiteToMove ? -Math.PI / 2 : Math.PI / 2;
    // Smooth rotate camera around board center, preserving height and horizontal radius
    const radius = Math.hypot(this.camera.position.x, this.camera.position.z);
    const height = this.camera.position.y;
    const startAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
    const start = performance.now();
    const duration = 300;
    const animate = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const currentAngle = startAngle + (targetAngle - startAngle) * t;
      this.camera.position.x = Math.cos(currentAngle) * radius;
      this.camera.position.z = Math.sin(currentAngle) * radius;
      this.camera.position.y = height;
      this.camera.lookAt(0, 0, 0);
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  private updateStatus() {
    const turn = this.chess.turn() === 'w' ? 'White' : 'Black';
    let msg = `${turn} to move`;
    if (this.chess.isCheckmate()) msg = `Checkmate! ${turn === 'White' ? 'Black' : 'White'} wins`;
    else if (this.chess.isStalemate()) msg = 'Stalemate';
    else if (this.chess.isDraw()) msg = 'Draw';
    else if (this.chess.inCheck()) msg = `${turn} is in check`;
    if (this.hoveredSquare) msg += `  •  Hover: ${this.hoveredSquare}`;
    if (this.isLanMode) msg += `  •  LAN (${this.myColor === 'w' ? 'White' : 'Black'})`;
    const extra = this.modeManager.getStatusExtra();
    if (extra) msg += `  •  ${extra}`;
    if (this.modeManager.currentMode === 'portal-rush') {
      const info = getPortalRerollInfo(this.modeManager);
      if (info) msg += `  •  Reroll in ${info.remainingPlies} plies`;
    }
    this.statusEl.textContent = msg;
  }

  private flashStatus(message: string) {
    this.statusEl.textContent = message;
    this.statusEl.classList.add('flash');
    setTimeout(() => {
      this.statusEl.classList.remove('flash');
      this.updateStatus();
    }, 800);
  }

  // ---------- LAN MODE ----------

  private createLanGame() {
    const id = Math.random().toString(36).slice(2, 8);
    this.joinLanGame(id);
  }

  private joinLanGame(id: string) {
    if (this.ws) this.ws.close();
    this.isLanMode = true;
    this.gameId = id;
    // Disable flip control in LAN mode
    this.flipOnTurnCheckbox.checked = false;
    (this.flipOnTurnCheckbox.parentElement as HTMLElement).classList.add('hidden');
    this.leaveLanBtn.classList.remove('hidden');
    this.createLanBtn.classList.add('hidden');

    const baseWs = this.serverUrlInput.value || (window.location.protocol === 'https:' ? 'wss://'+window.location.host : 'ws://'+window.location.host);
    const wsUrl = `${baseWs.replace(/\/$/, '')}/ws?game=${encodeURIComponent(id)}`;

    // Show shareable link in copy box, try to use LAN IP
    const shareUrl = `${window.location.protocol}//${window.location.host}/?mode=lan&game=${encodeURIComponent(id)}&server=${encodeURIComponent(baseWs)}`;
    this.lanLinkInput.value = shareUrl;
    this.lanShareSpan.classList.remove('hidden');

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.flashStatus('LAN connected');
      // Request current state explicitly
      this.ws!.send(JSON.stringify({ type: 'hello', gameId: id }));
    };
    this.ws.onclose = () => {
      this.flashStatus('LAN disconnected');
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.handleWsMessage(msg);
      } catch {}
    };
  }

  private leaveLanGame() {
    this.isLanMode = false;
    this.gameId = null;
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
    this.myColor = 'w';
    (this.flipOnTurnCheckbox.parentElement as HTMLElement).classList.remove('hidden');
    this.createLanBtn.classList.remove('hidden');
    this.leaveLanBtn.classList.add('hidden');
    this.lanShareSpan.classList.add('hidden');
    this.youAreSpan.classList.add('hidden');
    this.controlsTargetByTurn();
    this.updateStatus();
  }

  private handleWsMessage(msg: any) {
    switch (msg.type) {
      case 'assign': {
        this.myColor = msg.color as PieceColor;
        // Orient camera behind my color
        const angle = this.myColor === 'w' ? -Math.PI / 2 : Math.PI / 2;
        const radius = Math.hypot(this.camera.position.x, this.camera.position.z) || 10;
        const height = this.camera.position.y;
        this.camera.position.x = Math.cos(angle) * radius;
        this.camera.position.z = Math.sin(angle) * radius;
        this.camera.position.y = height;
        this.camera.lookAt(0, 0, 0);
        this.youAreSpan.textContent = this.myColor === 'w' ? 'You are White' : 'You are Black';
        this.youAreSpan.classList.remove('hidden');
        this.updateStatus();
        break;
      }
      case 'state': {
        const fen = msg.fen as string;
        if (fen) {
          // Rebuild from FEN
          this.chess.load(fen);
          this.resetMeshesToFen();
          this.updateStatus();
        }
        break;
      }
      case 'move': {
        const mv = msg.move as { from: string; to: string; promotion?: 'q'|'r'|'b'|'n' };
        // Apply if legal in current state
        const applied = this.chess.move(mv);
        if (applied) {
          // animate opponent move
          this.syncMeshesWithMove(applied as Move).then(() => this.afterMoveUpdate());
        }
        break;
      }
    }
  }

  private copyLanLink() {
    const text = this.lanLinkInput.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => this.flashStatus('Link copied'));
  }

  private getBestLanHost(): string {
    // Try to pick the first private IPv4 from the server if injected, otherwise current host
    // We allow server to inject window.__LAN_IP__ for better accuracy
    const injected = (window as any).__LAN_IP__ as string | undefined;
    if (injected) return injected;
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' ? h : h;
  }

  private resetMeshesToFen() {
    // Clear current meshes
    for (const [_, mesh] of this.squareToPiece) {
      this.boardGroup.remove(mesh);
    }
    this.squareToPiece.clear();
    this.buildAllPiecesFromGameState();
  }

  private createIndicators() {
    // Hover indicator (cyan)
    const hoverGeom = new THREE.PlaneGeometry(SQUARE_SIZE * 0.98, SQUARE_SIZE * 0.98);
    const hoverMat = new THREE.MeshBasicMaterial({ color: 0x44b5ff, transparent: true, opacity: 0.25, depthWrite: false });
    const hover = new THREE.Mesh(hoverGeom, hoverMat);
    hover.rotation.x = -Math.PI / 2;
    hover.position.y = 0.002;
    hover.visible = false;
    hover.renderOrder = 2;
    this.boardGroup.add(hover);
    this.hoverIndicator = hover;

    // Selection indicator (green)
    const selGeom = new THREE.PlaneGeometry(SQUARE_SIZE * 0.98, SQUARE_SIZE * 0.98);
    const selMat = new THREE.MeshBasicMaterial({ color: 0x41d66c, transparent: true, opacity: 0.22, depthWrite: false });
    const sel = new THREE.Mesh(selGeom, selMat);
    sel.rotation.x = -Math.PI / 2;
    sel.position.y = 0.003;
    sel.visible = false;
    sel.renderOrder = 2;
    this.boardGroup.add(sel);
    this.selectionIndicator = sel;

    // Shared marker resources
    this.markerGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24);
    this.markerMatQuiet = new THREE.MeshBasicMaterial({ color: 0x3aa3ff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    this.markerMatCapture = new THREE.MeshBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  }

  private setHoveredSquare(square: string | null) {
    this.hoveredSquare = square;
    if (!this.hoverIndicator) return;
    if (!square) {
      this.hoverIndicator.visible = false;
      this.updateStatus();
      return;
    }
    const pos = squareToPosition(square);
    this.hoverIndicator.position.set(pos.x, 0.002, pos.z);
    this.hoverIndicator.visible = true;
    this.updateStatus();
  }

  private getMarkerGeometry(): THREE.CylinderGeometry {
    return this.markerGeometry!;
  }
  private getMarkerMatQuiet(): THREE.MeshBasicMaterial {
    return this.markerMatQuiet!;
  }
  private getMarkerMatCapture(): THREE.MeshBasicMaterial {
    return this.markerMatCapture!;
  }

  private isCaptureMoveVerbose(m: Move): boolean {
    const flags = (m.flags as string) || '';
    return Boolean((m as any).captured) || flags.includes('c') || flags.includes('e');
  }

  private injectModeUI() {
    this.modeSelect = document.getElementById('modeSelect') as HTMLSelectElement | null;
    if (!this.modeSelect) return;
    this.modeSelect.innerHTML = '';
    for (const m of MODES) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      this.modeSelect.appendChild(opt);
    }
    this.modeSelect.value = 'classic';
    this.modeSelect.addEventListener('change', () => {
      const id = this.modeSelect!.value as ModeId;
      this.modeManager.init(id);
      this.resetGame();
      // Toggle puzzle bar visibility
      if (id === 'puzzles') {
        this.puzzleBar?.classList.remove('hidden');
        this.loadPuzzle(this.activePuzzleIndex);
      } else {
        this.puzzleBar?.classList.add('hidden');
      }
      this.updatePortalMarkers();
      this.updateUrlParams({ mode: id });
    });
  }

  private injectPuzzleUI() {
    this.puzzleBar = document.getElementById('puzzleBar');
    this.puzzleSelect = document.getElementById('puzzleSelect') as HTMLSelectElement | null;
    this.puzzleGoalSpan = document.getElementById('puzzleGoal') as HTMLSpanElement | null;
    this.puzzleNextBtn = document.getElementById('puzzleNextBtn') as HTMLButtonElement | null;
    this.puzzleResetBtn = document.getElementById('puzzleResetBtn') as HTMLButtonElement | null;
    this.puzzleAutoNextCheckbox = document.getElementById('puzzleAutoNext') as HTMLInputElement | null;
    if (!this.puzzleSelect || !this.puzzleBar) return;
    this.puzzleSelect.innerHTML = '';
    PUZZLES.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `${p.name}`;
      this.puzzleSelect!.appendChild(opt);
    });
    this.puzzleSelect.addEventListener('change', () => {
      const idx = parseInt(this.puzzleSelect!.value, 10) || 0;
      this.activePuzzleIndex = idx;
      this.loadPuzzle(idx);
      this.updateUrlParams({ puzzle: String(idx) });
    });
    this.puzzleNextBtn?.addEventListener('click', () => {
      const next = (this.activePuzzleIndex + 1) % PUZZLES.length;
      this.activePuzzleIndex = next;
      if (this.puzzleSelect) this.puzzleSelect.value = String(next);
      this.loadPuzzle(next);
      this.updateUrlParams({ puzzle: String(next) });
    });
    this.puzzleResetBtn?.addEventListener('click', () => {
      this.loadPuzzle(this.activePuzzleIndex);
    });
  }

  private loadPuzzle(index: number) {
    const p = PUZZLES[index];
    if (!p) return;
    this.chess.load(p.fen);
    this.resetMeshesToFen();
    this.puzzleSolverColor = p.sideToMove;
    this.puzzleGoalMoves = p.goal.moves;
    this.puzzleSolverMovesUsed = 0;
    this.puzzleSolved = false;
    this.puzzleFailed = false;
    this.updatePuzzleStatusUI();
    // Orient camera to side to move
    const angle = p.sideToMove === 'w' ? -Math.PI / 2 : Math.PI / 2;
    const radius = Math.hypot(this.camera.position.x, this.camera.position.z) || 10;
    const height = this.camera.position.y;
    this.camera.position.x = Math.cos(angle) * radius;
    this.camera.position.z = Math.sin(angle) * radius;
    this.camera.position.y = height;
    this.camera.lookAt(0, 0, 0);
    this.updateStatus();
    this.updatePortalMarkers();
  }

  private updatePortalMarkers() {
    // Clear existing
    for (const m of this.portalMarkers) this.boardGroup.remove(m);
    this.portalMarkers = [];
    if (this.modeManager.currentMode !== 'portal-rush') return;
    const portals = getPortalSquares(this.modeManager);
    if (!portals) return;
    const mk = (square: string, color: number) => {
      const geom = new THREE.TorusGeometry(0.4, 0.06, 12, 24);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(geom, mat);
      const pos = squareToPosition(square);
      mesh.position.set(pos.x, 0.02, pos.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 4;
      this.boardGroup.add(mesh);
      this.portalMarkers.push(mesh);
    };
    mk(portals.a, 0x8a2be2); // purple
    mk(portals.b, 0x20b2aa); // teal
  }

  private checkPuzzleProgress(applied: Move) {
    if (this.modeManager.currentMode !== 'puzzles') return;
    if (this.puzzleSolved || this.puzzleFailed) return;
    if (applied.color === this.puzzleSolverColor) this.puzzleSolverMovesUsed++;

    if (this.chess.isCheckmate()) {
      const deliveredBySolver = applied.color === this.puzzleSolverColor;
      if (deliveredBySolver && this.puzzleSolverMovesUsed <= this.puzzleGoalMoves) {
        this.puzzleSolved = true;
        this.flashStatus('Puzzle solved!');
        if (this.puzzleAutoNextCheckbox?.checked) {
          setTimeout(() => {
            const next = (this.activePuzzleIndex + 1) % PUZZLES.length;
            this.activePuzzleIndex = next;
            if (this.puzzleSelect) this.puzzleSelect.value = String(next);
            this.loadPuzzle(next);
            this.updateUrlParams({ puzzle: String(next) });
          }, 600);
        }
      } else {
        this.puzzleFailed = true;
        this.flashStatus('Puzzle failed');
      }
      this.updatePuzzleStatusUI();
      return;
    }
    if (this.puzzleSolverMovesUsed > this.puzzleGoalMoves) {
      this.puzzleFailed = true;
      this.flashStatus('Out of moves — puzzle failed');
      this.updatePuzzleStatusUI();
      return;
    }
    this.updatePuzzleStatusUI();
  }

  private updatePuzzleStatusUI() {
    if (!this.puzzleGoalSpan) return;
    const status = this.puzzleSolved ? ' — Solved!' : this.puzzleFailed ? ' — Failed' : '';
    this.puzzleGoalSpan.textContent = `Mate in ${this.puzzleGoalMoves} • Used ${this.puzzleSolverMovesUsed}/${this.puzzleGoalMoves}${status}`;
  }

  private hideBanner() {
    this.bannerEl?.classList.add('hidden');
  }

  private updateUrlParams(updates: Partial<{ mode: string; puzzle: string; game: string; server: string }>) {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    // Preserve server param if in LAN mode
    if (this.isLanMode && this.serverUrlInput?.value) params.set('server', this.serverUrlInput.value);
    window.history.replaceState({}, '', `${url.pathname}?${params.toString()}`);
  }

  private addCoordinateLabels() {
    if (this.coordLabelsGroup) {
      this.scene.remove(this.coordLabelsGroup);
      this.coordLabelsGroup = null;
    }
    const group = new THREE.Group();
    const font = new Font(helvetikerFontData);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb0b0b0, transparent: true, opacity: 0.85, depthTest: true });
    const size = 0.18;
    const bevel = false;
    const depth = 0.005;
    const files = 'abcdefgh';
    const offset = (SQUARE_SIZE * (8 - 1)) / 2 + SQUARE_SIZE * 0.62;
    for (let i = 0; i < 8; i++) {
      // files a..h on white’s side (negative Z)
      const fileChar = files[i];
      const geo = new TextGeometry(fileChar, { font, size, depth, bevelEnabled: bevel });
      const mesh = new THREE.Mesh(geo, mat);
      const x = (i - (8 - 1) / 2) * SQUARE_SIZE;
      mesh.position.set(x - size * 0.15, 0.02, -offset);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
    }
    for (let r = 0; r < 8; r++) {
      const label = String(r + 1);
      const geo = new TextGeometry(label, { font, size, depth, bevelEnabled: bevel });
      const mesh = new THREE.Mesh(geo, mat);
      const z = (r - (8 - 1) / 2) * SQUARE_SIZE;
      mesh.position.set(-offset, 0.02, z + size * 0.15);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
    }
    group.renderOrder = 2;
    this.scene.add(group);
    this.coordLabelsGroup = group;
  }
}

function bootstrap() {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  new Chess3DApp(canvas);
}

bootstrap();
