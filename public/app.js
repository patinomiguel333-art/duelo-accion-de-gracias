(() => {
'use strict';
const T = ES, $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ?slot=N separa la identidad guardada (para la página de prueba con 8 teléfonos); ?n=Nombre&t=h|m entra solo.
const Q = new URLSearchParams(location.search), SLOT = Q.get('slot') ? '_' + Q.get('slot') : '';
const K = k => 'dag_' + k + SLOT;
const autoJoin = () => { if (Q.get('n')) send({ t: 'join', name: Q.get('n'), code: Q.get('c') || '', team: Q.get('t') }); };
let ws, st = null, token = localStorage.getItem(K('token'));
let tab = 'juego', boardOpen = false, pick = null, joinTeam = localStorage.getItem(K('team')) || '', up = false, retry = 0, toastT;
let drafts = {}, sub0 = '', key0 = '', html0 = '', skew = 0;

// ---------- Conexión ----------
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast(T.errores.sinConexion); };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3500);
}
function connect() {
  if (ws && ws.readyState < 2) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { up = true; retry = 0; if (token) send({ t: 'auth', token }); else autoJoin(); render(); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') { st = m; skew = m.now ? m.now - Date.now() : 0; render(); }
    else if (m.t === 'joined') { token = m.token; localStorage.setItem(K('token'), token); }
    else if (m.t === 'badtoken') { token = null; st = null; localStorage.removeItem(K('token')); render(); autoJoin(); }
    else if (m.t === 'error') toast(T.errores[m.key] || T.errores.generico);
  };
  ws.onclose = () => { up = false; render(); setTimeout(connect, Math.min(4000, 400 * 2 ** retry++)); };
}
setInterval(() => document.querySelectorAll('.cd').forEach(e => {
  const sec = Math.max(0, Math.ceil((+e.dataset.dl - (Date.now() + skew)) / 1000));
  e.textContent = T.duelo.tiempo(sec); e.classList.toggle('low', sec <= 5);
}), 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });

