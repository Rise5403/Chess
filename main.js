/* ============================================================
   CHESS
   main.js — game engine + board interface

   Layout of this file:
     1. Board representation
     2. Move generation
     3. Attack + check detection
     4. Making and unmaking moves
     5. Game state (checkmate, stalemate, draws)
     6. Algebraic notation
     7. Piece artwork
     8. Interface

   The engine (sections 1–6) touches no HTML. It can be loaded
   in Node and tested on its own — see perft() at the bottom.
   ============================================================ */


/* ------------------------------------------------------------
   1. BOARD REPRESENTATION

   The board is a flat array of 64 slots, not an 8x8 grid of
   arrays. Slot 0 is a8 (top-left as White sees it) and slot 63
   is h1. A flat array makes "move two squares right" a matter
   of adding 2, which keeps move generation short.

   Each slot holds either null or a piece: { t, c }
     t = type:  p n b r q k
     c = colour: w b
   ------------------------------------------------------------ */

const FILES = "abcdefgh";

const row = (i) => (i >> 3);        // 0 = rank 8, 7 = rank 1
const col = (i) => (i & 7);         // 0 = file a, 7 = file h
const idx = (r, c) => r * 8 + c;
const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const squareName = (i) => FILES[col(i)] + (8 - row(i));

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function parseFEN(fen) {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  let i = 0;

  for (const ch of placement) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") {
      i += Number(ch);
    } else {
      board[i++] = {
        t: ch.toLowerCase(),
        c: ch === ch.toLowerCase() ? "b" : "w",
      };
    }
  }

  return {
    board,
    turn,
    castling: {
      wK: castle.includes("K"),
      wQ: castle.includes("Q"),
      bK: castle.includes("k"),
      bQ: castle.includes("q"),
    },
    // en passant target square, or null
    ep: ep === "-" ? null : idx(8 - Number(ep[1]), FILES.indexOf(ep[0])),
    half: Number(half),   // halfmove clock, for the 50-move rule
    full: Number(full),
  };
}

function cloneState(s) {
  return {
    board: s.board.slice(),
    turn: s.turn,
    castling: { ...s.castling },
    ep: s.ep,
    half: s.half,
    full: s.full,
  };
}

/* A compact string of everything that defines a position.
   Two positions with the same key are the same position for
   threefold-repetition purposes. */
function positionKey(s) {
  let out = "";
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    out += p ? (p.c === "w" ? p.t.toUpperCase() : p.t) : ".";
  }
  const c = s.castling;
  return out + s.turn +
    (c.wK ? "K" : "") + (c.wQ ? "Q" : "") +
    (c.bK ? "k" : "") + (c.bQ ? "q" : "") +
    ":" + (s.ep === null ? "-" : s.ep);
}


/* ------------------------------------------------------------
   2. MOVE GENERATION

   Two layers, and the distinction matters:

   Pseudo-legal — the piece moves that way. A bishop slides
   diagonally until something blocks it.

   Legal — pseudo-legal, and it does not leave your own king
   under attack. A pinned bishop still "moves diagonally"; it
   just is not allowed to.

   Generating pseudo-legal moves and then filtering is slower
   than generating only legal moves, but it is far harder to
   get wrong, and at human speeds the difference is invisible.
   ------------------------------------------------------------ */

const KNIGHT_HOPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const DIAGONALS   = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ORTHOGONALS = [[-1,0],[1,0],[0,-1],[0,1]];
const ALL_EIGHT   = DIAGONALS.concat(ORTHOGONALS);

/* A move is:
   { from, to, piece, captured, promo, castle, epCapture } */
