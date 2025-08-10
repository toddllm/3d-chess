export function createModeRuntime() {
  // Internal state for the Portal Rush mode
  const portalCount = 4; // number of portals on the board
  let portals: string[] = [];
  let initialized = false;

  // Utility: get all board squares (a1..h8)
  const allSquares = (() => {
    const files = ['a','b','c','d','e','f','g','h'];
    const ranks = ['1','2','3','4','5','6','7','8'];
    const squares: string[] = [];
    for (const r of ranks) {
      for (const f of files) {
        squares.push(f + r);
      }
    }
    return squares;
  })();

  // Pick N random empty squares from the current position
  function pickRandomEmptySquares(chess: any, n: number): string[] {
    const empty: string[] = [];
    for (const sq of allSquares) {
      if (!chess.get(sq)) empty.push(sq);
    }
    const result: string[] = [];
    while (result.length < n && empty.length > 0) {
      const idx = Math.floor(Math.random() * empty.length);
      result.push(empty.splice(idx, 1)[0]);
    }
    return result;
  }

  // Reset / (re)initialise portals whenever a new game starts
  function onReset(chess: any) {
    portals = pickRandomEmptySquares(chess, portalCount);
    initialized = true;
  }

  // After a legal move is applied, check for portal activation
  function afterAppliedMove(chess: any, applied: any) {
    if (!initialized) return;
    // If the piece landed on a portal, teleport it to another portal
    if (portals.includes(applied.to)) {
      const otherPortals = portals.filter(p => p !== applied.to);
      if (otherPortals.length === 0) return;

      const target = otherPortals[Math.floor(Math.random() * otherPortals.length)];

      // Capture any piece on the target square
      const captured = chess.remove(target);
      // Remove the piece that just moved onto the portal
      const piece = chess.remove(applied.to);
      if (piece) {
        // Place it on the target portal square
        chess.put(piece, target);
      }
      // Optional: you could store the capture information somewhere if needed
    }
  }

  // Show portal squares in the UI status bar
  function getStatusExtra() {
    if (!initialized) return null;
    return `Portals: ${portals.join(', ')}`;
  }

  // Clean‑up (not much to do here)
  function dispose() {
    portals = [];
    initialized = false;
  }

  return {
    onReset,
    afterAppliedMove,
    getStatusExtra,
    dispose,
  };
}