'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const ES = require('./public/es.js');

const PORT = +process.env.PORT || 3000;
const FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const TS = +process.env.TIME_SCALE || 1; // solo para pruebas: acorta los tiempos
const MAX_PLAYERS = 12, MAX_STRIKES = 3, BUZZ_MS = 20000 * TS, FO_MS = 15000 * TS, ANS_MS = 25000 * TS, FM_MS = 20000 * TS, FM_GOAL = 200, FM_BONUS = 50;
const now = () => Date.now();
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);
if (process.argv.includes('--nuevo')) fs.rmSync(FILE, { force: true });

// ---------- Estado (memoria + JSON) ----------
const newGame = () => ({ phase: 'lobby', feud: null, fm: null, dinner: false, story: null });
const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
let S = null;
try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
if (!S || !S.code) S = { code: genCode(), players: [], game: newGame() };
if (process.env.ROOM_CODE) S.code = process.env.ROOM_CODE.toUpperCase();

let saveT;
const saveNow = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(S)); fs.renameSync(FILE + '.tmp', FILE); };
const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 150); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });

// ---------- Texto: normalización y comparación de respuestas ----------
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // sin acentos, ñ -> n
const words = s => {
  const w = fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (w.length > 1 && ARTICLES.has(w[0])) w.shift();
  return w;
};
// Formas posibles del singular: "papas"->"papa", "tamales"->"tamal", "postres"->"postre".
const forms = w => {
  const c = new Set([w]);
  if (w.length > 3 && w.endsWith('s')) c.add(w.slice(0, -1));
  if (w.length > 4 && w.endsWith('es')) c.add(w.slice(0, -2));
  return c;
};
const sameW = (a, b) => { const x = forms(a); return [...forms(b)].some(y => x.has(y)); };
const same = (a, b) => a.length === b.length && a.every((w, i) => sameW(w, b[i]));
const hasRun = (g, f) => { for (let i = 0; i + f.length <= g.length; i++) if (f.every((w, k) => sameW(g[i + k], w))) return true; return false; };

// Busca qué respuesta del tablero es la que escribió el jugador (exacta primero, luego "contiene").
// shortcut: las frases se comparan palabra por palabra; si un invitado dice algo raro, el anfitrión lo acredita a mano.
function matchAnswer(Q, text) {
  const g = words(text);
  const keys = Q[1].map(a => [a[0], ...(a[2] || [])].map(words).filter(x => x.length));
  let i = keys.findIndex(ks => ks.some(f => same(g, f)));
  if (i < 0) i = keys.findIndex(ks => ks.some(f => (f.length > 1 || f[0].length >= 4) && hasRun(g, f)));
  return i;
}

