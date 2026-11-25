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

let server;
const startServer = async () => {
  server = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, STATE_FILE: STATE, ROOM_CODE: CODE }, stdio: 'pipe' });
  server.stderr.on('data', d => { console.error(String(d)); process.exitCode = 1; });
  await sleep(700);
};
const stopServer = async () => { server.kill('SIGTERM'); await sleep(300); };

class Client {
  constructor(name) { this.name = name; this.errs = []; this.s = null; }
  connect() {
    return new Promise(res => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
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

let n = 0;
const ok = msg => console.log(`  ✓ ${msg}`);
const section = t => console.log(`\n${t}`);

(async () => {
  fs.rmSync(STATE, { force: true });
  await startServer();
  const names = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fany', 'Gabo', 'Hugo'];
  const C = names.map(x => new Client(x));
  await Promise.all(C.map(c => c.connect()));
  const [host, ...rest] = C;

  section('Entrada a la sala');
  C[0].send({ t: 'join', name: '   ', code: CODE }); await settle();
  assert.equal(C[0].err, 'nombreVacio'); ok('nombre vacío rechazado');
  C[0].send({ t: 'join', name: 'Ana', code: 'ZZZZ' }); await settle();
  assert.equal(C[0].err, 'codigoMal'); ok('código incorrecto rechazado');
  for (const c of C) { c.send({ t: 'join', name: c.name, code: CODE.toLowerCase() }); await sleep(30); }
  await settle();
  assert(C.every(c => c.token && c.s), 'todos entraron');
  assert(host.s.me.host && C.slice(1).every(c => !c.s.me.host)); ok('8 jugadores dentro; Ana es la anfitriona');
  const dup = new Client('x'); await dup.connect();
  dup.send({ t: 'join', name: ' ÁNA ', code: CODE }); await settle();
  assert.equal(dup.err, 'nombreUso'); ok('nombre duplicado (ignora acentos/mayúsculas) rechazado');
  rest[0].send({ t: 'startSurvey', prompts: [] }); await settle();
  assert.equal(rest[0].err, 'soloAnfitrion'); ok('un invitado no puede controlar fases');

  section('Encuesta familiar');
  host.send({ t: 'startSurvey', prompts: ['uno', '', 'tres', 'cuatro', 'cinco', 'seis'] }); await settle();
  assert.equal(host.err, 'preguntasInvalidas'); ok('preguntas vacías rechazadas');
  host.send({ t: 'startSurvey', prompts: ES.encuesta.prompts }); await settle();
  assert(C.every(c => c.s.phase === 'survey' && c.s.prompts.length === 6)); ok('encuesta iniciada en todos los teléfonos');
  const p0 = ['el pavo', 'Pavo', 'pavos', 'papas', 'Papa', 'puré', 'pavo ', 'ensalada'];
  const p1 = ['Piña', 'pina', 'la piña', 'PIÑAS', 'mole', 'mole', 'tamales', 'tamal'];
  C[7].send({ t: 'survey', answers: ['a', 'b', '', 'd', 'e', 'f'] }); await settle();
  assert.equal(C[7].err, 'respuestaVacia'); ok('respuesta vacía rechazada');
  C[7].send({ t: 'survey', answers: ['a'.repeat(41), 'b', 'c', 'd', 'e', 'f'] }); await settle();
  assert.equal(C[7].err, 'respuestaLarga'); ok('respuesta de más de 40 caracteres rechazada');
  C.forEach((c, i) => c.send({ t: 'survey', answers: [p0[i], p1[i], `r2-${i}`, `r3-${i}`, `r4-${i}`, `r5-${i}`] }));
  await settle();
  assert.equal(host.s.answeredCount, 8); ok('8 de 8 respondieron');
  C[0].send({ t: 'survey', answers: ['x', 'x', 'x', 'x', 'x', 'x'] }); await settle();
  assert.equal(C[0].err, 'yaEnviado'); ok('no se puede reenviar');

  section('Adivina la respuesta más popular (agrupación)');
  host.send({ t: 'startGuess' }); await settle();
  assert(C.every(c => c.s.phase === 'guess' && c.s.guess.idx === 0));
  const g0 = ['PAVO', 'papa', 'el pavo', 'Ensalada', 'pure', 'tacos', '  papas  ', ''];
  C.forEach((c, i) => c.send({ t: 'guess', text: g0[i] })); await settle();
  assert.equal(C[7].err, 'respuestaVacia'); ok('intento vacío rechazado');
  C[7].send({ t: 'guess', text: 'pavos' }); await settle();
  host.send({ t: 'revealGuess' }); await settle();
  const pts = c => c.s.players.find(p => p.id === c.id).pts;
  const exp0 = [4, 2, 4, 1, 1, 0, 2, 4];
  C.forEach((c, i) => assert.equal(pts(c).encuesta, exp0[i], `${c.name} esperaba ${exp0[i]} y tiene ${pts(c).encuesta}`));
  const cl = host.s.guess.results.clusters;
  assert.deepEqual(cl.map(x => x.count), [4, 2, 1, 1]); ok('pavo/el pavo/pavos/Pavo = 4, papa/papas/Papa = 2; "pure" = "puré"');
  host.send({ t: 'nextGuess' }); await settle();
  C[0].send({ t: 'guess', text: 'pina' }); C[1].send({ t: 'guess', text: 'Los tamales' }); await settle();
  host.send({ t: 'revealGuess' }); await settle();
  assert.equal(pts(C[0]).encuesta, 8); assert.equal(pts(C[1]).encuesta, 4);
  ok('"piña"="pina"="la piña"="PIÑAS" (4) y "tamal"="los tamales" (2)');
  for (let i = 0; i < 5; i++) { host.send({ t: 'nextGuess' }); await settle(); if (host.s.phase === 'guess') { host.send({ t: 'revealGuess' }); await settle(); } }
  assert.equal(host.s.phase, 'lobby'); ok('6 preguntas terminadas, regreso a la sala');

  section('Misiones secretas');
  host.send({ t: 'startDinner' }); await settle();
  assert(C.every(c => c.s.missions.length === 4 && c.s.missions.every(m => [10, 20, 30].includes(m.pts)))); ok('cada jugador tiene 4 misiones de 10-30 puntos');
  const before = pts(C[2]).misiones;
  C[2].send({ t: 'claim', mission: 0, witness: C[2].id }); await settle();
  assert.equal(C[2].err, 'testigoInvalido'); ok('no puedes ser tu propio testigo');
  C[2].send({ t: 'claim', mission: 0, witness: C[3].id }); await settle();
  assert.equal(pts(C[2]).misiones, before); assert.equal(C[3].s.toConfirm.length, 1); ok('al reclamar NO se suman puntos; el testigo ve la solicitud');
  C[4].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: true }); await settle();
  assert.equal(pts(C[2]).misiones, before); ok('otra persona no puede confirmar');
  C[3].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: false }); await settle();
  assert.equal(C[2].s.missions[0].status, 'open'); ok('testigo rechaza → la misión sigue abierta');
  C[2].send({ t: 'claim', mission: 0, witness: C[3].id }); await settle();
  C[3].send({ t: 'confirm', claimer: C[2].id, mission: 0, ok: true }); await settle();
  assert.equal(pts(C[2]).misiones, C[2].s.missions[0].pts); ok(`testigo confirma → +${C[2].s.missions[0].pts} puntos`);

