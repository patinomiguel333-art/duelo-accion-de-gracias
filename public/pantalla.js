(() => {
'use strict';
const T = ES, E = T.equipos, $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let st = null, prev = null, ws, retry = 0, joinUrl = location.origin, html0 = '', skew = 0, voice = false;
const BG = { feud: 'blancas', fastmoney: 'tazon', feud_done: 'rayas', story_write: 'hojas', story_vote: 'unica', end: 'rayas', dinner: 'calabacines' };

// En localhost los teléfonos no pueden usar esa dirección: se muestra la de la red local.
fetch('/info').then(r => r.json()).then(i => { if (/localhost|127\./.test(location.hostname) && i.urls[0]) joinUrl = i.urls[0]; render(); }).catch(() => {});

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'screen' })); };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'state') { prev = st; st = m; skew = m.now - Date.now(); announce(prev, st); render(); } };
  ws.onclose = () => setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
}

const ranked = () => [...st.players].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
const emo = p => (p.team ? E[p.team].e : '');
const team = t => `<div class="tm ${t}"><span>${E[t].e} ${E[t].n}</span><b>${st.feud ? st.feud.score[t] : st.feudScore ? st.feudScore[t] : ''}</b></div>`;
const head = () => `<div class="tvh"><h1>${T.titulo}</h1><div class="join">Entra desde tu teléfono: <b>${esc(joinUrl.replace(/^https?:\/\//, ''))}</b><br>${T.sala}: <b>${st.code}</b></div></div>`;

function lobby() {
  const col = t => `<div class="tm ${t}" style="align-items:stretch;text-align:left"><span style="font-size:1.6rem">${E[t].e} ${E[t].n} <small>(${E[t].sub})</small></span>${st.players.filter(p => p.team === t).map(p => `<span style="font-size:1.6rem;opacity:${p.online ? 1 : .45}">• ${esc(p.name)}${p.host ? ' ★' : ''}</span>`).join('')}</div>`;
  return `${head()}<div class="tvbig"><h2>${T.lobby.titulo}</h2><p>${T.duelo.subtitulo}</p></div><div class="tvteams">${col('m')}${col('h')}</div>`;
}

const cd = dl => (dl ? `<span class="cd" data-dl="${dl}"></span>` : '');
setInterval(() => document.querySelectorAll('.cd').forEach(e => {
  const sec = Math.max(0, Math.ceil((+e.dataset.dl - (Date.now() + skew)) / 1000));
  e.textContent = T.duelo.tiempo(sec); e.classList.toggle('low', sec <= 5);
}), 250);

