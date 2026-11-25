'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const ES = require('./public/es.js');

const PORT = +process.env.PORT || 3000;
const FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const MAX_PLAYERS = 12, NPROMPTS = 6;
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);
if (process.argv.includes('--nuevo')) fs.rmSync(FILE, { force: true });

// ---------- Estado (memoria + JSON) ----------
const newGame = () => ({ phase: 'lobby', prompts: [...ES.encuesta.prompts], survey: {}, guess: null, dinner: false, story: null });
const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
let S = null;
try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
if (!S || !S.code) S = { code: genCode(), players: [], game: newGame() };
if (process.env.ROOM_CODE) S.code = process.env.ROOM_CODE.toUpperCase();

let saveT;
const saveNow = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(S)); fs.renameSync(FILE + '.tmp', FILE); };
const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 150); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });

// ---------- Texto: normalización y agrupación de respuestas ----------
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
const same = (a, b) => a.length === b.length && a.every((w, i) => { const x = forms(w); return [...forms(b[i])].some(y => x.has(y)); });
// shortcut: agrupación voraz (no transitiva), suficiente para 8 personas; usar clustering real si crece.
function cluster(list) {
  const cl = [];
  for (const a of list) {
    const w = words(a), c = cl.find(c => same(c.w, w));
    if (c) c.count++; else cl.push({ w, label: a, count: 1 });
  }
  return cl.sort((a, b) => b.count - a.count);
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
function assignMissions(p) {
  const M = ES.misionesLista;
  const l = [...pick(M.facil, 1).map(t => [t, 10]), ...pick(M.media, 2).map(t => [t, 20]), ...pick(M.dificil, 1).map(t => [t, 30])];
  p.missions = l.map(([text, pts], id) => ({ id, text, pts, status: 'open', witness: null }));
}

// ---------- Vista personalizada para cada jugador ----------
function view(p) {
  const G = S.game;
  const v = {
    t: 'state', code: S.code, me: { id: p.id, name: p.name, host: p.host }, phase: G.phase, dinner: G.dinner,
    players: S.players.map(q => ({ id: q.id, name: q.name, host: q.host, online: online(q.id), pts: q.pts, total: total(q) })),
    missions: p.missions.map(m => ({ id: m.id, text: m.text, pts: m.pts, status: m.status, witness: m.witness })),
    toConfirm: [],
  };
  for (const q of S.players) for (const m of q.missions)
    if (m.status === 'pending' && m.witness === p.id) v.toConfirm.push({ claimer: q.id, name: q.name, mission: m.id, text: m.text, pts: m.pts });
  if (p.host || G.phase === 'survey') v.prompts = G.prompts;
  if (G.phase === 'survey') { v.answered = !!G.survey[p.id]; v.answeredCount = Object.keys(G.survey).length; }
  if (G.phase === 'guess') {
    const g = G.guess;
    v.guess = { idx: g.idx, total: NPROMPTS, prompt: G.prompts[g.idx], mine: g.guesses[p.id] || null, submitted: Object.keys(g.guesses).length, revealed: g.revealed, results: g.revealed ? g.results : null };
  }
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

function broadcast() {
  for (const ws of wss.clients) {
    const p = ws.pid && byId(ws.pid);
    if (p && ws.readyState === 1) ws.send(JSON.stringify(view(p)));
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
const HOST = new Set(['startSurvey', 'startGuess', 'revealGuess', 'nextGuess', 'startDinner', 'startStory', 'forceRound', 'revealVotes', 'nextStory', 'endGame', 'resetGame']);

function advanceStory(st, G) {
  if (!st.stories.every(s => s.lines.length > st.round)) return;
  st.round++;
  if (st.round >= st.order.length) { G.phase = 'story_vote'; st.idx = 0; }
}

const H = {
  startSurvey(ws, p, m) {
    const a = m.prompts;
    if (!Array.isArray(a) || a.length !== NPROMPTS) return err(ws, 'preguntasInvalidas');
    const out = [];
    for (const x of a) { const t = clean(x, 90); if (!t) return err(ws, 'preguntasInvalidas'); out.push(t); }
    Object.assign(S.game, { prompts: out, survey: {}, guess: null, phase: 'survey' });
  },
  survey(ws, p, m) {
    const G = S.game;
    if (G.phase !== 'survey') return err(ws, 'faseIncorrecta');
    if (G.survey[p.id]) return err(ws, 'yaEnviado');
    if (!Array.isArray(m.answers) || m.answers.length !== NPROMPTS) return err(ws, 'encuestaIncompleta');
    const out = [];
    for (const x of m.answers) { const t = txt(ws, x, 40); if (t === false) return; out.push(t); }
    G.survey[p.id] = out;
  },
  startGuess(ws) {
    const G = S.game;
    if (!Object.keys(G.survey).length) return err(ws, 'sinRespuestas');
    G.guess = { idx: 0, guesses: {}, revealed: false, results: null };
    G.phase = 'guess';
  },
  guess(ws, p, m) {
    const g = S.game.guess;
    if (S.game.phase !== 'guess' || g.revealed) return err(ws, 'faseIncorrecta');
    const t = txt(ws, m.text, 40);
    if (t !== false) g.guesses[p.id] = t;
  },
  revealGuess(ws) {
    const G = S.game, g = G.guess;
    if (G.phase !== 'guess' || g.revealed) return err(ws, 'faseIncorrecta');
    const cl = cluster(Object.values(G.survey).map(a => a[g.idx]));
    const guesses = Object.entries(g.guesses).map(([pid, text]) => {
      const w = words(text), c = cl.find(c => same(c.w, w)), pts = c ? c.count : 0;
      byId(pid).pts.encuesta += pts;
      return { pid, text, pts };
    });
    g.revealed = true;
    g.results = { clusters: cl.map(c => ({ label: c.label, count: c.count })), guesses };
  },
  nextGuess(ws) {
    const G = S.game, g = G.guess;
    if (G.phase !== 'guess' || !g.revealed) return err(ws, 'faseIncorrecta');
    if (++g.idx >= NPROMPTS) { G.phase = 'lobby'; G.guess = null; } else { g.guesses = {}; g.revealed = false; g.results = null; }
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
    if (S.players.length >= MAX_PLAYERS) return err(ws, 'salaLlena');
    p = { id: 'p' + (S.players.length + 1), token: crypto.randomBytes(16).toString('hex'), name, key, host: !S.players.length, pts: { encuesta: 0, misiones: 0, historia: 0 }, missions: [] };
    S.players.push(p);
    if (S.game.dinner) assignMissions(p);
  }
  ws.pid = p.id;
  send(ws, { t: 'joined', token: p.token });
  return true;
}

function dispatch(ws, m) {
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
  save(); broadcast();
}

// ---------- Servidor ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
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
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  ${ES.titulo}\n  Código de sala: ${S.code}\n`);
  for (const ip of ips) console.log(`  Abre en los teléfonos: http://${ip}:${PORT}/?c=${S.code}`);
  console.log(`  (en esta computadora: http://localhost:${PORT}/?c=${S.code})\n`);
});