  section('Desconexión y recuperación');
  const tok = C[5].token, who = C[5].id;
  C[5].ws.terminate(); await settle();
  assert(!host.s.players.find(p => p.id === who).online); ok('el servidor marca al jugador como sin conexión');
  const back = new Client('x'); await back.connect(); back.send({ t: 'auth', token: tok }); await settle();
  assert.equal(back.s.me.id, who); ok('recarga con el token guardado restaura al jugador');
  const nuevo = new Client('x'); await nuevo.connect(); nuevo.send({ t: 'join', name: 'fany', code: CODE }); await settle();
  assert.equal(nuevo.err, 'nombreUso'); ok('mientras está conectada, su nombre no se puede usar');
  back.ws.terminate(); await settle();
  const t2 = new Client('x'); await t2.connect(); t2.send({ t: 'join', name: 'Fany', code: CODE }); await settle();
  assert.equal(t2.s.me.id, who); ok('si está desconectada, puede recuperar su lugar escribiendo su nombre');
  C[5] = t2;
  const bad = new Client('x'); await bad.connect(); bad.send({ t: 'auth', token: 'nope' }); await settle();
  assert(bad.bad); ok('token inválido → se pide volver a entrar');

  section('Reinicio del servidor (guardado en JSON)');
  await stopServer(); await startServer();
  const r = new Client('x'); await r.connect(); r.send({ t: 'auth', token: C[2].token }); await settle();
  assert.equal(r.s.me.id, C[2].id); assert.equal(r.s.missions[0].status, 'done'); assert.equal(r.s.players.find(p => p.id === C[2].id).pts.encuesta, 4);
  ok('tras reiniciar, el jugador, sus puntos y misiones siguen ahí');
  const toks = C.map(c => c.token); C[2] = r; r.token = toks[2];
  for (const i of [0, 1, 3, 4, 5, 6, 7]) { const nc = new Client(names[i]); await nc.connect(); nc.send({ t: 'auth', token: toks[i] }); nc.token = toks[i]; C[i] = nc; }
  await settle();
  const H = C[0]; assert(C.every(c => c.s && c.s.players.length === 8));