function pseudoMoves(s, from) {
  const piece = s.board[from];
  if (!piece || piece.c !== s.turn) return [];

  const moves = [];
  const r = row(from), c = col(from);
  const me = piece.c;
  const them = me === "w" ? "b" : "w";

  const push = (to, extra = {}) =>
    moves.push({ from, to, piece: piece.t, captured: s.board[to]?.t ?? null, ...extra });

  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (onBoard(rr, cc)) {
        const to = idx(rr, cc);
        const occupant = s.board[to];
        if (!occupant) { push(to); }
        else { if (occupant.c === them) push(to); break; }
        rr += dr; cc += dc;
      }
    }
  };

  switch (piece.t) {
    case "p": {
      // White moves toward rank 8, which is a decreasing row index.
      const dir = me === "w" ? -1 : 1;
      const startRow = me === "w" ? 6 : 1;
      const promoRow = me === "w" ? 0 : 7;

      // one forward
      if (onBoard(r + dir, c) && !s.board[idx(r + dir, c)]) {
        const to = idx(r + dir, c);
        if (r + dir === promoRow) {
          for (const promo of ["q", "r", "b", "n"]) push(to, { promo });
        } else {
          push(to);
          // two forward, only from the starting rank and only
          // if both squares are empty
          if (r === startRow && !s.board[idx(r + 2 * dir, c)]) {
            push(idx(r + 2 * dir, c), { double: true });
          }
        }
      }

      // captures, including en passant
      for (const dc of [-1, 1]) {
        const rr = r + dir, cc = c + dc;
        if (!onBoard(rr, cc)) continue;
        const to = idx(rr, cc);
        const occupant = s.board[to];

        if (occupant && occupant.c === them) {
          if (rr === promoRow) {
            for (const promo of ["q", "r", "b", "n"]) push(to, { promo });
          } else push(to);
        } else if (to === s.ep && !occupant) {
          // The captured pawn is beside us, not on the target square.
          push(to, { epCapture: idx(r, cc), captured: "p" });
        }
      }
      break;
    }

    case "n":
      for (const [dr, dc] of KNIGHT_HOPS) {
        const rr = r + dr, cc = c + dc;
        if (!onBoard(rr, cc)) continue;
        const occupant = s.board[idx(rr, cc)];
        if (!occupant || occupant.c === them) push(idx(rr, cc));
      }
      break;

    case "b": slide(DIAGONALS); break;
    case "r": slide(ORTHOGONALS); break;
    case "q": slide(ALL_EIGHT); break;

    case "k": {
      for (const [dr, dc] of ALL_EIGHT) {
        const rr = r + dr, cc = c + dc;
        if (!onBoard(rr, cc)) continue;
        const occupant = s.board[idx(rr, cc)];
        if (!occupant || occupant.c === them) push(idx(rr, cc));
      }

      // Castling. Three conditions, all easy to forget:
      //   the king is not currently in check,
      //   the squares it passes through are not attacked,
      //   the squares between king and rook are empty.
      const homeRow = me === "w" ? 7 : 0;
      const rights = me === "w"
        ? { short: s.castling.wK, long: s.castling.wQ }
        : { short: s.castling.bK, long: s.castling.bQ };

      if (r === homeRow && c === 4 && !isAttacked(s, from, them)) {
        if (rights.short &&
            !s.board[idx(homeRow, 5)] && !s.board[idx(homeRow, 6)] &&
            !isAttacked(s, idx(homeRow, 5), them) &&
            !isAttacked(s, idx(homeRow, 6), them)) {
          push(idx(homeRow, 6), { castle: "K" });
        }
        if (rights.long &&
            !s.board[idx(homeRow, 3)] && !s.board[idx(homeRow, 2)] &&
            !s.board[idx(homeRow, 1)] &&
            !isAttacked(s, idx(homeRow, 3), them) &&
            !isAttacked(s, idx(homeRow, 2), them)) {
          push(idx(homeRow, 2), { castle: "Q" });
        }
      }
      break;
    }
  }

  return moves;
}


/* ------------------------------------------------------------
   3. ATTACK AND CHECK DETECTION

   Rather than generating every enemy move and asking whether
   any lands here, we look outward from the square itself and
   ask what we run into. Fewer squares examined, and the logic
   reads as a checklist.
   ------------------------------------------------------------ */

