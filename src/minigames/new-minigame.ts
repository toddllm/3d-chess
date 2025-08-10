export function createModeRuntime(): {
  onReset?(chess: any): void;
  beforeMove?(chess: any, move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }): void;
  afterAppliedMove?(chess: any, applied: any): void;
  getStatusExtra?(): string | null;
  dispose?(): void;
} {
  // Map of portal square -> its paired square (bidirectional)
  const portals = new Map<string, string>();
  // Flag to avoid recursive teleport handling
  let isTeleporting = false;

  // Helper: simple Fisher‑Yates shuffle
  function shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // Create portal pairs on reset
  function generatePortals(chess: any): void {
    portals.clear();

    // chess.SQUARES is part of chess.js; fallback to a hard‑coded list if missing
    const allSquares: string[] = (chess.SQUARES as string[]) || [
      'a1','b1','c1','d1','e1','f1','g1','h1',
      'a2','b2','c2','d2','e2','f2','g2','h2',
      'a3','b3','c3','d3','e3','f3','g3','h3',
      'a4','b4','c4','d4','e4','f4','g4','h4',
      'a5','b5','c5','d5','e5','f5','g5','h5',
      'a6','b6','c6','d6','e6','f6','g6','h6',
      'a7','b7','c7','d7','e7','f7','g7','h7',
      'a8','b8','c8','d8','e8','f8','g8','h8',
    ];

    // Find squares that are currently empty
    const emptySquares = allSquares.filter((sq: string) => !chess.get(sq));

    // Choose an even number of portals (up to 4 pairs)
    const maxPairs = Math.min(4, Math.floor(emptySquares.length / 2));
    if (maxPairs === 0) return;

    shuffle(emptySquares);
    const selected = emptySquares.slice(0, maxPairs * 2);

    for (let i = 0; i < selected.length; i += 2) {
      const a = selected[i];
      const b = selected[i + 1];
      portals.set(a, b);
      portals.set(b, a);
    }
  }

  return {
    onReset(chess) {
      generatePortals(chess);
    },

    beforeMove(_chess, _move) {
      // No special pre‑move logic needed for Portal Rush
    },

    afterAppliedMove(chess, applied) {
      if (isTeleporting) return;

      const destSquare = applied?.to;
      if (!destSquare) return;

      const paired = portals.get(destSquare);
      if (!paired) return;

      // Remove the used portal pair
      portals.delete(destSquare);
      portals.delete(paired);

      // Perform the teleport as an additional move
      isTeleporting = true;
      // The teleport respects capture rules automatically
      chess.move({ from: destSquare, to: paired });
      isTeleporting = false;
    },

    getStatusExtra() {
      const remainingPairs = portals.size / 2;
      return remainingPairs > 0 ? `Portals left: ${remainingPairs}` : null;
    },

    dispose() {
      portals.clear();
      isTeleporting = false;
    },
  };
}