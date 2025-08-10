export function createModeRuntime(): {
  onReset?(chess: any): void;
  beforeMove?(
    chess: any,
    move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  ): void;
  afterAppliedMove?(chess: any, applied: any): void;
  getStatusExtra?(): string | null;
  dispose?(): void;
} {
  return {
    onReset(chess: any) {
      // no-op
    },
    beforeMove(
      chess: any,
      move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
    ) {
      // no-op
    },
    afterAppliedMove(chess: any, applied: any) {
      // no-op
    },
    getStatusExtra() {
      return "Hello minigame";
    },
    dispose() {
      // no-op
    },
  };
}