function isAttacked(s, sq, byColour) {
  const r = row(sq), c = col(sq);
  const B = s.board;

  // knights
  for (const [dr, dc] of KNIGHT_HOPS) {
    const rr = r + dr, cc = c + dc;
    if (!onBoard(rr, cc)) continue;
    const p = B[idx(rr, cc)];
    if (p && p.c === byColour && p.t === "n") return true;
  }

  // pawns — a white pawn attacks upward, so it sits one row below
  const pawnRow = byColour === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (!onBoard(pawnRow, c + dc)) continue;
    const p = B[idx(pawnRow, c + dc)];
    if (p && p.c === byColour && p.t === "p") return true;
  }

  // king (adjacent)
  for (const [dr, dc] of ALL_EIGHT) {
    const rr = r + dr, cc = c + dc;
    if (!onBoard(rr, cc)) continue;
    const p = B[idx(rr, cc)];
    if (p && p.c === byColour && p.t === "k") return true;
  }

  // sliding pieces
  const rays = [
    { dirs: DIAGONALS,   hits: ["b", "q"] },
    { dirs: ORTHOGONALS, hits: ["r", "q"] },
  ];
  for (const { dirs, hits } of rays) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (onBoard(rr, cc)) {
        const p = B[idx(rr, cc)];
        if (p) {
          if (p.c === byColour && hits.includes(p.t)) return true;
          break; // any piece blocks the ray
        }
        rr += dr; cc += dc;
      }
    }
  }

  return false;
}

function findKing(s, colour) {
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p && p.t === "k" && p.c === colour) return i;
  }
  return -1;
}

function inCheck(s, colour) {
  const k = findKing(s, colour);
  return k >= 0 && isAttacked(s, k, colour === "w" ? "b" : "w");
}


/* ------------------------------------------------------------
   4. MAKING MOVES
   ------------------------------------------------------------ */

function applyMove(s, mv) {
  const next = cloneState(s);
  const B = next.board;
  const me = s.turn;
  const homeRow = me === "w" ? 7 : 0;

  const moving = B[mv.from];
  B[mv.from] = null;

  if (mv.epCapture !== undefined) B[mv.epCapture] = null;

  B[mv.to] = mv.promo ? { t: mv.promo, c: me } : moving;

  // The rook jumps over the king when castling.
  if (mv.castle === "K") {
    B[idx(homeRow, 5)] = B[idx(homeRow, 7)];
    B[idx(homeRow, 7)] = null;
  } else if (mv.castle === "Q") {
    B[idx(homeRow, 3)] = B[idx(homeRow, 0)];
    B[idx(homeRow, 0)] = null;
  }

  // Castling rights are lost permanently once the king or the
  // relevant rook moves — or once that rook is captured on its
  // home square, which is the case people forget.
  if (moving.t === "k") {
    if (me === "w") { next.castling.wK = next.castling.wQ = false; }
    else { next.castling.bK = next.castling.bQ = false; }
  }
  const clearRookRight = (sq) => {
    if (sq === idx(7, 0)) next.castling.wQ = false;
    if (sq === idx(7, 7)) next.castling.wK = false;
    if (sq === idx(0, 0)) next.castling.bQ = false;
    if (sq === idx(0, 7)) next.castling.bK = false;
  };
  clearRookRight(mv.from);
  clearRookRight(mv.to);

  // En passant is available for exactly one move.
  next.ep = mv.double ? idx((row(mv.from) + row(mv.to)) / 2, col(mv.from)) : null;

  // The 50-move clock resets on a pawn move or a capture.
  next.half = (moving.t === "p" || mv.captured) ? 0 : s.half + 1;
  if (me === "b") next.full = s.full + 1;
  next.turn = me === "w" ? "b" : "w";

  return next;
}

function legalMoves(s, from) {
  return pseudoMoves(s, from).filter(mv => !inCheck(applyMove(s, mv), s.turn));
}

function allLegalMoves(s) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p && p.c === s.turn) out.push(...legalMoves(s, i));
  }
  return out;
}


/* ------------------------------------------------------------
   5. GAME STATE
   ------------------------------------------------------------ */

function insufficientMaterial(s) {
  const pieces = [];
  for (let i = 0; i < 64; i++) if (s.board[i]) pieces.push({ ...s.board[i], i });

  const nonKings = pieces.filter(p => p.t !== "k");
  if (nonKings.length === 0) return true;                       // K v K
  if (nonKings.length === 1 && "nb".includes(nonKings[0].t)) return true;  // K+N or K+B

  // K+B v K+B with both bishops on the same colour complex
  if (nonKings.length === 2 && nonKings.every(p => p.t === "b")) {
    const sameColourSquare =
      (row(nonKings[0].i) + col(nonKings[0].i)) % 2 ===
      (row(nonKings[1].i) + col(nonKings[1].i)) % 2;
    if (sameColourSquare) return true;
  }
  return false;
}

