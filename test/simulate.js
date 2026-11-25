// Simulación con 8 clientes WebSocket reales contra un servidor real. Uso: npm test
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const ES = require('../public/es.js');

const PORT = 3199, URL = `ws://localhost:${PORT}`, CODE = 'TEST';
const STATE = path.join(os.tmpdir(), `dag-test-${process.pid}.json`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = () => sleep(120);
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

let server;
const startServer = async () => {
  server = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, STATE_FILE: STATE, ROOM_CODE: CODE, TIME_SCALE: '0.15' }, stdio: 'pipe' });
  server.stderr.on('data', d => { console.error(String(d)); process.exitCode = 1; });
  await sleep(700);
};
const stopServer = async () => { server.kill('SIGTERM'); await sleep(300); };

class Client {
  constructor(name, team) { this.name = name; this.team = team; this.errs = []; this.s = null; }
  connect(first) {
    return new Promise(res => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => { if (first) this.send(first); res(); });
      this.ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.t === 'state') this.s = m;
        else if (m.t === 'joined') this.token = m.token;
        else if (m.t === 'error') this.errs.push(m.key);
        else if (m.t === 'badtoken') this.bad = true;
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  get err() { return this.errs[this.errs.length - 1]; }
  get id() { return this.s.me.id; }
}

const ok = msg => console.log(`  ✓ ${msg}`);
const section = t => console.log(`\n${t}`);

