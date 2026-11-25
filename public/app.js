(() => {
'use strict';
const T = ES, $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ws, st = null, token = localStorage.getItem('dag_token');
let tab = 'juego', boardOpen = false, pick = null, up = false, retry = 0, toastT;
let drafts = {}, sub0 = '', key0 = '', html0 = '';

// ---------- Conexión ----------
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast(T.errores.sinConexion); };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3500);
}
function connect() {
  if (ws && ws.readyState < 2) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { up = true; retry = 0; if (token) send({ t: 'auth', token }); render(); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') { st = m; render(); }
    else if (m.t === 'joined') { token = m.token; localStorage.setItem('dag_token', token); }
    else if (m.t === 'badtoken') { token = null; st = null; localStorage.removeItem('dag_token'); render(); }
    else if (m.t === 'error') toast(T.errores[m.key] || T.errores.generico);
  };
  ws.onclose = () => { up = false; render(); setTimeout(connect, Math.min(4000, 400 * 2 ** retry++)); };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });

// ---------- Utilidades de vista ----------
const ranked = () => [...st.players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
const pname = id => (st.players.find(p => p.id === id) || {}).name || '?';
const live = (k, html, cls = 'count') => `<p class="${cls}" data-live="${k}">${html}</p>`;
const hostBtn = (s, label, cls = '', extra = '') => `<button class="btn ${cls}" data-s="${s}" ${extra}>${label}</button>`;
const wait = () => `<p class="hint" style="text-align:center">${T.esperaAnfitrion}</p>`;

function boardHTML() {
  const r = ranked();
  if (!boardOpen)
    return `<div class="chips">${r.map((p, i) => `<span class="chip ${p.id === st.me.id ? 'me' : ''} ${p.online ? '' : 'off'}"><b>${i + 1}</b>${esc(p.name)}<i>${p.total}</i></span>`).join('')}</div>`;
  return `<div class="rows">${r.map((p, i) => `<div class="row ${p.id === st.me.id ? 'me' : ''} ${p.online ? '' : 'off'}"><span class="n">${i + 1}</span><span class="nm">${esc(p.name)}${p.id === st.me.id ? ` <small>(${T.marcador.tu})</small>` : ''}${p.online ? '' : ` <small>· ${T.marcador.fuera}</small>`}</span><b>${p.total}</b></div>`).join('')}</div><p class="tip">${T.marcador.cerrar}</p>`;
}

const plist = () => `<ul class="pl" data-live="pl">${st.players.map(p => `<li class="${p.online ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}${p.host ? ` <span class="tag">${T.lobby.anfitrion}</span>` : ''}${p.id === st.me.id ? ` <small>(${T.marcador.tu})</small>` : ''}</li>`).join('')}</ul>`;

// ---------- Pantallas ----------
function joinHTML() {
  const c = new URLSearchParams(location.search).get('c') || localStorage.getItem('dag_code') || '';
  return `<section class="card"><p>${T.unirse.intro}</p>
  <label>${T.unirse.nombre}<input id="jn" data-d data-enter="join" maxlength="16" autocomplete="off" autocapitalize="words"></label>
  <label>${T.unirse.codigo}<input id="jc" data-d data-enter="join" value="${esc(c.toUpperCase())}" maxlength="4" autocomplete="off" autocapitalize="characters"></label>
  <button class="btn" data-a="join">${T.unirse.entrar}</button><p class="hint">${T.unirse.primero}</p></section>`;
}

function hostHTML() {
  return `<section class="card"><h2>${T.anfitrion.titulo}</h2><p class="hint">${T.anfitrion.nota}</p>
  <h4>${T.anfitrion.preguntas}</h4>
  ${st.prompts.map((q, i) => `<input id="hp${i}" data-d maxlength="90" value="${esc(q)}" aria-label="${i + 1}" autocomplete="off">`).join('')}
  <button class="btn" data-a="startSurvey">${T.anfitrion.iniciarEncuesta}</button>
  ${hostBtn('startGuess', T.anfitrion.adivinar, 'alt', 'data-go="1"')}
  ${hostBtn('startDinner', T.anfitrion.cena, 'alt', 'data-go="1"')}
  ${hostBtn('startStory', T.anfitrion.historia, 'alt', 'data-go="1"')}
  ${hostBtn('endGame', T.anfitrion.terminar, 'bad', `data-c="${esc(T.anfitrion.confirmarTerminar)}" data-go="1"`)}
  </section>`;
}

function lobbyHTML() {
  return `<section class="card"><h2>${T.lobby.titulo}</h2>${plist()}${st.me.host ? '' : `<p class="hint">${T.lobby.espera}</p>`}</section>${st.me.host ? hostHTML() : ''}`;
}

function surveyHTML() {
  const body = st.answered
    ? `<p class="ok">${T.encuesta.listo}</p>`
    : `<p>${T.encuesta.instruccion}</p>` + st.prompts.map((q, i) => `<label>${i + 1}. ${esc(q)}<input id="sa${i}" data-d maxlength="40" placeholder="${T.encuesta.placeholder}" autocomplete="off"></label>`).join('') + `<button class="btn" data-a="submitSurvey">${T.encuesta.enviar}</button>`;
  return `<section class="card"><h2>${T.encuesta.titulo}</h2>${body}${live('sc', T.encuesta.avance(st.answeredCount, st.players.length))}${st.me.host ? hostBtn('startGuess', T.encuesta.adivinar, 'alt') : ''}</section>`;
}

function guessHTML() {
  const g = st.guess, h = st.me.host;
  let b = `<p class="hint">${T.adivina.ronda(g.idx + 1, g.total)}</p><h3 class="q">${esc(g.prompt)}</h3>`;
  if (!g.revealed) {
    b += `<p>${T.adivina.instruccion}</p>` + (g.mine ? `<p class="ok">${T.adivina.tuIntento} <b>${esc(g.mine)}</b></p>` : '') +
      `<input id="ga" data-d data-enter="submitGuess" maxlength="40" placeholder="${T.adivina.placeholder}" autocomplete="off">
      <button class="btn" data-a="submitGuess">${g.mine ? T.adivina.cambiar : T.adivina.enviar}</button>` +
      live('gc', T.adivina.avance(g.submitted, st.players.length)) + (h ? hostBtn('revealGuess', T.adivina.revelar, 'alt') : '');
  } else {
    const r = g.results, mine = r.guesses.find(x => x.pid === st.me.id);
    b += `<p class="big">${mine ? T.adivina.ganaste(mine.pts) : T.adivina.sinIntento}</p>
      <h4>${T.adivina.ranking}</h4><ul class="rank">${r.clusters.map(c => `<li><span>${esc(c.label)}</span><b>${T.adivina.personas(c.count)}</b></li>`).join('')}</ul>
      <h4>${T.adivina.intentos}</h4><ul class="rank">${r.guesses.map(x => `<li><span>${esc(pname(x.pid))}: ${esc(x.text)}</span><b>+${x.pts}</b></li>`).join('')}</ul>` +
      (h ? hostBtn('nextGuess', g.idx + 1 >= g.total ? T.adivina.terminar : T.adivina.siguiente) : wait());
  }
  return `<section class="card"><h2>${T.adivina.titulo || ''}</h2>${b}</section>`;
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
    case 'survey': return [surveyHTML(), 'sv' + !!st.answered];
    case 'guess': return [guessHTML(), `g${st.guess.idx}${st.guess.revealed}${st.guess.mine || ''}`];
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
  if (sub !== sub0) for (const k of Object.keys(drafts)) if (/^(sa|ga|ss)/.test(k)) delete drafts[k];
  sub0 = sub; key0 = key;
  if (html === html0) return;
  html0 = html; m.innerHTML = html;
  m.querySelectorAll('[data-d]').forEach(i => { if (i.id in drafts) i.value = drafts[i.id]; });
}

function render() {
  $('#title').textContent = T.titulo;
  const BG = { survey: 'tazon', guess: 'blancas', story_write: 'hojas', story_vote: 'unica', end: 'rayas' };
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
  join: () => { const code = val('jc'); localStorage.setItem('dag_code', code); send({ t: 'join', name: val('jn'), code }); },
  tab: d => { tab = d.v; render(); },
  pick: d => { pick = d.m === '' ? null : +d.m; render(); },
  witness: d => { pick = null; send({ t: 'claim', mission: +d.m, witness: d.w }); },
  cancelClaim: d => send({ t: 'cancelClaim', mission: +d.m }),
  confirm: d => send({ t: 'confirm', claimer: d.c, mission: +d.m, ok: !!d.ok }),
  startSurvey: () => { tab = 'juego'; send({ t: 'startSurvey', prompts: [0, 1, 2, 3, 4, 5].map(i => val('hp' + i) || (st.prompts[i] || '')) }); },
  submitSurvey: () => send({ t: 'survey', answers: [0, 1, 2, 3, 4, 5].map(i => val('sa' + i)) }),
  submitGuess: () => send({ t: 'guess', text: val('ga') }),
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