/* history = array of position keys already reached */
function gameStatus(s, history = []) {
  const moves = allLegalMoves(s);
  const check = inCheck(s, s.turn);

  if (moves.length === 0) {
    return check
      ? { over: true, result: s.turn === "w" ? "0-1" : "1-0",
          reason: "checkmate", winner: s.turn === "w" ? "b" : "w" }
      : { over: true, result: "½-½", reason: "stalemate" };
  }
  if (s.half >= 100) return { over: true, result: "½-½", reason: "fifty-move rule" };
  if (insufficientMaterial(s)) return { over: true, result: "½-½", reason: "insufficient material" };

  const key = positionKey(s);
  if (history.filter(k => k === key).length >= 3) {
    return { over: true, result: "½-½", reason: "threefold repetition" };
  }

  return { over: false, check, moves };
}


/* ------------------------------------------------------------
   6. ALGEBRAIC NOTATION

   Nf3, exd5, O-O, Qh4+, e8=Q#. The fiddly part is
   disambiguation: if two knights can reach f3, the notation
   must say which one, by file if that is enough, otherwise by
   rank, otherwise by both.
   ------------------------------------------------------------ */

function toAlgebraic(s, mv) {
  if (mv.castle === "K") return decorate("O-O");
  if (mv.castle === "Q") return decorate("O-O-O");

  const letter = mv.piece === "p" ? "" : mv.piece.toUpperCase();
  let disambig = "";

  if (mv.piece !== "p") {
    const rivals = [];
    for (let i = 0; i < 64; i++) {
      if (i === mv.from) continue;
      const p = s.board[i];
      if (p && p.c === s.turn && p.t === mv.piece) {
        if (legalMoves(s, i).some(m => m.to === mv.to)) rivals.push(i);
      }
    }
    if (rivals.length) {
      const sameFile = rivals.some(i => col(i) === col(mv.from));
      const sameRank = rivals.some(i => row(i) === row(mv.from));
      if (!sameFile) disambig = FILES[col(mv.from)];
      else if (!sameRank) disambig = String(8 - row(mv.from));
      else disambig = squareName(mv.from);
    }
  }

  // A pawn capture always names its file of origin: exd5.
  const capture = mv.captured ? (mv.piece === "p" ? FILES[col(mv.from)] : "") + "x" : "";
  const promo = mv.promo ? "=" + mv.promo.toUpperCase() : "";

  return decorate(letter + disambig + capture + squareName(mv.to) + promo);

  function decorate(base) {
    const after = applyMove(s, mv);
    if (!inCheck(after, after.turn)) return base;
    return base + (allLegalMoves(after).length === 0 ? "#" : "+");
  }
}


/* ------------------------------------------------------------
   7. PIECE ARTWORK

   Silhouettes from Font Awesome Free (CC BY 4.0). Each glyph
   has its own viewBox, so they are stored as { vb, d } and the
   colour is applied in CSS rather than baked into the path.
   ------------------------------------------------------------ */