// ---------- Utilidades de vista ----------
const E = T.equipos;
const ranked = () => [...st.players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
const pname = id => (st.players.find(p => p.id === id) || {}).name || '?';
const emo = p => (p.team ? E[p.team].e : '');
const live = (k, html, cls = 'count') => `<p class="${cls}" data-live="${k}">${html}</p>`;
const hostBtn = (s, label, cls = '', extra = '') => `<button class="btn ${cls}" data-s="${s}" ${extra}>${label}</button>`;
const wait = () => `<p class="hint" style="text-align:center">${T.esperaAnfitrion}</p>`;

function boardHTML() {
  const r = ranked();
  if (!boardOpen)
    return `<div class="chips">${r.map((p, i) => `<span class="chip ${p.id === st.me.id ? 'me' : ''} ${p.online ? '' : 'off'}"><b>${i + 1}</b>${emo(p)} ${esc(p.name)}<i>${p.total}</i></span>`).join('')}</div>`;
  return `<div class="rows">${r.map((p, i) => `<div class="row ${p.id === st.me.id ? 'me' : ''} ${p.online ? '' : 'off'}"><span class="n">${i + 1}</span><span class="nm">${emo(p)} ${esc(p.name)}${p.id === st.me.id ? ` <small>(${T.marcador.tu})</small>` : ''}${p.online ? '' : ` <small>· ${T.marcador.fuera}</small>`}</span><b>${p.total}</b></div>`).join('')}</div><p class="tip">${T.marcador.cerrar}</p>`;
}

const plist = () => ['h', 'm'].map(t => `<h4>${E[t].e} ${E[t].n} <small>(${E[t].sub})</small></h4><ul class="pl" data-live="pl${t}">${st.players.filter(p => p.team === t).map(p => `<li class="${p.online ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.host ? ` <span class="tag">${T.lobby.anfitrion}</span>` : ''}${p.id === st.me.id ? ` <small>(${T.marcador.tu})</small>` : ''}</li>`).join('')}</ul>`).join('');

// ---------- Pantallas ----------
function joinHTML() {
  const c = new URLSearchParams(location.search).get('c') || localStorage.getItem(K('code')) || '';
  return `<section class="card"><p>${T.unirse.intro}</p>
  <label>${T.unirse.nombre}<input id="jn" data-d data-enter="join" maxlength="16" autocomplete="off" autocapitalize="words"></label>
  <label>${T.unirse.codigo}<input id="jc" data-d data-enter="join" value="${esc(c.toUpperCase())}" maxlength="4" autocomplete="off" autocapitalize="characters"></label>
  <p class="hint" style="margin-bottom:4px">${T.unirse.equipo}</p>
  <div class="row2">${['h', 'm'].map(t => `<button class="btn team ${t} ${joinTeam === t ? 'sel' : ''}" data-a="team" data-v="${t}">${E[t].e} ${E[t].n}<small>${E[t].sub}</small></button>`).join('')}</div>
  <button class="btn" data-a="join">${T.unirse.entrar}</button><p class="hint">${T.unirse.primero}</p></section>`;
}

function hostHTML() {
  return `<section class="card"><h2>${T.anfitrion.titulo}</h2><p class="hint">${T.anfitrion.nota}</p>
  <label>${T.duelo.numRondas}<input id="fr" type="number" inputmode="numeric" min="3" max="8" value="4" data-d></label>
  <button class="btn" data-a="startFeud">${T.anfitrion.duelo}</button>
  ${hostBtn('startDinner', T.anfitrion.cena, 'alt', 'data-go="1"')}
  ${hostBtn('startStory', T.anfitrion.historia, 'alt', 'data-go="1"')}
  ${hostBtn('endGame', T.anfitrion.terminar, 'bad', `data-c="${esc(T.anfitrion.confirmarTerminar)}" data-go="1"`)}
  <p class="hint">${T.anfitrion.pantalla}<br><b>${esc(location.origin)}/pantalla</b></p>
  </section>`;
}

function lobbyHTML() {
  return `<section class="card"><h2>${T.lobby.titulo}</h2>${plist()}${st.me.host ? '' : `<p class="hint">${T.lobby.espera}</p>`}</section>${st.me.host ? hostHTML() : ''}`;
}

const cdHTML = dl => (dl ? `<span class="cd" data-dl="${dl}"></span>` : '');
const answerBox = (id, label, seq) => `<input id="${id}" data-d data-enter="submitAnswer" maxlength="40" placeholder="${label}" autocomplete="off"><button class="btn" data-a="submitAnswer">${T.duelo.enviar}</button>`;

function feudHTML() {
  const f = st.feud, h = st.me.host, me = st.me, act = f.active, mine = act && act.id === me.id, done = f.stage === 'done';
  const sc = ['m', 'h'].map(t => `<div class="tm ${t} ${!done && f.control === t ? 'on' : ''}"><span>${E[t].e} ${E[t].n}</span><b>${f.score[t]}</b></div>`).join('');
  const slots = f.slots.map((s, i) => s.label
    ? `<li class="slot open ${s.found ? '' : 'miss'}"><span>${esc(s.label)}</span><b>${s.pts}</b></li>`
    : `<li class="slot"><span>${i + 1}</span></li>`).join('');
  const x = `<div class="strikes">${[0, 1, 2].map(i => `<span class="${i < f.strikes ? 'on' : ''}">✖</span>`).join('')}</div>`;
  const inPair = me.id === f.pair.h.id || me.id === f.pair.m.id;
  const vs = `${E.m.e} <b>${esc(f.pair.m.name)}</b> vs ${E.h.e} <b>${esc(f.pair.h.name)}</b>`;
  let turn = '';
  if (f.stage === 'buzz') turn = `<p class="steal">${T.duelo.caraACara}</p><p>${vs}</p>` + (inPair
    ? `<p class="hint">${T.duelo.buzzInstr}</p><button class="btn buzz" data-s="buzz">${T.duelo.buzz}</button>` : `<p class="hint">${T.duelo.buzzEspera}</p>`);
  else if (f.stage === 'fo1') turn = `<p class="steal">${T.duelo.caraACara}</p>` + (mine ? `<p class="ok">${T.duelo.tuTurno}</p>${answerBox('fa', T.duelo.placeholder)}` : `<p class="hint">${T.duelo.primero(`<b>${esc(f.first.name)}</b>`)}</p>`);
  else if (f.stage === 'fo2') turn = `<p class="steal">${T.duelo.caraACara}</p>` + (mine ? `<p class="ok">${T.duelo.tuTurno}</p>${answerBox('fa', T.duelo.placeholder)}` : `<p class="hint">${T.duelo.segundo(`<b>${esc(act.name)}</b>`)}</p>`);
  else if (f.stage === 'choose') turn = mine
    ? `<p class="ok">${T.duelo.tuElegir}</p><button class="btn" data-a="choose" data-v="1">${T.duelo.jugar}</button><button class="btn alt" data-a="choose" data-v="0">${T.duelo.pasar}</button>`
    : `<p class="hint">${T.duelo.elegir(`<b>${esc(act.name)}</b>`)}</p>`;
  else if (done) turn = `<p class="big">${T.duelo.resultado(E[f.result.winner].n, f.result.pts)}</p>`;
  else turn = (f.stage === 'steal' ? `<p class="steal">${T.duelo.robo}</p>` : '') + (mine
    ? `<p class="ok">${T.duelo.tuTurno}</p>${answerBox('fa', T.duelo.placeholder)}`
    : `<p class="hint">${(act.team !== me.team ? T.duelo.esperaRival : T.duelo.ayuda)(`<b>${esc(act.name)}</b>`)}</p>`);
  const last = f.last ? `<p class="${f.last.hit ? 'ok' : 'badtx'}">${(f.last.hit ? T.duelo.acierto : T.duelo.fallo)(esc(f.last.name), esc(f.last.text))}</p>` : '';
  const judge = f.judge && f.judge.length ? `<h4>${T.duelo.juez}</h4>${f.judge.map(j => `<button class="btn sm alt" data-a="credit" data-i="${j.idx}">${esc(j.label)}</button>`).join('')}` : '';
  let hb = '';
  if (h) hb = done ? hostBtn('nextRound', f.round >= f.total ? T.duelo.terminar : T.duelo.siguiente)
    : ['play', 'steal'].includes(f.stage) ? hostBtn('skipTurn', T.duelo.saltar, 'alt sm') : hostBtn('repeatFaceoff', T.duelo.repetirCara, 'alt sm');
  else if (done) hb = wait();
  return `<section class="card"><div class="teams">${sc}</div><p class="hint">${T.duelo.ronda(f.round, f.total, f.mult)} · ${T.duelo.banco(f.bank)} ${cdHTML(f.deadline)}</p>
  <h3 class="q">${esc(f.question)}</h3><ul class="slots">${slots}</ul>${x}${turn}${last}${judge}${hb}</section>`;
}

function fmRowsHTML(fm) {
  return fm.rows.map(r => `<h4>${E[r.team].e} ${E[r.team].n} <small>(${fm.players[r.team].map(esc).join(' y ')})</small></h4>
  <table>${r.lines.map(l => `<tr><td style="text-align:left">${esc(l.question)}</td>${l.a.map(a => `<td>${a ? esc(a.text) : '···'}</td><td><b>${a ? a.pts : ''}</b></td>`).join('')}</tr>`).join('')}</table>
  <p class="big" style="font-size:1.6rem">${T.relampago.total(r.total)}</p>`).join('');
}
function fmVerdict(fm) {
  return fm.teams.map(t => { const tot = fm.rows.find(r => r.team === t).total;
    return fm.win[t] ? `<p class="big">${T.relampago.premio(E[t].n)}</p><p class="hint" style="text-align:center">${T.relampago.bonus(fm.bonus)}</p>` : `<p class="hint" style="text-align:center">${T.relampago.sinPremio(E[t].n, tot)}</p>`; }).join('');
}
function fmHTML() {
  const fm = st.fm, h = st.me.host, me = st.me;
  if (fm.stage === 'play') {
    const mine = fm.active.id === me.id;
    return `<section class="card"><h2>${T.relampago.titulo}</h2><p class="hint">${T.relampago.intro(`${E[fm.team].e} ${E[fm.team].n}`, fm.players[fm.team].map(esc).join(' y '))}</p>
    <p class="hint">${T.relampago.meta} · ${T.relampago.pregunta(fm.q)} ${cdHTML(fm.deadline)}</p><h3 class="q">${esc(fm.question)}</h3>` +
      (mine ? `<p class="ok">${T.relampago.tuTurno}</p>${answerBox('fa', T.relampago.placeholder)}` : `<p class="hint">${T.relampago.espera(`<b>${esc(fm.active.name)}</b>`)}</p>`) + `</section>`;
  }
  const btn = h ? (fm.stage === 'reveal' ? hostBtn('fmReveal', T.relampago.revelar) + hostBtn('fmRevealAll', T.relampago.revelarTodo, 'alt sm') : hostBtn('fmDone', T.relampago.continuar)) : wait();
  return `<section class="card"><h2>${T.relampago.titulo}</h2>${fmRowsHTML(fm)}${fm.stage === 'done' ? fmVerdict(fm) : ''}${btn}</section>`;
}

function feudDoneHTML() {
  const s = st.feudScore, w = s.h === s.m ? null : s.h > s.m ? 'h' : 'm';
  return `<section class="card"><h2>${T.duelo.titulo}</h2><div class="teams">${['m', 'h'].map(t => `<div class="tm ${t} ${w === t ? 'on' : ''}"><span>${E[t].e} ${E[t].n}</span><b>${s[t]}</b></div>`).join('')}</div>
  <p class="big">${w ? T.duelo.gana(E[w].n) : T.duelo.empate}</p>${st.fm ? fmVerdict(st.fm) : ''}${st.me.host ? '' : wait()}</section>${st.me.host ? hostHTML() : ''}`;
}

function missionsHTML() {
  const intro = st.phase === 'dinner' ? `<p>${T.misiones.cena}</p>` : '';
  const conf = st.toConfirm.length
    ? `<section class="card"><h2>${T.misiones.porConfirmar}</h2>${st.toConfirm.map(c => `<p>${T.misiones.dice(esc(c.name))}</p><blockquote>${esc(c.text)} <small>(+${c.pts})</small></blockquote>
      <div class="row2"><button class="btn sm" data-a="confirm" data-c="${c.claimer}" data-m="${c.mission}" data-ok="1">${T.misiones.si}</button><button class="btn sm alt" data-a="confirm" data-c="${c.claimer}" data-m="${c.mission}" data-ok="">${T.misiones.no}</button></div>`).join('')}</section>` : '';
  if (!st.missions.length) return `<section class="card"><h2>${T.misiones.titulo}</h2><p>${T.misiones.ninguna}</p></section>`;
  const list = st.missions.map(m => {
    let act = '';
    if (m.status === 'open') act = pick === m.id
      ? `<p>${T.misiones.testigo}</p>${st.players.filter(p => p.id !== st.me.id).map(p => `<button class="btn sm alt" data-a="witness" data-m="${m.id}" data-w="${p.id}">${esc(p.name)}</button>`).join('')}<button class="btn sm bad" data-a="pick" data-m="">${T.misiones.cancelar}</button>`
      : `<button class="btn sm" data-a="pick" data-m="${m.id}">${T.misiones.lista}</button>`;
    else if (m.status === 'pending') act = `<p class="hint">${T.misiones.pendiente(esc(pname(m.witness)))}</p><button class="btn sm alt" data-a="cancelClaim" data-m="${m.id}">${T.misiones.cancelar}</button>`;
    else act = `<p class="ok">✓ ${T.misiones.hecha}</p>`;
    return `<div class="card mis ${m.status}"><span class="pt">+${m.pts}</span><p><b>${esc(m.text)}</b></p>${act}</div>`;
  }).join('');
  return `${intro}<p class="hint">${T.misiones.intro}</p>${conf}${list}`;
}

function writeHTML() {
  const w = st.story, h = st.me.host;
  const force = h ? hostBtn('forceRound', T.historia.avanzar, 'alt') : '';
  const wt = w.waiting.length ? live('sw', T.historia.esperandoA(w.waiting.map(esc).join(', '))) : live('sw', '');
  if (w.espectador) return `<section class="card"><h2>${T.historia.titulo}</h2><p>${T.historia.espectador}</p>${wt}${force}</section>`;
  const prev = w.first
    ? `<p>${T.historia.empieza}</p><blockquote>${esc(w.prev)}</blockquote>`
    : `<p>${T.historia.anterior}</p><blockquote>${w.prev === null ? T.historia.saltada : esc(w.prev)}</blockquote><p class="hint">${T.historia.soloVes}</p>`;
  const form = w.done
    ? `<p class="ok">${T.historia.enviada}</p>`
    : `<input id="ss" data-d data-enter="submitSentence" maxlength="60" placeholder="${T.historia.placeholder}" autocomplete="off"><button class="btn" data-a="submitSentence">${T.historia.enviar}</button>`;
  return `<section class="card"><h2>${T.historia.titulo}</h2><p class="hint">${T.historia.ronda(w.round, w.total)}</p>${prev}${form}${wt}${force}</section>`;
}

function voteHTML() {
  const v = st.vote, h = st.me.host;
  const lines = v.lines.map(l => {
    const txt = l.text === null ? T.historia.saltada : esc(l.text);
    const dis = v.revealed || l.mine || l.text === null;
    const extra = v.revealed ? `<small>${l.author ? esc(l.author) : ''} · <b>${T.historia.votos(l.votes)}</b>${v.my === l.i ? ` · ${T.historia.miVoto}` : ''}</small>` : l.mine ? `<small>(${T.historia.tuya})</small>` : '';
    return `<button class="line ${v.my === l.i ? 'sel' : ''}" data-a="vote" data-i="${l.i}" ${dis ? 'disabled' : ''}>${txt}${extra}</button>`;
  }).join('');
  const foot = v.revealed
    ? (h ? hostBtn('nextStory', v.idx >= v.total ? T.historia.terminar : T.historia.siguiente) : wait())
    : live('vc', T.historia.avanceVotos(v.voted, st.players.length)) + (h ? hostBtn('revealVotes', T.historia.resultados, 'alt') : '');
  return `<section class="card"><p class="hint">${T.historia.historiaN(v.idx, v.total)}</p><h2>${T.historia.votar}</h2><blockquote>${esc(v.starter)}</blockquote>${v.revealed ? '' : `<p class="hint">${T.historia.instrVoto}</p>`}${lines}${foot}</section>`;
}

function endHTML() {
  const r = ranked(), pod = [r[1], r[0], r[2]], cls = ['p2', 'p1', 'p3'], med = ['🥈', '🥇', '🥉'];
  return `<section class="card"><h2 style="text-align:center">${T.fin.titulo}</h2><p class="big">${T.fin.felicidades(esc(r[0].name))}</p>
  <div class="podium">${pod.map((p, i) => p ? `<div class="pod ${cls[i]}"><div class="medal">${med[i]}</div><b>${esc(p.name)}</b><span>${p.total}</span><div class="bar"></div></div>` : '<div class="pod"></div>').join('')}</div>
  <h4>${T.fin.desglose}</h4><table><tr><th></th><th>${T.fin.encuesta}</th><th>${T.fin.misiones}</th><th>${T.fin.historia}</th><th>${T.fin.total}</th></tr>
  ${r.map(p => `<tr><td>${esc(p.name)}</td><td>${p.pts.encuesta}</td><td>${p.pts.misiones}</td><td>${p.pts.historia}</td><td>${p.total}</td></tr>`).join('')}</table>
  <p class="hint" style="text-align:center;margin-top:14px">${T.fin.gracias}</p>
  ${st.me.host ? hostBtn('resetGame', T.fin.otra, 'alt', `data-c="${esc(T.fin.confirmarOtra)}"`) : ''}</section>`;
}

// Devuelve [html, sub]; "sub" cambia cuando hay que soltar borradores de texto.
function phaseHTML() {
  if (tab === 'host' && st.me.host) return [hostHTML(), 'host'];
  if (tab === 'misiones' || st.phase === 'dinner') return [missionsHTML(), 'mis' + pick + st.missions.map(m => m.status).join()];
  switch (st.phase) {
    case 'feud': return [feudHTML(), `f${st.feud.round}-${st.feud.seq}-${st.feud.stage}`];
    case 'fastmoney': return [fmHTML(), `m${st.fm.seq}-${st.fm.stage}-${st.fm.revealN}`];
    case 'feud_done': return [feudDoneHTML(), 'fd'];
    case 'story_write': return [writeHTML(), `w${st.story.round}${st.story.done}`];
    case 'story_vote': return [voteHTML(), `v${st.vote.idx}${st.vote.revealed}${st.vote.my}`];
    case 'end': return [endHTML(), 'end'];
    default: return [lobbyHTML(), 'lobby'];
  }
}

// ---------- Pintado ----------
function paintMain(html, sub) {
  const m = $('#main'), key = tab + '|' + sub, f = document.activeElement;
  if (key === key0 && f && m.contains(f) && f.tagName === 'INPUT') {
    // Mientras escribes no se reconstruye la pantalla: solo se actualizan los contadores.
    const t = document.createElement('div'); t.innerHTML = html;
    t.querySelectorAll('[data-live]').forEach(n => { const o = m.querySelector(`[data-live="${n.dataset.live}"]`); if (o && o.innerHTML !== n.innerHTML) o.innerHTML = n.innerHTML; });
    return;
  }
  if (sub !== sub0) for (const k of Object.keys(drafts)) if (/^(fa|ss)/.test(k)) delete drafts[k];
  sub0 = sub; key0 = key;
  if (html === html0) return;
  html0 = html; m.innerHTML = html;
  m.querySelectorAll('[data-d]').forEach(i => { if (i.id in drafts) i.value = drafts[i.id]; });
}

const BG = { feud: 'blancas', fastmoney: 'tazon', feud_done: 'rayas', story_write: 'hojas', story_vote: 'unica', end: 'rayas' };
function render() {
  $('#title').textContent = T.titulo;
  document.body.dataset.bg = !st ? 'oscuras' : tab === 'misiones' || st.phase === 'dinner' ? 'calabacines' : BG[st.phase] || 'oscuras';
  const loggedIn = !!st;
  $('#code').textContent = loggedIn ? `${T.sala} ${st.code}` : '';
  $('#board').innerHTML = loggedIn ? boardHTML() : '';
  if (loggedIn) {
    if (tab === 'misiones' && !st.dinner) tab = 'juego';
    if (tab === 'host' && !st.me.host) tab = 'juego';
  }
  const pend = loggedIn ? st.toConfirm.length : 0;
  $('#banner').innerHTML = !up ? `<div class="warn">${T.sinConexion}</div>` : pend && tab !== 'misiones' && st.phase !== 'dinner' ? `<button class="warn2" data-a="tab" data-v="misiones">${T.misiones.banner(pend)}</button>` : '';
  const tabs = loggedIn ? [['juego', T.nav.juego], ...(st.dinner ? [['misiones', T.nav.misiones]] : []), ...(st.me.host ? [['host', T.nav.anfitrion]] : [])] : [];
  $('#nav').innerHTML = tabs.length > 1 ? tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}${k === 'misiones' && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('') : '';
  const [html, sub] = loggedIn ? phaseHTML() : token ? [`<p class="hint" style="text-align:center">${T.conectando}</p>`, 'conn'] : [joinHTML(), 'join'];
  paintMain(html, sub);
}

// ---------- Eventos ----------
const val = id => ($('#' + id) || {}).value || '';
const A = {
  team: d => { joinTeam = d.v; localStorage.setItem(K('team'), joinTeam); render(); },
  join: () => { const code = val('jc'); localStorage.setItem(K('code'), code); send({ t: 'join', name: val('jn'), code, team: joinTeam }); },
  tab: d => { tab = d.v; render(); },
  pick: d => { pick = d.m === '' ? null : +d.m; render(); },
  witness: d => { pick = null; send({ t: 'claim', mission: +d.m, witness: d.w }); },
  cancelClaim: d => send({ t: 'cancelClaim', mission: +d.m }),
  confirm: d => send({ t: 'confirm', claimer: d.c, mission: +d.m, ok: !!d.ok }),
  startFeud: () => { tab = 'juego'; send({ t: 'startFeud', rounds: +val('fr') || 4 }); },
  submitAnswer: () => send({ t: 'answer', text: val('fa'), seq: (st.phase === 'fastmoney' ? st.fm : st.feud).seq }),
  choose: d => send({ t: 'choose', play: d.v === '1' }),
  credit: d => send({ t: 'credit', idx: +d.i }),
  submitSentence: () => send({ t: 'sentence', text: val('ss'), round: st.story.round - 1 }),
  vote: d => send({ t: 'vote', i: +d.i }),
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a],[data-s]');
  if (e.target.closest('#board')) { boardOpen = !boardOpen; return render(); }
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.s) { if (d.c && !confirm(d.c)) return; if (d.go) tab = 'juego'; send({ t: d.s }); }
  else A[d.a] && A[d.a](d);
});
document.addEventListener('input', e => { if (e.target.dataset.d !== undefined) drafts[e.target.id] = e.target.value; });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.enter) A[e.target.dataset.enter](); });

render();
connect();
})();