(async () => {
  fs.rmSync(STATE, { force: true });
  await startServer();
  // Mujeres (m): Ana (anfitriona), Carla, Elena, Fany. Hombres (h): Beto, Diego, Gabo, Hugo.
  const spec = [['Ana', 'm'], ['Beto', 'h'], ['Carla', 'm'], ['Diego', 'h'], ['Elena', 'm'], ['Fany', 'm'], ['Gabo', 'h'], ['Hugo', 'h']];
  const names = spec.map(x => x[0]);
  const C = spec.map(([n, t]) => new Client(n, t));
  await Promise.all(C.map(c => c.connect()));
  const host = C[0];

  section('Entrada a la sala');
  C[0].send({ t: 'join', name: '   ', code: CODE, team: 'm' }); await settle();
  assert.equal(C[0].err, 'nombreVacio'); ok('nombre vacío rechazado');
  C[0].send({ t: 'join', name: 'Ana', code: 'ZZZZ', team: 'm' }); await settle();
  assert.equal(C[0].err, 'codigoMal'); ok('código incorrecto rechazado');
  C[0].send({ t: 'join', name: 'Ana', code: CODE }); await settle();
  assert.equal(C[0].err, 'equipoVacio'); ok('sin elegir equipo: rechazado');
  for (const c of C) { c.send({ t: 'join', name: c.name, code: CODE.toLowerCase(), team: c.team }); await sleep(30); }
  await settle();
  assert(C.every(c => c.token && c.s), 'todos entraron');
  assert(host.s.me.host && C.slice(1).every(c => !c.s.me.host)); ok('8 jugadores dentro (4 hombres, 4 mujeres); Ana es la anfitriona');
  const dup = new Client('x'); await dup.connect();
  dup.send({ t: 'join', name: ' ÁNA ', code: CODE, team: 'h' }); await settle();
  assert.equal(dup.err, 'nombreUso'); ok('nombre duplicado (ignora acentos/mayúsculas) rechazado');
  C[1].send({ t: 'startFeud', rounds: 4 }); await settle();
  assert.equal(C[1].err, 'soloAnfitrion'); ok('un invitado no puede controlar fases');

  section('Pantalla principal');
  const tv = new Client('tv'); await tv.connect({ t: 'screen' }); await settle();
  assert(tv.s && tv.s.screen && tv.s.players.length === 8); ok('la pantalla recibe el estado sin entrar como jugador');

  section('Duelo familiar: cara a cara, jugar o pasar, robo, ×2 y ×3');
  host.send({ t: 'startFeud', rounds: 4 }); await settle();
  assert(C.every(c => c.s.phase === 'feud') && tv.s.phase === 'feud');
  const byId = id => C.find(c => c.id === id);
  const F = () => host.s.feud;
  const Q = () => ES.preguntas.find(q => q[0] === F().question);
  const say = async (text, c) => { c = c || byId(F().active.id); c.send({ t: 'answer', text, seq: F().seq }); await settle(); return c; };
  const buzz = async id => { byId(id).send({ t: 'buzz' }); await settle(); };
  const pts = c => c.s.players.find(p => p.id === c.id).pts.encuesta;
  const expected = { m: 0, h: 0 };
  let f = F(), L = Q()[1];
  assert.equal(f.total, 4); assert.equal(f.stage, 'buzz'); assert(f.pair.h.id && f.pair.m.id); ok('4 rondas; empieza con el cara a cara: un jugador de cada equipo');
  assert(tv.s.feud.slots.every(s => s.label === undefined) && C[3].s.feud.slots.every(s => s.label === undefined) && C[3].s.feud.judge === null);
  ok('las respuestas ocultas no se filtran ni a la pantalla ni a los teléfonos');

  // Ronda 1: ganan las mujeres el cara a cara y PASAN el turno; los hombres juegan y pierden por robo.
  const pair1 = { h: f.pair.h.id, m: f.pair.m.id };
  const out = C.find(c => ![pair1.h, pair1.m].includes(c.id)); out.send({ t: 'buzz' }); await settle();
  assert.equal(out.err, 'faseIncorrecta'); ok('quien no está en el cara a cara no puede tocar el botón');
  await buzz(pair1.h); f = F();
  assert.equal(f.stage, 'fo1'); assert.equal(f.active.id, pair1.h); ok('el primero en tocar el botón responde primero');
  await say('zzz'); f = F();
  assert.equal(f.stage, 'fo2'); assert.equal(f.active.id, pair1.m); ok('si falla, responde el rival del otro equipo');
  await say(L[0][0]); f = F();
  assert.equal(f.stage, 'choose'); assert.equal(f.winner, 'm'); assert(f.slots[0].found); ok('la respuesta #1 gana el cara a cara');
  byId(pair1.h).send({ t: 'choose', play: true }); await settle(); assert.equal(byId(pair1.h).err, 'noTuTurno');
  byId(pair1.m).send({ t: 'choose', play: false }); await settle(); f = F();
  assert.equal(f.stage, 'play'); assert.equal(f.control, 'h'); assert.equal(f.active.team, 'h'); assert.notEqual(f.active.id, pair1.h);
  ok('el equipo ganador pasa: juegan los hombres, empezando por el compañero de quien hizo el cara a cara');
  const first = f.active.id;
  await say(L[1][0]); f = F(); assert(f.slots[1].found); assert.notEqual(f.active.id, first); ok('contestan uno por uno, rotando por todo el equipo');
  for (let i = 0; i < 3; i++) await say('zzz');
  f = F(); assert.equal(f.stage, 'steal'); assert.equal(f.active.team, 'm'); ok('3 errores → el otro equipo tiene una sola oportunidad de robo');
  const bank1 = f.bank;
  await say('zzz'); f = F();
  assert.equal(f.stage, 'done'); assert.equal(f.result.winner, 'h'); assert.equal(f.result.pts, bank1);
  assert(f.slots.every(s => s.label)); expected.h += bank1; ok(`robo fallido: los hombres se llevan ${bank1} (incluye lo que salió en el cara a cara)`);
  host.send({ t: 'nextRound' }); await settle();

  // Ronda 2: otro par de jugadores; las mujeres dicen la #1 y juegan; roban los hombres.
  f = F(); L = Q()[1];
  assert.equal(f.round, 2); assert(f.pair.h.id !== pair1.h && f.pair.m.id !== pair1.m); ok('cada ronda el cara a cara lo hacen otros jugadores');
  await buzz(f.pair.m.id); await say(L[0][0]); byId(F().pair.m.id).send({ t: 'choose', play: true }); await settle();
  f = F(); assert.equal(f.control, 'm'); assert.equal(f.stage, 'play');
  await say(L[1][0]); for (let i = 0; i < 3; i++) await say('zzz');
  assert.equal(F().stage, 'steal'); assert.equal(F().active.team, 'h');
  await say(L[2][0]); f = F();
  assert.equal(f.stage, 'done'); assert.equal(f.result.winner, 'h'); assert.equal(f.result.pts, L[0][1] + L[1][1] + L[2][1]);
  expected.h += f.result.pts; ok('robo exitoso: los hombres se quedan con todos los puntos del tablero');
  host.send({ t: 'nextRound' }); await settle();

  // Ronda 3 (×2): nadie acierta el cara a cara → nuevos jugadores; el más popular gana; el anfitrión acredita; tablero completo.
  f = F(); L = Q()[1]; assert.equal(f.mult, 2); ok('la tercera ronda vale doble');
  const pair3 = { ...f.pair };
  await buzz(f.pair.m.id); await say('zzz'); await say('qqq'); f = F();
  assert.equal(f.stage, 'buzz'); assert(f.pair.h.id !== pair3.h.id && f.pair.m.id !== pair3.m.id); ok('si nadie acierta en el cara a cara, entran otros dos jugadores');
  await buzz(f.pair.h.id); await say(L[2][0]); await say(L[1][0]); f = F();
  assert.equal(f.stage, 'choose'); assert.equal(f.winner, 'm'); ok('si ninguno dice la #1, gana quien dio la respuesta más popular (#2 le gana a #3)');
  byId(f.pair.m.id).send({ t: 'choose', play: true }); await settle(); f = F();
  assert.equal(f.control, 'm');
  while (F().active.id === host.id) { host.send({ t: 'skipTurn' }); await settle(); }
  const missed = await say('palabra rara'); f = F();
  assert.equal(f.strikes, 1); assert(host.s.feud.judge.length === L.length - 2); assert.equal(C[3].s.feud.judge, null);
  host.send({ t: 'credit', idx: 0 }); await settle(); f = F();
  assert.equal(f.strikes, 0); assert(f.slots[0].found); assert.equal(pts(missed) >= L[0][1] * 2, true);
  ok('el anfitrión acredita la respuesta: se quita el error y suma ×2 a quien la dijo');
  C[2].send({ t: 'credit', idx: 3 }); await settle(); assert.equal(C[2].err, 'soloAnfitrion');
  for (let i = 0; i < L.length; i++) if (!F().slots[i].found && F().stage === 'play') await say(L[i][0]);
  f = F(); assert.equal(f.stage, 'done'); assert.equal(f.result.winner, 'm'); assert.equal(f.result.pts, L.reduce((x, a) => x + a[1], 0) * 2);
  expected.m += f.result.pts; ok('tablero completo antes de 3 errores: el equipo se lleva todo el banco ×2');
  host.send({ t: 'nextRound' }); await settle();

  // Ronda 4 (×3): los hombres ganan el cara a cara y no deciden (juegan solos por tiempo); un turno se acaba.
  f = F(); L = Q()[1]; assert.equal(f.mult, 3); ok('la cuarta ronda vale triple');
  await buzz(f.pair.h.id); await say(L[0][0]); assert.equal(F().stage, 'choose');
  await sleep(2700); f = F();
  assert.equal(f.stage, 'play'); assert.equal(f.control, 'h'); ok('si no deciden a tiempo, el equipo juega');
  await sleep(4000); f = F();
  assert.equal(f.strikes, 1); assert.equal(f.last.hit, false); assert.equal(f.last.text, ES.duelo.sinRespuesta); ok('si se acaba el tiempo del turno cuenta como error');
  await say('zzz'); await say('zzz'); assert.equal(F().stage, 'steal');
  await say('zzz'); f = F();
  assert.equal(f.result.winner, 'h'); assert.equal(f.result.pts, L[0][1] * 3); expected.h += f.result.pts; ok('última ronda ×3 para los hombres');
  host.send({ t: 'nextRound' }); await settle();

  section('Ronda relámpago');
  const winTeam = expected.h > expected.m ? 'h' : 'm';
  assert(C.every(c => c.s.phase === 'fastmoney')); assert.deepEqual(host.s.fm.teams, [winTeam]);
  assert.equal(host.s.fm.players[winTeam].length, 2); ok(`juega el equipo con más puntos (${winTeam === 'h' ? 'Pavos' : 'Calabazas'}: ${expected[winTeam]}) con 2 jugadores`);
  const enc0 = Object.fromEntries(C.map(c => [c.id, pts(c)]));
  const fmq = () => ES.preguntas.find(q => q[0] === host.s.fm.question)[1];
  const fsay = async (text, c) => { c = c || byId(host.s.fm.active.id); c.send({ t: 'answer', text, seq: host.s.fm.seq }); await settle(); return c; };
  const nonA = C.find(c => c.id !== host.s.fm.active.id); nonA.send({ t: 'answer', text: 'x', seq: 0 }); await settle(); assert.equal(nonA.err, 'noTuTurno');
  const mine = {};
  for (let q = 0; q < 5; q++) {
    const A = fmq(), p0 = host.s.fm.active.id;
    await fsay(A[0][0]); mine[p0] = (mine[p0] || 0) + A[0][1];
    assert.notEqual(host.s.fm.active.id, p0 && host.s.fm.q === q + 1 && host.s.fm.s === 0 ? 'x' : p0);
    const p1 = host.s.fm.active.id;
    await fsay(A[0][0]); assert.equal(byId(p1).err, 'repetida');
    await fsay(A[1][0]); mine[p1] = (mine[p1] || 0) + A[1][1];
  }
  assert.equal(host.s.fm.stage, 'reveal'); assert(host.s.fm.rows[0].lines.every(l => l.a.every(x => x === null))); ok('5 preguntas × 2 jugadores; el compañero no puede repetir la misma respuesta; respuestas ocultas hasta revelar');
  host.send({ t: 'fmReveal' }); await settle();
  assert.equal(host.s.fm.revealN, 1); assert(host.s.fm.rows[0].lines[0].a[0] && host.s.fm.rows[0].lines[0].a[1] === null);
  host.send({ t: 'fmRevealAll' }); await settle(); const fm = host.s.fm;
  assert.equal(fm.stage, 'done'); assert(fm.win[winTeam]); ok('el presentador revela de a una respuesta; con 200+ puntos ganan el gran premio');
  for (const [id, v] of Object.entries(mine)) assert.equal(pts(byId(id)), enc0[id] + v + 50);
  ok('cada jugador suma los puntos de sus respuestas más 50 de premio');
  host.send({ t: 'fmDone' }); await settle();
  assert(C.every(c => c.s.phase === 'feud_done')); assert.deepEqual(host.s.feudScore, expected);
  ok(`marcador final por equipos correcto: Calabazas ${expected.m} · Pavos ${expected.h}`);
  assert(tv.s.phase === 'feud_done' && tv.s.feudScore.m === expected.m); ok('la pantalla principal muestra el resultado');

  section('Misiones secretas');
  host.send({ t: 'startDinner' }); await settle();
  assert(C.every(c => c.s.missions.length === 4 && c.s.missions.every(m => [10, 20, 30].includes(m.pts)))); ok('cada jugador tiene 4 misiones de 10-30 puntos');
  const mp = c => c.s.players.find(p => p.id === c.id).pts.misiones;
  const before = mp(C[2]);
  C[2].send({ t: 'claim', mission: 0, witness: C[2].id }); await settle();
  assert.equal(C[2].err, 'testigoInvalido'); ok('no puedes ser tu propio testigo');
  C[2].send({ t: 'claim', mission: 0, witness: C[3].id }); await settle();
  assert.equal(mp(C[2]), before); assert.equal(C[3].s.toConfirm.length, 1); ok('al reclamar NO se suman puntos; el testigo ve la solicitud');
  C[4].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: true }); await settle();
  assert.equal(mp(C[2]), before); ok('otra persona no puede confirmar');
  C[3].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: false }); await settle();
  assert.equal(C[2].s.missions[0].status, 'open'); ok('testigo rechaza → la misión sigue abierta');
  C[2].send({ t: 'claim', mission: 0, witness: C[3].id }); await settle();
  C[3].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: true }); await settle();
  assert.equal(mp(C[2]), C[2].s.missions[0].pts); ok(`testigo confirma → +${C[2].s.missions[0].pts} puntos`);

  section('Desconexión y recuperación');
  const tok = C[5].token, who = C[5].id;
  C[5].ws.terminate(); await settle();
  assert(!host.s.players.find(p => p.id === who).online); ok('el servidor marca al jugador como sin conexión');
  const back = new Client('x'); await back.connect(); back.send({ t: 'auth', token: tok }); await settle();
  assert.equal(back.s.me.id, who); assert.equal(back.s.me.team, 'm'); ok('recarga con el token guardado restaura al jugador y su equipo');
  const nuevo = new Client('x'); await nuevo.connect(); nuevo.send({ t: 'join', name: 'fany', code: CODE, team: 'h' }); await settle();
  assert.equal(nuevo.err, 'nombreUso'); ok('mientras está conectada, su nombre no se puede usar');
  back.ws.terminate(); await settle();
  const t2 = new Client('x'); await t2.connect(); t2.send({ t: 'join', name: 'Fany', code: CODE, team: 'h' }); await settle();
  assert.equal(t2.s.me.id, who); assert.equal(t2.s.me.team, 'm'); ok('si está desconectada, recupera su lugar (y conserva su equipo)');
  C[5] = t2;
  const bad = new Client('x'); await bad.connect(); bad.send({ t: 'auth', token: 'nope' }); await settle();
  assert(bad.bad); ok('token inválido → se pide volver a entrar');

  section('Reinicio del servidor (guardado en JSON)');
  await stopServer(); await startServer();
  const toks = C.map(c => c.token);
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) { const nc = new Client(names[i]); await nc.connect(); nc.send({ t: 'auth', token: toks[i] }); nc.token = toks[i]; C[i] = nc; }
  await tv.connect({ t: 'screen' });
  await settle();
  const H = C[0];
  assert(C.every(c => c.s && c.s.players.length === 8));
  assert.equal(C[2].s.missions[0].status, 'done'); assert.deepEqual(H.s.players.find(p => p.id === H.id).pts.encuesta, H.s.players[0].pts.encuesta);
  ok('tras reiniciar, jugadores, equipos, puntos y misiones siguen ahí');

  section('Cuenta la historia');
  H.send({ t: 'startStory' }); await settle();
  assert(C.every(c => c.s.phase === 'story_write' && c.s.story.first)); ok('cada teléfono recibe su inicio de historia');
  assert.equal(new Set(C.map(c => c.s.story.prev)).size, 8); ok('8 inicios distintos');
  C[0].send({ t: 'sentence', text: '', round: 0 }); await settle(); assert.equal(C[0].err, 'respuestaVacia');
  C[0].send({ t: 'sentence', text: 'x'.repeat(61), round: 0 }); await settle(); assert.equal(C[0].err, 'respuestaLarga'); ok('frase vacía o de más de 60 caracteres rechazada');
  for (let round = 0; round < 8; round++) {
    C.forEach(c => assert.equal(c.s.story.round, round + 1));
    C.forEach((c, i) => c.send({ t: 'sentence', text: `f${round}-${names[i]}`, round }));
    await settle();
    if (round === 3) { C[0].send({ t: 'sentence', text: 'otra', round: 3 }); await settle(); assert.equal(C[0].err, 'yaEnviado'); }
    if (round < 7) C.forEach((c, i) => assert.equal(c.s.story.prev, `f${round}-${names[(i + 1) % 8]}`, `${c.name} ronda ${round}`));
  }
  assert(C.every(c => c.s.phase === 'story_vote')); ok('8 rondas completadas; cada teléfono vio solo la frase anterior');
  assert(H.s.vote.lines.length === 8 && H.s.vote.lines.every(l => l.author === undefined)); ok('autores ocultos mientras se vota');
  C.forEach(c => c.send({ t: 'vote', i: c.s.vote.lines[0].mine ? 1 : 0 })); await settle();
  C[1].send({ t: 'vote', i: C[1].s.vote.lines.findIndex(l => l.mine) }); await settle(); assert.equal(C[1].err, 'votoPropio'); ok('no puedes votar tu propia frase');
  const hist0 = H.s.players.map(p => p.pts.historia);
  H.send({ t: 'revealVotes' }); await settle();
  const after = H.s.vote.lines; assert.equal(after[0].votes, 7); assert.equal(after[1].votes, 1);
  const h = (nm) => H.s.players.find(p => p.name === nm).pts.historia;
  assert.equal(h(after[0].author), 70); assert.equal(h(after[1].author), 10); ok(`10 puntos por voto: ${after[0].author} 70, ${after[1].author} 10`);
  void hist0;
  H.send({ t: 'nextStory' }); await settle(); assert.equal(H.s.vote.idx, 2);
  for (let i = 0; i < 7; i++) { H.send({ t: 'revealVotes' }); await settle(); H.send({ t: 'nextStory' }); await settle(); }
  assert.equal(H.s.phase, 'lobby'); ok('8 historias mostradas una por una');

  section('Fin del juego');
  H.send({ t: 'endGame' }); await settle();
  assert(C.every(c => c.s.phase === 'end') && tv.s.phase === 'end');
  const ps = H.s.players;
  assert(ps.every(p => p.total === p.pts.encuesta + p.pts.misiones + p.pts.historia));
  const top = [...ps].sort((a, b) => b.total - a.total)[0];
  ok(`pantalla de ganador en los 8 teléfonos y en la pantalla principal; líder: ${top.name} con ${top.total} puntos (desglose cuadra)`);
  console.log('\nTodo bien: 8 clientes simulados, 0 fallas.\n');
  C.forEach(c => c.ws.terminate()); tv.ws.terminate(); await stopServer(); fs.rmSync(STATE, { force: true }); process.exit(process.exitCode || 0);
})().catch(async e => { console.error('\n✗ FALLÓ:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); server && server.kill(); fs.rmSync(STATE, { force: true }); process.exit(1); });