const clean = (s, max) => {
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  return [...s].length > max ? null : s;
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle([...a]).slice(0, n);

// ---------- Jugadores ----------
const byId = id => S.players.find(p => p.id === id);
const total = p => p.pts.encuesta + p.pts.misiones + p.pts.historia;
let wss;
const online = id => [...wss.clients].some(c => c.pid === id && c.readyState === 1);
const other = t => (t === 'h' ? 'm' : 'h');
function assignMissions(p) {
  const M = ES.misionesLista;
  const l = [...pick(M.facil, 1).map(t => [t, 10]), ...pick(M.media, 2).map(t => [t, 20]), ...pick(M.dificil, 1).map(t => [t, 30])];
  p.missions = l.map(([text, pts], id) => ({ id, text, pts, status: 'open', witness: null }));
}

// ---------- Duelo familiar (reglas de Family Feud; la computadora es el presentador) ----------
const Qof = f => ES.preguntas[f.order[f.round]];
const multOf = f => (f.round < 2 ? 1 : f.round === 2 ? 2 : 3); // rondas 1-2 ×1, 3 ×2, 4 en adelante ×3
const members = t => S.players.filter(p => p.team === t);
const teamNow = f => (f.stage === 'steal' ? other(f.control) : f.control);

// Cara a cara: toma un integrante de cada equipo (rota por todos, saltando a quien está desconectado).
function pickMember(f, t) {
  const m = members(t), n = m.length;
  for (let k = 0; k < n; k++) { const i = (f.foIdx[t] + k) % n; if (online(m[i].id)) { f.foIdx[t] = i + 1; return m[i]; } }
  const i = f.foIdx[t] % n; f.foIdx[t] = i + 1; return m[i];
}
function newPair(f) { f.pair = { h: pickMember(f, 'h').id, m: pickMember(f, 'm').id }; f.stage = 'buzz'; f.fo = {}; f.deadline = now() + BUZZ_MS; f.seq++; }
function startRound(f) {
  const Q = Qof(f);
  Object.assign(f, { control: null, winner: null, strikes: 0, bank: 0, revealed: Q[1].map(() => false), by: Q[1].map(() => null), last: null, result: null });
  newPair(f);
}
// Jugando o robando: rota por el equipo en orden, saltando a quien está desconectado.
function actor(f) {
  const t = teamNow(f), m = members(t), n = m.length;
  if (!n) return null;
  for (let k = 0; k < n; k++) { const i = (f.turn[t] + k) % n; if (online(m[i].id)) return { p: m[i], i: f.turn[t] + k, t }; }
  return { p: m[f.turn[t] % n], i: f.turn[t], t };
}
// Quién puede contestar o decidir en este momento.
function who(f) {
  const s = f.stage;
  if (s === 'fo1') return byId(f.fo.first.pid);
  if (s === 'fo2') return byId(f.pair[other(f.fo.first.team)]);
  if (s === 'choose') return byId(f.pair[f.winner]);
  if (s === 'play' || s === 'steal') { const a = actor(f); return a && a.p; }
  return null;
}
function reveal(f, idx, p) {
  f.revealed[idx] = true; f.by[idx] = p.id;
  const pts = Qof(f)[1][idx][1];
  f.bank += pts; p.pts.encuesta += pts * multOf(f);
}
function endRound(f, winner) {
  const pts = f.bank * multOf(f); // solo valen las respuestas que salieron en el tablero
  f.score[winner] += pts; f.result = { winner, pts }; f.stage = 'done'; f.deadline = null;
}
function win(f, team) { f.winner = team; f.stage = 'choose'; f.deadline = now() + FO_MS; }
function startPlay(f, control) {
  f.control = control; f.stage = 'play'; f.strikes = 0; f.deadline = now() + ANS_MS;
  for (const t of ['h', 'm']) f.turn[t] = members(t).findIndex(x => x.id === f.pair[t]) + 1; // sigue el compañero de quien hizo el cara a cara
  f.seq++;
}
// Aplica una respuesta (o el tiempo agotado, idx = -1) según la etapa.
function judge(f, p, text, idx) {
  const phase = f.stage, hit = idx >= 0;
  f.last = { pid: p.id, text, hit, idx, phase };
  f.seq++;
  if (hit) reveal(f, idx, p);
  if (phase === 'fo1') {
    f.fo.first.idx = idx;
    if (idx === 0) win(f, f.fo.first.team); else { f.stage = 'fo2'; f.deadline = now() + FO_MS; }
  } else if (phase === 'fo2') {
    const a = f.fo.first.idx;
    if (hit && (a < 0 || idx < a)) win(f, p.team); // respuesta más popular = número más bajo en el tablero
    else if (a >= 0) win(f, f.fo.first.team);
    else newPair(f); // ninguno acertó: otros dos jugadores
  } else if (phase === 'steal') endRound(f, hit ? other(f.control) : f.control);
  else if (hit) { if (f.revealed.every(Boolean)) endRound(f, f.control); else f.deadline = now() + ANS_MS; }
  else if (++f.strikes >= MAX_STRIKES) { f.stage = 'steal'; f.deadline = now() + ANS_MS; }
  else f.deadline = now() + ANS_MS;
}

// ---------- Ronda relámpago (Fast Money) ----------
const fmQ = fm => ES.preguntas[fm.order[fm.q]];
const fmPid = (fm, t, s) => fm.pl[t][s % fm.pl[t].length]; // con un solo jugador, él da las dos respuestas
function startFM(G) {
  const f = G.feud, s = f.score, teams = s.h === s.m ? ['m', 'h'] : [s.h > s.m ? 'h' : 'm'];
  const used = new Set(f.order), order = shuffle([...ES.preguntas.keys()].filter(i => !used.has(i))).slice(0, 5);
  const pl = {};
  for (const t of teams) { const m = members(t), on = m.filter(x => online(x.id)); pl[t] = pick(on.length >= 2 ? on : m, 2).map(x => x.id); }
  G.fm = { teams, ti: 0, pl, order, q: 0, s: 0, ans: Object.fromEntries(teams.map(t => [t, order.map(() => [null, null])])), stage: 'play', seq: 0, deadline: now() + FM_MS, reveal: 0 };
  G.phase = 'fastmoney';
}
function fmRecord(fm, text, idx) {
  const t = fm.teams[fm.ti], pts = idx >= 0 ? fmQ(fm)[1][idx][1] : 0;
  fm.ans[t][fm.q][fm.s] = { text, idx, pts };
  if (++fm.s >= 2) { fm.s = 0; if (++fm.q >= 5) { fm.q = 0; if (++fm.ti >= fm.teams.length) { fm.stage = 'reveal'; fm.reveal = 0; } } }
  fm.seq++; fm.deadline = fm.stage === 'play' ? now() + FM_MS : null;
}
const fmTotal = (fm, t) => fm.ans[t].reduce((x, r) => x + r.reduce((y, a) => y + (a ? a.pts : 0), 0), 0);
function finishFM(fm) {
  if (fm.stage === 'done') return;
  fm.stage = 'done'; fm.total = {}; fm.win = {};
  const bonus = new Set();
  for (const t of fm.teams) {
    fm.total[t] = fmTotal(fm, t); fm.win[t] = fm.total[t] >= FM_GOAL;
    fm.ans[t].forEach(r => r.forEach((a, s) => { if (a) byId(fmPid(fm, t, s)).pts.encuesta += a.pts; }));
    if (fm.win[t]) fm.pl[t].forEach(id => bonus.add(id));
  }
  bonus.forEach(id => { byId(id).pts.encuesta += FM_BONUS; });
}

// Temporizador del presentador: si alguien no actúa a tiempo, se aplica el tiempo agotado.
let timer;
function onTimeout() {
  const G = S.game;
  if (G.phase === 'fastmoney' && G.fm.stage === 'play') return fmRecord(G.fm, ES.duelo.sinRespuesta, -1);
  if (G.phase !== 'feud') return;
  const f = G.feud, s = f.stage;
  if (s === 'buzz') newPair(f);
  else if (s === 'choose') startPlay(f, f.winner);
  else if (s !== 'done') {
    const p = who(f);
    if (!p) return endRound(f, f.control || 'm');
    if (s === 'play' || s === 'steal') { const a = actor(f); f.turn[a.t] = a.i + 1; }
    judge(f, p, ES.duelo.sinRespuesta, -1);
  }
}
function arm() {
  clearTimeout(timer);
  const G = S.game;
  const dl = G.phase === 'feud' ? G.feud.deadline : G.phase === 'fastmoney' ? G.fm.deadline : null;
  if (!dl) return;
  timer = setTimeout(() => { try { onTimeout(); save(); broadcast(); arm(); } catch (e) { console.error(e); } }, Math.max(0, dl - now()));
}

function feudView(p, G) {
  const f = G.feud, Q = Qof(f), done = f.stage === 'done', w = who(f), last = f.last;
  const slots = Q[1].map((x, i) => (f.revealed[i] || done
    ? { label: x[0], pts: x[1], found: f.revealed[i], by: f.by[i] ? byId(f.by[i]).name : null } : {}));
  const canJudge = p.host && last && !last.hit && last.pid !== p.id && (last.phase === 'play' || last.phase === 'steal') &&
    (f.stage === 'play' || f.stage === 'steal' || (f.stage === 'done' && last.phase === 'steal'));
  const pr = t => { const q = byId(f.pair[t]); return { id: q.id, name: q.name }; };
  return {
    round: f.round + 1, total: f.total, mult: multOf(f), question: Q[0], slots, strikes: f.strikes, bank: f.bank,
    control: f.control, stage: f.stage, score: f.score, seq: f.seq, result: f.result, deadline: f.deadline,
    pair: { h: pr('h'), m: pr('m') }, first: f.fo && f.fo.first ? { name: byId(f.fo.first.pid).name, team: f.fo.first.team } : null,
    winner: f.winner,
    active: w ? { id: w.id, name: w.name, team: w.team } : null,
    last: last ? { name: byId(last.pid).name, text: last.text, hit: last.hit, label: last.hit ? Q[1][last.idx][0] : null, pts: last.hit ? Q[1][last.idx][1] : null, rank: last.hit ? last.idx + 1 : null } : null,
    judge: canJudge ? Q[1].map((x, i) => ({ idx: i, label: x[0] })).filter(x => !f.revealed[x.idx]) : null,
  };
}
function fmView() {
  const fm = S.game.fm, play = fm.stage === 'play', t = fm.teams[fm.ti];
  const pn = id => byId(id).name;
  const rows = fm.stage === 'play' ? null : fm.teams.map((tm, ti) => {
    let run = 0;
    const lines = fm.order.map((qi, q) => ({ question: ES.preguntas[qi][0], a: [0, 1].map(s => {
      const a = fm.ans[tm][q][s], u = ti * 10 + q * 2 + s;
      if (!(fm.stage === 'done' || u < fm.reveal)) return null;
      run += a.pts; return { text: a.text, pts: a.pts };
    }) }));
    return { team: tm, lines, total: run };
  });
  return {
    stage: fm.stage, teams: fm.teams, deadline: fm.deadline, seq: fm.seq, q: fm.q + 1, s: fm.s, goal: FM_GOAL, bonus: FM_BONUS,
    team: play ? t : null, question: play ? fmQ(fm)[0] : null,
    active: play ? { id: fmPid(fm, t, fm.s), name: pn(fmPid(fm, t, fm.s)), team: t } : null,
    players: Object.fromEntries(fm.teams.map(x => [x, fm.pl[x].map(pn)])),
    rows, win: fm.stage === 'done' ? fm.win : null, units: fm.teams.length * 10, revealN: fm.reveal,
  };
}

// ---------- Vista personalizada para cada jugador ----------
function view(p) {
  const G = S.game;
  const v = {
    t: 'state', code: S.code, me: { id: p.id, name: p.name, host: p.host, team: p.team }, phase: G.phase, dinner: G.dinner,
    players: S.players.map(q => ({ id: q.id, name: q.name, host: q.host, team: q.team, online: online(q.id), pts: q.pts, total: total(q) })),
    missions: p.missions.map(m => ({ id: m.id, text: m.text, pts: m.pts, status: m.status, witness: m.witness })),
    toConfirm: [],
  };
  for (const q of S.players) for (const m of q.missions)
    if (m.status === 'pending' && m.witness === p.id) v.toConfirm.push({ claimer: q.id, name: q.name, mission: m.id, text: m.text, pts: m.pts });
  v.now = now();
  if (G.phase === 'feud') v.feud = feudView(p, G);
  if (G.phase === 'fastmoney') v.fm = fmView();
  if (G.phase === 'feud_done') { v.feudScore = G.feud.score; if (G.fm && G.fm.stage === 'done') v.fm = fmView(); }
  const st = G.story;
  if (G.phase === 'story_write') {
    const N = st.order.length, i = st.order.indexOf(p.id);
    const waiting = st.order.filter((pid, k) => st.stories[(k + st.round) % N].lines.length <= st.round).map(pid => byId(pid).name);
    if (i < 0) v.story = { espectador: true, waiting };
    else {
      const s = st.stories[(i + st.round) % N], last = s.lines[s.lines.length - 1];
      v.story = { round: st.round + 1, total: N, first: st.round === 0, prev: st.round === 0 ? s.starter : last.text, done: s.lines.length > st.round, waiting };
    }
  }
  if (G.phase === 'story_vote') {
    const s = st.stories[st.idx], rev = st.revealed[st.idx], votes = st.votes[st.idx];
    v.vote = {
      idx: st.idx + 1, total: st.order.length, starter: s.starter, revealed: rev, my: votes[p.id] ?? null,
      voted: Object.keys(votes).length,
      lines: s.lines.map((l, i) => ({
        i, text: l.text, mine: l.pid === p.id,
        ...(rev ? { author: l.pid ? byId(l.pid).name : null, votes: Object.values(votes).filter(x => x === i).length } : {}),
      })),
    };
  }
  return v;
}
const screenView = () => ({ ...view({ id: '_', name: '', host: false, team: null, missions: [] }), screen: true });

function broadcast() {
  let sv;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (ws.screen) ws.send(JSON.stringify(sv ||= screenView()));
    else { const p = ws.pid && byId(ws.pid); if (p) ws.send(JSON.stringify(view(p))); }
  }
}
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const err = (ws, key) => { send(ws, { t: 'error', key }); return false; };

