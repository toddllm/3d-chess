export type Puzzle = {
  id: string;
  name: string;
  fen: string;
  sideToMove: 'w' | 'b';
  goal: { type: 'mate-in'; moves: number };
};

export const PUZZLES: Puzzle[] = [
  {
    id: 'mate-in-1-1',
    name: 'Mate in 1 (Basic)',
    // White: Qh7# from standard-like setup (constructed)
    fen: '6k1/6pp/8/8/8/6P1/6K1/6Q1 w - - 0 1',
    sideToMove: 'w',
    goal: { type: 'mate-in', moves: 1 },
  },
  {
    id: 'mate-in-2-1',
    name: 'Mate in 2 (Classic motif)',
    // Simple composed position
    fen: '8/8/8/6k1/8/5Q2/6K1/6R1 w - - 0 1',
    sideToMove: 'w',
    goal: { type: 'mate-in', moves: 2 },
  },
  {
    id: 'mate-in-2-2',
    name: 'Mate in 2 (Back rank)',
    fen: '6k1/5ppp/8/8/8/8/5PPP/5RK1 w - - 0 1',
    sideToMove: 'w',
    goal: { type: 'mate-in', moves: 2 },
  },
];