// El presentador (la computadora) habla en español si activas la voz con el botón.
function say(text) {
  if (!voice || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, '')); u.lang = 'es-MX'; u.rate = 1.02;
  const v = speechSynthesis.getVoices().find(x => /^es[-_]MX/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^es/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function announce(a, b) {
  if (b.phase === 'feud') {
    const f = b.feud, was = a && a.phase === 'feud' ? a.feud : null, out = [];
    if (!was || was.round !== f.round) out.push(`Ronda ${f.round}.${f.mult > 1 ? ` ¡Los puntos valen por ${f.mult}!` : ''} ${f.question}`);
    else if (was.seq === f.seq) return;
    if (was && was.round === f.round && f.last && JSON.stringify(f.last) !== JSON.stringify(was.last)) {
      out.push(f.last.hit ? `¡La encuesta dice! ${f.last.label}, número ${f.last.rank}, ${f.last.pts} puntos.` : f.last.text === T.duelo.sinRespuesta ? 'Se acabó el tiempo. ¡Error!' : '¡Error!');
    }
    if (f.stage === 'buzz') out.push(`Cara a cara: ${f.pair.m.name} contra ${f.pair.h.name}. ¡A ver quién toca primero!`);
    else if (f.stage === 'fo2') out.push(`Ahora responde ${f.active.name}.`);
    else if (f.stage === 'choose') out.push(`${f.active.name} ganó el cara a cara. ¿Juegan o pasan?`);
    else if (f.stage === 'steal' && (!was || was.stage !== 'steal')) out.push(`¡Tres errores! ${E[f.active.team].n} pueden robar con una sola respuesta.`);
    else if (f.stage === 'play' && was && was.stage === 'choose') out.push(`Juega ${E[f.control].n}. Le toca a ${f.active.name}.`);
    else if (f.stage === 'play' && f.active && was && was.active && was.active.id !== f.active.id) out.push(`Le toca a ${f.active.name}.`);
    else if (f.stage === 'done') out.push(`${E[f.result.winner].n} se lleva ${f.result.pts} puntos.`);
    if (out.length) say(out.join(' '));
  } else if (b.phase === 'fastmoney') {
    const fm = b.fm, was = a && a.phase === 'fastmoney' ? a.fm : null;
    if (!was) say(`Ronda relámpago. ${fm.team ? E[fm.team].n : ''} necesitan ${fm.goal} puntos.`);
    if (fm.stage === 'play' && (!was || was.seq !== fm.seq)) say(`${fm.question}. Responde ${fm.active.name}.`);
    if (fm.stage === 'reveal' && was && was.revealN !== fm.revealN) {
      const r = fm.rows.find(x => x.lines.some(l => l.a.some(Boolean))) ; void r;
    }
    if (fm.stage === 'done' && (!was || was.stage !== 'done')) say(fm.teams.map(t => fm.win[t] ? `${E[t].n} lograron el gran premio.` : `${E[t].n} no llegaron a ${fm.goal}.`).join(' '));
  }
}

function feud() {
  const f = st.feud, done = f.stage === 'done', n = f.slots.length;
  const slots = f.slots.map((s, i) => s.label
    ? `<li class="slot open ${s.found ? '' : 'miss'}"><span>${esc(s.label)}</span><b>${s.pts}</b></li>`
    : `<li class="slot"><span>${i + 1}</span></li>`).join('');
  const strikes = `<div class="strikes">${[0, 1, 2].map(i => `<span class="${i < f.strikes ? 'on' : ''}">✖</span>`).join('')}</div>`;
  let who = '';
  if (f.stage === 'buzz') who = `<p class="steal">${T.duelo.caraACara}</p><div>${E.m.e} <b>${esc(f.pair.m.name)}</b> vs ${E.h.e} <b>${esc(f.pair.h.name)}</b></div><div class="hint">${T.duelo.buzzInstr}</div>`;
  else if (f.stage === 'fo1') who = `<p class="steal">${T.duelo.caraACara}</p><div>${T.duelo.primero(`<b>${esc(f.first.name)}</b>`)}</div>`;
  else if (f.stage === 'fo2') who = `<p class="steal">${T.duelo.caraACara}</p><div>${T.duelo.segundo(`<b>${esc(f.active.name)}</b>`)}</div>`;
  else if (f.stage === 'choose') who = `<div>${T.duelo.elegir(`<b>${esc(f.active.name)}</b>`)}</div>`;
  else if (done) who = `<p class="big">${T.duelo.resultado(E[f.result.winner].n, f.result.pts)}</p>`;
  else if (f.active) who = (f.stage === 'steal' ? `<p class="steal">${T.duelo.robo}</p>` : '') + `<div>${E[f.active.team].e} ${T.duelo.turno(`<b>${esc(f.active.name)}</b>`)}</div>`;
  const last = f.last ? `<div class="${f.last.hit ? 'ok' : 'badtx'}" style="font-size:1.2rem">${(f.last.hit ? T.duelo.acierto : T.duelo.fallo)(esc(f.last.name), esc(f.last.text))}</div>` : '';
  return `<div class="tvh"><h1 style="font-size:2.2rem">${T.duelo.titulo}</h1><div class="join">${T.duelo.ronda(f.round, f.total, f.mult)} ${cd(f.deadline)}</div></div>
  <div class="tvteams">${['m', 'h'].map(t => team(t).replace('class="tm ', `class="tm ${!done && f.control === t ? 'on ' : ''}`)).join('')}</div>
  <div class="tvq">${esc(f.question)}</div><ul class="tvboard slots" style="--rows:${Math.ceil(n / 2)}">${slots}</ul>
  <div class="tvfoot">${strikes}<div class="who">${who}${last}</div><div>${T.duelo.banco(f.bank)}</div></div>`;
}

function fm() {
  const m = st.fm;
  if (m.stage === 'play') return `<div class="tvh"><h1 style="font-size:2.2rem">${T.relampago.titulo}</h1><div class="join">${T.relampago.pregunta(m.q)} ${cd(m.deadline)}</div></div>
  <div class="tvbig"><p>${T.relampago.intro(`${E[m.team].e} ${E[m.team].n}`, m.players[m.team].map(esc).join(' y '))}</p><div class="tvq" style="font-size:3rem">${esc(m.question)}</div><p>${T.relampago.turno(`<b>${esc(m.active.name)}</b>`)}</p><p class="hint">${T.relampago.meta}</p></div>`;
  return `<div class="tvh"><h1 style="font-size:2.2rem">${T.relampago.titulo}</h1><div class="join">${T.relampago.meta}</div></div>
  <div style="display:flex;gap:18px;overflow:auto">${m.rows.map(r => `<div style="flex:1"><h3 style="font-family:var(--script);font-weight:400;font-size:2rem;margin:6px 0">${E[r.team].e} ${E[r.team].n}</h3>
  ${r.lines.map(l => `<div class="tvline" style="padding:8px 14px;font-size:1.2rem"><small>${esc(l.question)}</small>${l.a.map(a => `<span style="display:inline-block;min-width:48%">${a ? `${esc(a.text)} <b>${a.pts}</b>` : '···'}</span>`).join('')}</div>`).join('')}
  <p class="big" style="font-size:2.2rem">${T.relampago.total(r.total)}</p>${m.win ? (m.win[r.team] ? `<p class="big">${T.relampago.premio(E[r.team].n)}</p>` : `<p class="hint">${T.relampago.sinPremio(E[r.team].n, r.total)}</p>`) : ''}</div>`).join('')}</div>`;
}

function feudDone() {
  const s = st.feudScore, w = s.h === s.m ? null : s.h > s.m ? 'h' : 'm';
  const f = st.fm ? st.fm.teams.map(t => st.fm.win[t] ? `<p class="big">${T.relampago.premio(E[t].n)}</p>` : '').join('') : '';
  return `${head()}<div class="tvteams">${['m', 'h'].map(t => team(t).replace('class="tm ', `class="tm ${w === t ? 'on ' : ''}`)).join('')}</div><div class="tvbig"><h2>${w ? T.duelo.gana(E[w].n) : T.duelo.empate}</h2>${f}</div>`;
}

function story() {
  if (st.phase === 'story_write') return `<div class="tvbig"><h2>${T.historia.titulo}</h2><p>Escriban su frase en el teléfono. Solo verán la frase anterior.</p><p class="hint">${st.story && st.story.waiting.length ? T.historia.esperandoA(st.story.waiting.map(esc).join(', ')) : ''}</p></div>`;
  const v = st.vote;
  return `<div class="tvh"><h1 style="font-size:2.2rem">${T.historia.votar}</h1><div class="join">${T.historia.historiaN(v.idx, v.total)}</div></div>
  <div class="tvline top"><i>${esc(v.starter)}</i></div>
  ${v.lines.map(l => `<div class="tvline">${l.text === null ? T.historia.saltada : esc(l.text)}${v.revealed ? `<small>${l.author ? esc(l.author) : ''} · ${T.historia.votos(l.votes)}</small>` : ''}</div>`).join('')}
  ${v.revealed ? '' : `<p class="count">${T.historia.avanceVotos(v.voted, st.players.length)}</p>`}`;
}

function end() {
  const r = ranked(), cls = ['p2', 'p1', 'p3'], med = ['🥈', '🥇', '🥉'], pod = [r[1], r[0], r[2]];
  return `<div class="tvbig" style="margin:0 auto"><h2>${T.fin.titulo}</h2><p class="big">${T.fin.felicidades(esc(r[0].name))}</p>
  <div class="podium">${pod.map((p, i) => p ? `<div class="pod ${cls[i]}"><div class="medal">${med[i]}</div><b>${esc(p.name)}</b><span>${p.total}</span><div class="bar"></div></div>` : '<div class="pod"></div>').join('')}</div>
  <table class="tvpodium"><tr><th></th><th>${T.fin.encuesta}</th><th>${T.fin.misiones}</th><th>${T.fin.historia}</th><th>${T.fin.total}</th></tr>${r.map(p => `<tr><td>${esc(p.name)}</td><td>${p.pts.encuesta}</td><td>${p.pts.misiones}</td><td>${p.pts.historia}</td><td>${p.total}</td></tr>`).join('')}</table></div>`;
}

function render() {
  const t = $('#tv');
  if (!st) { t.innerHTML = `<div class="tvbig"><h2>${T.titulo}</h2><p>${T.conectando}</p></div>`; return; }
  document.body.dataset.bg = BG[st.phase] || 'oscuras';
  const main = { feud, fastmoney: fm, feud_done: feudDone, story_write: story, story_vote: story, end,
    dinner: () => `${head()}<div class="tvbig"><h2>${T.misiones.titulo}</h2><p>${T.misiones.cena}</p></div>` }[st.phase] || lobby;
  const html = `<div class="main">${main()}</div><div class="side"><h3>Marcador</h3>${ranked().map((p, i) => `<div class="row ${p.online ? '' : 'off'}"><span class="n">${i + 1}</span><span class="nm">${emo(p)} ${esc(p.name)}</span><b>${p.total}</b></div>`).join('')}</div>`;
  if (html !== html0) { html0 = html; t.innerHTML = html; }
  const vb = document.getElementById('vz'); if (vb) vb.textContent = voice ? '🔊 Voz activada' : '🔇 Activar voz del presentador';
}

document.body.insertAdjacentHTML('beforeend', '<button id="vz" style="position:fixed;right:18px;bottom:12px;z-index:9;background:#2d3a36;color:#fff6e4;border:1px solid #fff4;border-radius:10px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer"></button>');
document.getElementById('vz').onclick = () => { voice = !voice; if (voice) say('Hola, soy el presentador. ¡Que comience el duelo familiar!'); else speechSynthesis.cancel(); render(); };
render();
connect();
})();
