import { Chess, Move } from 'chess.js';

export type ModeId = 'classic' | 'portal-rush' | 'sudden-death' | 'puzzles';

export type ModeMeta = {
  id: ModeId;
  name: string;
  description: string;
};

export const MODES: ModeMeta[] = [
  { id: 'classic', name: 'Classic Chess', description: 'Standard rules' },
  { id: 'portal-rush', name: 'Portal Rush', description: 'Paired portals teleport pieces' },
  { id: 'sudden-death', name: 'Sudden Death', description: 'First capture wins' },
  { id: 'puzzles', name: 'Puzzles', description: 'Solve preset positions' },
];

export type ModeRuntime = {
  onReset?(chess: Chess): void;
  beforeMove?(chess: Chess, move: { from: string; to: string; promotion?: 'q'|'r'|'b'|'n' }): void;
  afterAppliedMove?(chess: Chess, applied: Move): void;
  getStatusExtra?(): string | null;
  dispose?(): void;
};

export class ModeManager {
  public currentMode: ModeId = 'classic';
  private runtime: ModeRuntime | null = null;
  private portals: { a: string; b: string } | null = null;
  private pliesSincePortal = 0;
  private suddenDeathActive = false;
  private chess: Chess;

  constructor(chess: Chess) {
    this.chess = chess;
  }

  init(mode: ModeId) {
    this.dispose();
    this.currentMode = mode;
    this.portals = null;
    this.pliesSincePortal = 0;
    this.suddenDeathActive = false;
    switch (mode) {
      case 'classic':
        this.runtime = {};
        break;
      case 'portal-rush':
        this.runtime = this.createPortalRush();
        break;
      case 'sudden-death':
        this.runtime = this.createSuddenDeath();
        break;
      case 'puzzles':
        this.runtime = {};
        break;
    }
    this.runtime.onReset?.(this.chess);
  }

  dispose() {
    this.runtime?.dispose?.();
    this.runtime = null;
  }

  onReset() {
    this.runtime?.onReset?.(this.chess);
  }

  beforeMove(move: { from: string; to: string; promotion?: 'q'|'r'|'b'|'n' }) {
    this.runtime?.beforeMove?.(this.chess, move);
  }

  afterAppliedMove(applied: Move) {
    this.runtime?.afterAppliedMove?.(this.chess, applied);
  }

  getStatusExtra(): string | null {
    return this.runtime?.getStatusExtra?.() ?? null;
  }

  private createPortalRush(): ModeRuntime {
    const chess = this.chess;
    const randPortalPair = () => {
      // Pick two empty squares randomly
      const empties: string[] = [];
      const files = 'abcdefgh';
      for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
        const s = files[f] + r;
        if (!chess.get(s as any)) empties.push(s);
      }
      if (empties.length < 2) return null as any;
      const ia = Math.floor(Math.random() * empties.length);
      let ib = Math.floor(Math.random() * empties.length);
      while (ib === ia) ib = Math.floor(Math.random() * empties.length);
      return { a: empties[ia], b: empties[ib] };
    };

    this.portals = randPortalPair();
    this.pliesSincePortal = 0;

    return {
      onReset: () => {
        this.portals = randPortalPair();
        this.pliesSincePortal = 0;
      },
      afterAppliedMove: (c, applied) => {
        this.pliesSincePortal++;
        // Teleport if landing on portal
        if (this.portals) {
          const { a, b } = this.portals;
          const landed = applied.to;
          let dest: string | null = null;
          if (landed === a) dest = b; else if (landed === b) dest = a;
          if (dest) {
            // Only allow teleport if dest is empty and piece is not a king.
            const pieceAt = c.get(landed as any);
            const isKing = pieceAt && (pieceAt as any).type === 'k';
            if (!isKing && !c.get(dest as any)) {
              const piece = c.remove(applied.to as any);
              if (piece) {
                c.put(piece, dest as any);
                // record last teleport so UI can animate
                (this as any)._lastTeleport = { from: applied.to, to: dest };
              }
            }
          }
        }
        // Reroll portals every 6 plies (3 moves)
        if (this.pliesSincePortal >= 6) {
          this.portals = randPortalPair();
          this.pliesSincePortal = 0;
        }
      },
      getStatusExtra: () => {
        if (!this.portals) return 'Portals: —';
        return `Portals: ${this.portals.a} ⇄ ${this.portals.b}`;
      },
    };
  }

  private createSuddenDeath(): ModeRuntime {
    this.suddenDeathActive = true;
    const chess = this.chess;
    return {
      afterAppliedMove: (c, applied) => {
        if ((applied as any).captured) {
          (chess as any)._suddenDeathWinner = applied.color;
        }
      },
      getStatusExtra: () => {
        const winner = (this.chess as any)._suddenDeathWinner as ('w'|'b') | undefined;
        return winner ? `Sudden Death — Winner: ${winner === 'w' ? 'White' : 'Black'}` : 'Sudden Death: first capture wins';
      },
    };
  }
}

export type PortalPair = { a: string; b: string } | null;

export function getPortalSquares(manager: ModeManager): PortalPair {
  // @ts-ignore - access private via any to expose
  const portals = (manager as any).portals as PortalPair;
  return portals ?? null;
}

export function consumeLastTeleport(manager: ModeManager): { from: string; to: string } | null {
  const anyMgr: any = manager as any;
  const tp = anyMgr._lastTeleport ?? null;
  anyMgr._lastTeleport = null;
  return tp;
}

export function getPortalRerollInfo(manager: ModeManager): { remainingPlies: number; intervalPlies: number } | null {
  const anyMgr: any = manager as any;
  if (anyMgr.currentMode !== 'portal-rush') return null;
  const used = anyMgr.pliesSincePortal ?? 0;
  const interval = 6;
  const remaining = Math.max(0, interval - used);
  return { remainingPlies: remaining, intervalPlies: interval };
}