  section('Cuenta la historia');
  H.send({ t: 'startStory' }); await settle();
  assert(C.every(c => c.s.phase === 'story_write' && c.s.story.first)); ok('cada teléfono recibe su inicio de historia');
  const starters = C.map(c => c.s.story.prev); assert.equal(new Set(starters).size, 8); ok('8 inicios distintos');
  C[0].send({ t: 'sentence', text: '', round: 0 }); await settle(); assert.equal(C[0].err, 'respuestaVacia');
  C[0].send({ t: 'sentence', text: 'x'.repeat(61), round: 0 }); await settle(); assert.equal(C[0].err, 'respuestaLarga'); ok('frase vacía o de más de 60 caracteres rechazada');
  for (let round = 0; round < 8; round++) {
    C.forEach(c => assert.equal(c.s.story.round, round + 1));
    C.forEach((c, i) => c.send({ t: 'sentence', text: `f${round}-${names[i]}`, round }));
    await settle();
    if (round === 3) { C[0].send({ t: 'sentence', text: 'otra', round: 3 }); await settle(); assert.equal(C[0].err, 'yaEnviado'); } // ya avanzó la ronda: no debe colarse
    if (round < 7) // la historia viaja: cada quien solo ve lo que escribió la persona de la ronda anterior
      C.forEach((c, i) => assert.equal(c.s.story.prev, `f${round}-${names[(i + 1) % 8]}`, `${c.name} ronda ${round}`));
  }
  assert(C.every(c => c.s.phase === 'story_vote')); ok('8 rondas completadas; cada teléfono vio solo la frase anterior');
  const v = H.s.vote; assert.equal(v.lines.length, 8); assert(v.lines.every(l => l.author === undefined)); ok('autores ocultos mientras se vota');
  // Votos en la historia 1: todos votan por la frase 0 salvo su autor (que vota por la 1).
  C.forEach(c => c.send({ t: 'vote', i: c.s.vote.lines[0].mine ? 1 : 0 })); await settle();
  C[1].send({ t: 'vote', i: C[1].s.vote.lines.findIndex(l => l.mine) }); await settle(); assert.equal(C[1].err, 'votoPropio'); ok('no puedes votar tu propia frase');
  H.send({ t: 'revealVotes' }); await settle();
  const after = H.s.vote.lines; assert.equal(after[0].votes, 7); assert.equal(after[1].votes, 1);
  const author0 = after[0].author; const author1 = after[1].author;
  const total = (c, nm) => c.s.players.find(p => p.name === nm).pts.historia;
  assert.equal(total(H, author0), 70); assert.equal(total(H, author1), 10); ok(`10 puntos por voto: ${author0} 70, ${author1} 10`);
  H.send({ t: 'nextStory' }); await settle(); assert.equal(H.s.vote.idx, 2);
  for (let i = 0; i < 7; i++) { H.send({ t: 'revealVotes' }); await settle(); H.send({ t: 'nextStory' }); await settle(); }
  assert.equal(H.s.phase, 'lobby'); ok('8 historias mostradas una por una');

  section('Fin del juego');
  H.send({ t: 'endGame' }); await settle();
  assert(C.every(c => c.s.phase === 'end'));
  const ps = H.s.players; const sum = ps.every(p => p.total === p.pts.encuesta + p.pts.misiones + p.pts.historia);
  assert(sum); const top = [...ps].sort((a, b) => b.total - a.total)[0];
  ok(`pantalla de ganador en los 8 teléfonos; líder: ${top.name} con ${top.total} puntos (desglose cuadra)`);
  console.log('\nTodo bien: 8 clientes simulados, 0 fallas.\n');
  C.forEach(c => c.ws.terminate()); await stopServer(); fs.rmSync(STATE, { force: true }); process.exit(process.exitCode || 0);
})().catch(async e => { console.error('\n✗ FALLÓ:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); server && server.kill(); fs.rmSync(STATE, { force: true }); process.exit(1); });