// Valida texto de jugador: devuelve el texto limpio o false (y avisa del error).
function txt(ws, s, max) {
  const t = clean(s, max);
  if (t === null) return err(ws, 'respuestaLarga');
  if (!t || !words(t).length) return err(ws, 'respuestaVacia');
  return t;
}

// ---------- Acciones ----------
const HOST = new Set(['startFeud', 'credit', 'skipTurn', 'repeatFaceoff', 'nextRound', 'fmReveal', 'fmRevealAll', 'fmDone', 'startDinner', 'startStory', 'forceRound', 'revealVotes', 'nextStory', 'endGame', 'resetGame']);

function advanceStory(st, G) {
  if (!st.stories.every(s => s.lines.length > st.round)) return;
  st.round++;
  if (st.round >= st.order.length) { G.phase = 'story_vote'; st.idx = 0; }
}

const H = {
  startFeud(ws, p, m) {
    const G = S.game;
    if (!['h', 'm'].every(t => S.players.some(x => x.team === t))) return err(ws, 'faltaEquipo');
    const total = Math.min(Math.max(Math.round(+m.rounds) || 4, 3), Math.min(8, ES.preguntas.length - 5));
    const f = G.feud = { order: shuffle([...ES.preguntas.keys()]).slice(0, total), round: 0, total, seq: 0, foIdx: { h: 0, m: 0 }, turn: { h: 0, m: 0 }, score: { h: 0, m: 0 } };
    G.fm = null;
    startRound(f);
    G.phase = 'feud';
  },
  // Cara a cara: el primero en tocar el botón responde primero.
  buzz(ws, p) {
    const G = S.game, f = G.feud;
    if (G.phase !== 'feud' || f.stage !== 'buzz' || ![f.pair.h, f.pair.m].includes(p.id)) return err(ws, 'faseIncorrecta');
    f.fo = { first: { pid: p.id, team: p.team } }; f.stage = 'fo1'; f.deadline = now() + FO_MS; f.seq++;
  },
  // El equipo que ganó el cara a cara decide si juega o pasa.
  choose(ws, p, m) {
    const G = S.game, f = G.feud;
    if (G.phase !== 'feud' || f.stage !== 'choose' || f.pair[f.winner] !== p.id) return err(ws, 'noTuTurno');
    startPlay(f, m.play === false ? other(f.winner) : f.winner);
  },
  answer(ws, p, m) {
    const G = S.game;
    if (G.phase === 'fastmoney') {
      const fm = G.fm, t = fm.teams[fm.ti];
      if (fm.stage !== 'play' || fmPid(fm, t, fm.s) !== p.id) return err(ws, 'noTuTurno');
      if (m.seq !== fm.seq) return err(ws, 'yaEnviado');
      const x = txt(ws, m.text, 40);
      if (x === false) return;
      const idx = matchAnswer(fmQ(fm), x), prev = fm.s === 1 ? fm.ans[t][fm.q][0] : null;
      if (prev && (idx >= 0 ? prev.idx === idx : same(words(prev.text), words(x)))) return err(ws, 'repetida'); // el compañero ya dijo eso
      return fmRecord(fm, x, idx);
    }
    const f = G.feud;
    if (G.phase !== 'feud' || !['fo1', 'fo2', 'play', 'steal'].includes(f.stage)) return err(ws, 'faseIncorrecta');
    const w = who(f);
    if (!w || w.id !== p.id) return err(ws, 'noTuTurno');
    if (m.seq !== f.seq) return err(ws, 'yaEnviado'); // doble toque tardío
    const t = txt(ws, m.text, 40);
    if (t === false) return;
    const idx = matchAnswer(Qof(f), t);
    if (idx >= 0 && f.revealed[idx]) return err(ws, 'yaSalio');
    if (f.stage === 'play' || f.stage === 'steal') { const a = actor(f); f.turn[a.t] = a.i + 1; }
    judge(f, p, t, idx);
  },
  // El anfitrión acepta la última respuesta fallida como una de las del tablero.
  credit(ws, p, m) {
    const G = S.game, f = G.feud, l = f && f.last;
    if (G.phase !== 'feud' || !l || l.hit || l.pid === p.id || !Number.isInteger(m.idx) || !Qof(f)[1][m.idx] || f.revealed[m.idx]) return err(ws, 'faseIncorrecta');
    const who = byId(l.pid);
    if (l.phase === 'play' && f.stage !== 'done') { f.strikes--; f.stage = 'play'; f.deadline = now() + ANS_MS; reveal(f, m.idx, who); if (f.revealed.every(Boolean)) endRound(f, f.control); }
    else if (l.phase === 'steal' && f.stage === 'done') { f.score[f.control] -= f.result.pts; reveal(f, m.idx, who); endRound(f, other(f.control)); }
    else return err(ws, 'faseIncorrecta');
    l.hit = true; l.idx = m.idx; f.seq++;
  },
  skipTurn(ws) {
    const G = S.game, f = G.feud, a = G.phase === 'feud' && ['play', 'steal'].includes(f.stage) && actor(f);
    if (!a) return err(ws, 'faseIncorrecta');
    f.turn[a.t] = a.i + 1; f.deadline = now() + ANS_MS; f.seq++;
  },
  repeatFaceoff(ws) {
    const G = S.game, f = G.feud;
    if (G.phase !== 'feud' || !['buzz', 'fo1', 'fo2', 'choose'].includes(f.stage)) return err(ws, 'faseIncorrecta');
    newPair(f);
  },
  nextRound(ws) {
    const G = S.game, f = G.feud;
    if (G.phase !== 'feud' || f.stage !== 'done') return err(ws, 'faseIncorrecta');
    if (++f.round >= f.total) startFM(G); else startRound(f);
  },
  fmReveal(ws) {
    const fm = S.game.fm;
    if (S.game.phase !== 'fastmoney' || fm.stage !== 'reveal') return err(ws, 'faseIncorrecta');
    if (++fm.reveal >= fm.teams.length * 10) finishFM(fm);
  },
  fmRevealAll(ws) {
    const fm = S.game.fm;
    if (S.game.phase !== 'fastmoney' || fm.stage !== 'reveal') return err(ws, 'faseIncorrecta');
    fm.reveal = fm.teams.length * 10; finishFM(fm);
  },
  fmDone(ws) {
    const G = S.game;
    if (G.phase !== 'fastmoney' || G.fm.stage !== 'done') return err(ws, 'faseIncorrecta');
    G.phase = 'feud_done';
  },
  startDinner() {
    const G = S.game;
    G.dinner = true;
    S.players.forEach(p => { if (!p.missions.length) assignMissions(p); });
    G.phase = 'dinner';
  },
  claim(ws, p, m) {
    const mi = p.missions[m.mission], w = byId(m.witness);
    if (!mi || mi.status !== 'open') return err(ws, 'faseIncorrecta');
    if (!w || w.id === p.id) return err(ws, 'testigoInvalido');
    mi.status = 'pending'; mi.witness = w.id;
  },
  cancelClaim(ws, p, m) {
    const mi = p.missions[m.mission];
    if (!mi || mi.status !== 'pending') return err(ws, 'faseIncorrecta');
    mi.status = 'open'; mi.witness = null;
  },
  confirm(ws, p, m) {
    const c = byId(m.claimer), mi = c && c.missions[m.mission];
    if (!mi || mi.status !== 'pending' || mi.witness !== p.id) return err(ws, 'faseIncorrecta');
    if (m.ok) { mi.status = 'done'; c.pts.misiones += mi.pts; } else { mi.status = 'open'; mi.witness = null; }
  },
  startStory(ws) {
    const G = S.game, order = S.players.map(p => p.id), N = order.length;
    if (N < 2) return err(ws, 'pocosJugadores');
    const starters = []; while (starters.length < N) starters.push(...shuffle([...ES.historias]));
    G.story = { order, round: 0, idx: 0, stories: order.map((_, i) => ({ starter: starters[i], lines: [] })), votes: order.map(() => ({})), revealed: order.map(() => false) };
    G.phase = 'story_write';
  },
  sentence(ws, p, m) {
    const G = S.game, st = G.story;
    if (G.phase !== 'story_write') return err(ws, 'faseIncorrecta');
    if (m.round !== st.round) return err(ws, 'yaEnviado'); // doble toque tardío: no cuenta para la ronda siguiente
    const i = st.order.indexOf(p.id);
    if (i < 0) return err(ws, 'faseIncorrecta');
    const s = st.stories[(i + st.round) % st.order.length];
    if (s.lines.length > st.round) return err(ws, 'yaEnviado');
    const t = txt(ws, m.text, 60);
    if (t === false) return;
    s.lines.push({ pid: p.id, text: t });
    advanceStory(st, G);
  },
  forceRound(ws) {
    const G = S.game, st = G.story;
    if (G.phase !== 'story_write') return err(ws, 'faseIncorrecta');
    st.order.forEach((pid, k) => { const s = st.stories[(k + st.round) % st.order.length]; if (s.lines.length <= st.round) s.lines.push({ pid, text: null }); });
    advanceStory(st, G);
  },
  vote(ws, p, m) {
    const G = S.game, st = G.story;
    if (G.phase !== 'story_vote' || st.revealed[st.idx]) return err(ws, 'faseIncorrecta');
    const l = st.stories[st.idx].lines[m.i];
    if (!l || l.text === null) return err(ws, 'votoInvalido');
    if (l.pid === p.id) return err(ws, 'votoPropio');
    st.votes[st.idx][p.id] = m.i;
  },
  revealVotes(ws) {
    const G = S.game, st = G.story;
    if (G.phase !== 'story_vote' || st.revealed[st.idx]) return err(ws, 'faseIncorrecta');
    st.revealed[st.idx] = true;
    for (const li of Object.values(st.votes[st.idx])) { const a = st.stories[st.idx].lines[li].pid; if (a) byId(a).pts.historia += 10; }
  },
  nextStory(ws) {
    const G = S.game, st = G.story;
    if (G.phase !== 'story_vote' || !st.revealed[st.idx]) return err(ws, 'faseIncorrecta');
    if (++st.idx >= st.order.length) { G.phase = 'lobby'; G.story = null; }
  },
  endGame() { S.game.phase = 'end'; },
  resetGame() {
    S.players.forEach(p => { p.pts = { encuesta: 0, misiones: 0, historia: 0 }; p.missions = []; });
    S.game = newGame();
  },
};