const ART = {
  p: { vb: "0 0 320 512", d: "M215.5 224c29.2-18.4 48.5-50.9 48.5-88c0-57.4-46.6-104-104-104S56 78.6 56 136c0 37.1 19.4 69.6 48.5 88H96c-17.7 0-32 14.3-32 32c0 16.5 12.5 30 28.5 31.8L80 400H240L227.5 287.8c16-1.8 28.5-15.3 28.5-31.8c0-17.7-14.3-32-32-32h-8.5zM22.6 473.4c-4.2 4.2-6.6 10-6.6 16C16 501.9 26.1 512 38.6 512H281.4c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L256 432H64L22.6 473.4z" },
  r: { vb: "0 0 448 512", d: "M32 192V48c0-8.8 7.2-16 16-16h64c8.8 0 16 7.2 16 16V88c0 4.4 3.6 8 8 8h32c4.4 0 8-3.6 8-8V48c0-8.8 7.2-16 16-16h64c8.8 0 16 7.2 16 16V88c0 4.4 3.6 8 8 8h32c4.4 0 8-3.6 8-8V48c0-8.8 7.2-16 16-16h64c8.8 0 16 7.2 16 16V192c0 10.1-4.7 19.6-12.8 25.6L352 256l16 144H80L96 256 44.8 217.6C36.7 211.6 32 202.1 32 192zm176 96h32c8.8 0 16-7.2 16-16V224c0-17.7-14.3-32-32-32s-32 14.3-32 32v48c0 8.8 7.2 16 16 16zM22.6 473.4L64 432H384l41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6H38.6C26.1 512 16 501.9 16 489.4c0-6 2.4-11.8 6.6-16z" },
  n: { vb: "0 0 448 512", d: "M96 48L82.7 61.3C70.7 73.3 64 89.5 64 106.5V238.9c0 10.7 5.3 20.7 14.2 26.6l10.6 7c14.3 9.6 32.7 10.7 48.1 3l3.2-1.6c2.6-1.3 5-2.8 7.3-4.5l49.4-37c6.6-5 15.7-5 22.3 0c10.2 7.7 9.9 23.1-.7 30.3L90.4 350C73.9 361.3 64 380 64 400H384l28.9-159c2.1-11.3 3.1-22.8 3.1-34.3V192C416 86 330 0 224 0H83.8C72.9 0 64 8.9 64 19.8c0 7.5 4.2 14.3 10.9 17.7L96 48zm24 68a20 20 0 1 1 40 0 20 20 0 1 1 -40 0zM22.6 473.4c-4.2 4.2-6.6 10-6.6 16C16 501.9 26.1 512 38.6 512H409.4c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L384 432H64L22.6 473.4z" },
  b: { vb: "0 0 320 512", d: "M128 0C110.3 0 96 14.3 96 32c0 16.1 11.9 29.4 27.4 31.7C78.4 106.8 8 190 8 288c0 47.4 30.8 72.3 56 84.7V400H256V372.7c25.2-12.5 56-37.4 56-84.7c0-37.3-10.2-72.4-25.3-104.1l-99.4 99.4c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L270.8 154.6c-23.2-38.1-51.8-69.5-74.2-90.9C212.1 61.4 224 48.1 224 32c0-17.7-14.3-32-32-32H128zM48 432L6.6 473.4c-4.2 4.2-6.6 10-6.6 16C0 501.9 10.1 512 22.6 512H297.4c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16L272 432H48z" },
  k: { vb: "0 0 448 512", d: "M224 0c17.7 0 32 14.3 32 32V48h16c17.7 0 32 14.3 32 32s-14.3 32-32 32H256v48H408c22.1 0 40 17.9 40 40c0 5.3-1 10.5-3.1 15.4L368 400H80L3.1 215.4C1 210.5 0 205.3 0 200c0-22.1 17.9-40 40-40H192V112H176c-17.7 0-32-14.3-32-32s14.3-32 32-32h16V32c0-17.7 14.3-32 32-32zM38.6 473.4L80 432H368l41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6H54.6C42.1 512 32 501.9 32 489.4c0-6 2.4-11.8 6.6-16z" },
  q: { vb: "0 0 512 512", d: "M256 0a56 56 0 1 1 0 112A56 56 0 1 1 256 0zM134.1 143.8c3.3-13 15-23.8 30.2-23.8c12.3 0 22.6 7.2 27.7 17c12 23.2 36.2 39 64 39s52-15.8 64-39c5.1-9.8 15.4-17 27.7-17c15.3 0 27 10.8 30.2 23.8c7 27.8 32.2 48.3 62.1 48.3c10.8 0 21-2.7 29.8-7.4c8.4-4.4 18.9-4.5 27.6 .9c13 8 17.1 25 9.2 38L399.7 400H384 343.6 168.4 128 112.3L5.4 223.6c-7.9-13-3.8-30 9.2-38c8.7-5.3 19.2-5.3 27.6-.9c8.9 4.7 19 7.4 29.8 7.4c29.9 0 55.1-20.5 62.1-48.3zM256 224l0 0 0 0h0zM112 432H400l41.4 41.4c4.2 4.2 6.6 10 6.6 16c0 12.5-10.1 22.6-22.6 22.6H86.6C74.1 512 64 501.9 64 489.4c0-6 2.4-11.8 6.6-16L112 432z" },
};

const NAMES = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function pieceSVG(type, colour) {
  const { vb, d } = ART[type];
  return `<svg class="piece piece--${colour}" viewBox="${vb}" role="img"
    aria-label="${colour === "w" ? "White" : "Black"} ${NAMES[type]}"
    preserveAspectRatio="xMidYMid meet"><path d="${d}"/></svg>`;
}