function join(ws, m) {
  const name = clean(m.name, 16), code = String(m.code || '').trim().toUpperCase();
  if (!name) return err(ws, 'nombreVacio');
  if (code !== S.code) return err(ws, 'codigoMal');
  const key = fold(name).replace(/\s+/g, '');
  let p = S.players.find(x => x.key === key);
  if (p) { if (online(p.id)) return err(ws, 'nombreUso'); } // si está desconectado, se recupera su lugar
  else {
    if (!['h', 'm'].includes(m.team)) return err(ws, 'equipoVacio');
    if (S.players.length >= MAX_PLAYERS) return err(ws, 'salaLlena');
    p = { id: 'p' + (S.players.length + 1), token: crypto.randomBytes(16).toString('hex'), name, key, team: m.team, host: !S.players.length, pts: { encuesta: 0, misiones: 0, historia: 0 }, missions: [] };
    S.players.push(p);
    if (S.game.dinner) assignMissions(p);
  }
  ws.pid = p.id;
  send(ws, { t: 'joined', token: p.token });
  return true;
}

function dispatch(ws, m) {
  if (m.t === 'screen') { ws.screen = true; return send(ws, screenView()); }
  if (m.t === 'join') { if (join(ws, m)) { save(); broadcast(); } return; }
  if (m.t === 'auth') {
    const p = S.players.find(x => x.token === m.token);
    if (!p) return send(ws, { t: 'badtoken' });
    ws.pid = p.id; broadcast(); return;
  }
  const p = ws.pid && byId(ws.pid);
  if (!p) return send(ws, { t: 'badtoken' });
  if (!Object.hasOwn(H, m.t)) return;
  if (HOST.has(m.t) && !p.host) return err(ws, 'soloAnfitrion');
  H[m.t](ws, p, m);
  save(); broadcast(); arm();
}