/* ------------------------------------------------------------
   TESTING HOOK

   perft counts every legal move sequence to a given depth. The
   counts from the starting position are published and exact, so
   if these match, move generation is correct — including the
   awkward cases (en passant, castling through check, promotion).
   ------------------------------------------------------------ */

function perft(s, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const mv of allLegalMoves(s)) total += perft(applyMove(s, mv), depth - 1);
  return total;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseFEN, applyMove, allLegalMoves, legalMoves, perft,
    inCheck, gameStatus, toAlgebraic, squareName, START_FEN, positionKey,
  };
}


/* ============================================================
   8. INTERFACE

   Everything below touches the page. It is wrapped so the file
   can still be loaded in Node for testing.
   ============================================================ */

if (typeof document !== "undefined") {
document.addEventListener("DOMContentLoaded", () => {

  const boardEl = document.querySelector(".board");
  if (!boardEl) return;   // page has no board — nothing to do

  const statusEl    = document.querySelector("[data-status]");
  const movesEl     = document.querySelector("[data-moves]");
  const takenWhite  = document.querySelector("[data-taken-white]");
  const takenBlack  = document.querySelector("[data-taken-black]");
  const promoEl     = document.querySelector("[data-promotion]");
  const promoChoice = document.querySelector("[data-promotion-choices]");

  let state, history, moveLog, selected, legal, lastMove, flipped, pendingPromo;

  function newGame() {
    state = parseFEN(START_FEN);
    history = [positionKey(state)];
    moveLog = [];
    selected = null;
    legal = [];
    lastMove = null;
    pendingPromo = null;
    flipped = false;
    render();
  }

  /* ---- drawing ---- */

  function render() {
    drawBoard();
    drawMoves();
    drawTaken();
    drawStatus();
  }

  function drawBoard() {
    const status = gameStatus(state, history);
    const checkedKing = status.check || (status.reason === "checkmate")
      ? findKing(state, state.turn) : -1;

    boardEl.innerHTML = "";
    boardEl.classList.toggle("board--flipped", flipped);

    const order = [...Array(64).keys()];
    if (flipped) order.reverse();

    for (const i of order) {
      const sq = document.createElement("button");
      sq.type = "button";
      sq.className = "square";
      sq.dataset.index = i;

      // (row + col) even => light square. a1 must be dark.
      sq.classList.add((row(i) + col(i)) % 2 === 0 ? "square--light" : "square--dark");

      if (i === selected) sq.classList.add("is-selected");
      if (lastMove && (i === lastMove.from || i === lastMove.to)) sq.classList.add("is-last");
      if (i === checkedKing) sq.classList.add("is-check");

      const target = legal.find(m => m.to === i);
      if (target) sq.classList.add(target.captured ? "is-capture" : "is-move");

      const p = state.board[i];
      if (p) {
        sq.innerHTML = pieceSVG(p.t, p.c);
        sq.setAttribute("aria-label", `${squareName(i)}, ${p.c === "w" ? "White" : "Black"} ${NAMES[p.t]}`);
      } else {
        sq.setAttribute("aria-label", squareName(i));
      }

      // Coordinates on the outer edge only, as on a real board.
      const edgeRow = flipped ? 0 : 7;
      const edgeCol = flipped ? 7 : 0;
      if (row(i) === edgeRow) sq.dataset.file = FILES[col(i)];
      if (col(i) === edgeCol) sq.dataset.rank = 8 - row(i);

      sq.addEventListener("click", () => onSquare(i));
      boardEl.appendChild(sq);
    }
  }

  function drawStatus() {
    const status = gameStatus(state, history);
    const mover = state.turn === "w" ? "White" : "Black";

    if (status.over) {
      let text;
      if (status.reason === "checkmate") {
        text = `Checkmate. ${status.winner === "w" ? "White" : "Black"} wins.`;
      } else if (status.reason === "stalemate") {
        text = "Stalemate. The game is drawn.";
      } else {
        text = `Draw by ${status.reason}.`;
      }
      statusEl.textContent = text;
      statusEl.dataset.tone = status.reason === "checkmate" ? "win" : "draw";
    } else if (status.check) {
      statusEl.textContent = `${mover} is in check.`;
      statusEl.dataset.tone = "check";
    } else {
      statusEl.textContent = `${mover} to move.`;
      statusEl.dataset.tone = "normal";
    }
  }

  function drawMoves() {
    movesEl.innerHTML = "";
    if (!moveLog.length) {
      movesEl.innerHTML = `<p class="moves__empty">Moves appear here as you play.</p>`;
      return;
    }
    const list = document.createElement("ol");
    list.className = "moves__list";
    for (let i = 0; i < moveLog.length; i += 2) {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="moves__white">${moveLog[i]}</span>` +
        `<span class="moves__black">${moveLog[i + 1] ?? ""}</span>`;
      list.appendChild(li);
    }
    movesEl.appendChild(list);
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  function drawTaken() {
    // Work out what is missing from a full set, rather than
    // tracking captures as they happen — fewer places to go wrong.
    const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const live = { w: { p:0,n:0,b:0,r:0,q:0 }, b: { p:0,n:0,b:0,r:0,q:0 } };
    for (const p of state.board) if (p && p.t !== "k") live[p.c][p.t]++;

    let scoreW = 0, scoreB = 0;
    const build = (colour, el) => {
      let html = "";
      for (const t of ["q", "r", "b", "n", "p"]) {
        const gone = Math.max(0, full[t] - live[colour][t]);
        for (let i = 0; i < gone; i++) html += pieceSVG(t, colour);
        if (colour === "w") scoreB += gone * VALUE[t]; else scoreW += gone * VALUE[t];
      }
      el.innerHTML = html;
    };
    build("b", takenWhite);   // pieces White has captured are Black pieces
    build("w", takenBlack);

    const edge = scoreW - scoreB;
    takenWhite.dataset.edge = edge > 0 ? `+${edge}` : "";
    takenBlack.dataset.edge = edge < 0 ? `+${-edge}` : "";
  }

  /* ---- interaction ---- */

  function onSquare(i) {
    if (pendingPromo) return;
    if (gameStatus(state, history).over) return;

    const target = legal.find(m => m.to === i);
    if (target) {
      const promoOptions = legal.filter(m => m.to === i && m.promo);
      if (promoOptions.length) askPromotion(promoOptions);
      else commit(target);
      return;
    }

    const p = state.board[i];
    if (p && p.c === state.turn) {
      selected = (selected === i) ? null : i;
      legal = selected === null ? [] : legalMoves(state, selected);
    } else {
      selected = null;
      legal = [];
    }
    drawBoard();
  }

  function commit(mv) {
    moveLog.push(toAlgebraic(state, mv));
    state = applyMove(state, mv);
    history.push(positionKey(state));
    lastMove = mv;
    selected = null;
    legal = [];
    render();
  }

  function askPromotion(options) {
    pendingPromo = options;
    promoChoice.innerHTML = "";
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "promotion__option";
      btn.innerHTML = pieceSVG(opt.promo, state.turn) +
        `<span>${NAMES[opt.promo]}</span>`;
      btn.addEventListener("click", () => {
        promoEl.hidden = true;
        pendingPromo = null;
        commit(opt);
      });
      promoChoice.appendChild(btn);
    }
    promoEl.hidden = false;
    promoChoice.querySelector("button").focus();
  }

  /* ---- controls ---- */

  document.querySelector("[data-new]")?.addEventListener("click", newGame);

  document.querySelector("[data-flip]")?.addEventListener("click", () => {
    flipped = !flipped;
    drawBoard();
  });

  document.querySelector("[data-undo]")?.addEventListener("click", () => {
    if (!moveLog.length) return;
    // Replay from the start. Slower than storing snapshots, but
    // there is exactly one source of truth for the position.
    const log = moveLog.slice(0, -1);
    state = parseFEN(START_FEN);
    history = [positionKey(state)];
    moveLog = [];
    lastMove = null;
    for (const san of log) {
      const mv = allLegalMoves(state).find(m => toAlgebraic(state, m) === san);
      if (!mv) break;
      moveLog.push(san);
      state = applyMove(state, mv);
      history.push(positionKey(state));
      lastMove = mv;
    }
    selected = null;
    legal = [];
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!promoEl.hidden) { promoEl.hidden = true; pendingPromo = null; }
      selected = null; legal = []; drawBoard();
    }
  });

  newGame();
});
}