// Si el servidor se reinició a media ronda, los relojes empiezan de nuevo.
if (S.game.feud && S.game.feud.deadline) S.game.feud.deadline = now() + ANS_MS;
if (S.game.fm && S.game.fm.deadline) S.game.fm.deadline = now() + FM_MS;

// ---------- Servidor ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/info', (_, res) => res.json({ code: S.code, urls: Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`) }));
// Solo para la página de prueba (/prueba.html): activa con ENABLE_TEST=1; en producción no existe.
if (process.env.ENABLE_TEST) app.post('/reset-prueba', (_, res) => { S.players = []; S.game = newGame(); for (const c of wss.clients) c.pid = null; save(); res.sendStatus(204); });
app.get('/pantalla', (_, res) => res.sendFile(path.join(__dirname, 'public', 'pantalla.html')));
const server = http.createServer(app);
wss = new WebSocketServer({ server, maxPayload: 8192 });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { dispatch(ws, m); } catch (e) { console.error(e); err(ws, 'generico'); }
  });
  ws.on('close', broadcast); // actualiza los puntitos de "sin conexión"
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 25000);

server.listen(PORT, '0.0.0.0', () => {
  arm();
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  ${ES.titulo}\n  Código de sala: ${S.code}\n`);
  for (const ip of ips) console.log(`  Teléfonos:  http://${ip}:${PORT}/?c=${S.code}`);
  console.log(`  Pantalla principal (en esta computadora): http://localhost:${PORT}/pantalla\n`);
});
