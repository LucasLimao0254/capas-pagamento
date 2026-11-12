'use strict';
/* ===================== Constantes ===================== */
const STATUS = [
  { id: 'recebido', label: 'Recebido', cor: '#3D5A73' },
  { id: 'pendente_pagamento', label: 'Pendente pagamento', cor: '#B3541E' },
  { id: 'pendente_certidao', label: 'Pendente certidão', cor: '#8A6D00' },
  { id: 'pago', label: 'Pago', cor: '#2E7D4F' },
  { id: 'devolvido', label: 'Devolvido', cor: '#A33A3A' },
];
const stInfo = id => STATUS.find(s => s.id === id) || STATUS[0];
const CAMPOS_NUM = ['valor', 'iss_valor', 'irrf_valor', 'valor_liquido'];

const PROMPT = `Você lê fotos de capas de processo de pagamento da Prefeitura de Maracaçumé (folha amarela FUNDEB/SEMED, azul Saúde/FMUS, rosa Assistência Social/FMAS-SEMAS, branca Administração Municipal). O formulário é preenchido à mão.

Extraia: Credor, Empenho, Valor, ISS (R$), IRRF (R$), Valor Líquido, Mês, Referente.

Como é o formulário (impresso, igual em todas as cores):
- No alto: "Credor:", depois "Empenho:" (à esquerda) e "Doc. Caixa nº" (à direita), depois "Sub Empenho nº".
- Abaixo de uma linha grossa, a coluna da esquerda tem os rótulos Valor, ISS, IRRF, INSS, Consignações, Contribuição Sindical, Outros Descontos e Valor Líquido, cada um com um espaço em branco e depois "R$ ______" onde vai o valor em reais. A coluna da direita tem Cheque, Recurso, Data e Mês.
- Por fim "Referente:" com várias linhas.

Regras:
- O valor em reais é o que está escrito depois do "R$" daquela linha. O que está escrito no espaço entre o rótulo e o "R$" costuma ser o percentual (ex.: "0,24%", "4,8"): não é o valor.
- Se alguém escreveu à mão o nome de outro imposto no espaço da linha (ex.: "IRRF:" escrito na linha do ISS), o valor daquela linha pertence ao imposto escrito à mão.
- Use sempre o valor em R$, nunca o percentual. Se houver duas alíquotas no campo IRRF, as duas são IRRF: some em irrf_valor (não separe em ISS).
- O formulário costuma estar inclinado na foto. Um número na altura entre "Valor" e "ISS" é o Valor, não ISS. Só preencha iss_valor quando o número estiver claramente na linha do ISS e o Valor também estiver preenchido.
- Campo vazio = null. Referente vazio = "N/D". Empenho e mês vazios = "".
- Padronize o referente: "Nº 147/2026-SEMED", "Contrato Nº 150/2026-SEMED", "Contrato Nº 149/2026-PNAE".
- Leia os números com muito cuidado (4 x 9, 1 x 7, 3 x 8). Confira se Valor - ISS - IRRF = Valor Líquido para tirar dúvida de dígitos, mas transcreva o que está escrito na capa, mesmo que a conta não feche.
- Números como número decimal (1234.56), sem separador de milhar. Na capa a vírgula separa os centavos e o ponto separa os milhares.
- Mês: copie como escrito no campo "Mês" (ex.: "09/2026"). Não use o campo "Data" no lugar do mês.
- Se houver desconto em INSS, Consignações, Contribuição Sindical ou Outros Descontos, informe em "observacao" (ex.: "INSS R$ 120,00").
- Anotações à mão fora dos campos (ex.: "Corrigir Empenho" no alto da folha) também vão em "observacao". Sem nada a anotar, "".
- "duvida" é só para incerteza real: um dígito ou palavra que você não conseguiu decidir entre duas leituras e que muda o resultado (ex.: "Valor: 1.098,50 ou 7.098,50"). Nesse caso diga as duas leituras possíveis e liste os campos em "duvida_campos".
- NÃO escreva dúvida quando: a letra é difícil mas você conseguiu ler; a conta Valor - ISS - IRRF = Valor Líquido fecha com o que você leu (a conta confirma os números); o campo está em branco; ou só para dizer que conferiu. Na grande maioria das capas "duvida" deve ser "" e "duvida_campos" deve ser [].
- Se a imagem não for uma capa de processo, devolva credor "" e explique em "duvida".

Responda somente com o JSON.`;

const SCHEMA = {
  type: 'object',
  properties: {
    credor: { type: 'string' },
    empenho: { type: 'string' },
    valor: { type: ['number', 'null'] },
    iss_valor: { type: ['number', 'null'] },
    irrf_valor: { type: ['number', 'null'] },
    valor_liquido: { type: ['number', 'null'] },
    mes: { type: 'string' },
    referente: { type: 'string' },
    observacao: { type: 'string' },
    duvida: { type: 'string' },
    duvida_campos: { type: 'array', items: { type: 'string', enum: ['credor', 'empenho', 'valor', 'iss_valor', 'irrf_valor', 'valor_liquido', 'mes', 'referente'] } },
  },
  required: ['credor', 'empenho', 'valor', 'iss_valor', 'irrf_valor', 'valor_liquido', 'mes', 'referente', 'observacao', 'duvida', 'duvida_campos'],
  additionalProperties: false,
};

/* ===================== Utilidades ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const fmt = v => v == null ? '-' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtIn = v => v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoje = () => new Date().toLocaleDateString('pt-BR');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function parseNum(s) {
  s = String(s ?? '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : null;
}
let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms);
}

/* ===================== Armazenamento (IndexedDB) ===================== */
let state = { capas: [], titulo: 'Pagamento' };
const cfg = {
  get apiKey() { return localStorage.getItem('apiKey') || ''; },
  set apiKey(v) { localStorage.setItem('apiKey', v); },
  get modelo() { return localStorage.getItem('modelo') || 'claude-opus-5-5'; },
  set modelo(v) { localStorage.setItem('modelo', v); },
  get modo() { return localStorage.getItem('modo2') || 'claude'; },
  set modo(v) { localStorage.setItem('modo2', v); },
};
function abrirDB() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('capas-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function carregar() {
  try {
    const db = await abrirDB();
    const v = await new Promise((ok, no) => {
      const q = db.transaction('kv').objectStore('kv').get('state');
      q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
    });
    if (v && Array.isArray(v.capas)) state = v;
  } catch (e) { console.error(e); }
  // leituras interrompidas viram erro para poder tentar de novo
  state.capas.forEach(c => { if (c.lendo) { c.lendo = false; c.erro = 'Leitura interrompida.'; } });
}
let salvarT;
function salvar() {
  clearTimeout(salvarT);
  salvarT = setTimeout(async () => {
    try {
      const db = await abrirDB();
      db.transaction('kv', 'readwrite').objectStore('kv').put(state, 'state');
    } catch (e) { console.error(e); toast('Não foi possível salvar no aparelho.'); }
  }, 150);
}

/* ===================== Checagens ===================== */
const IRRF_OK = [4.8, 1.2, 0.24, 6.0, 5.04, 1.44];
const ISS_OK = [2, 2.5, 3, 4, 5];
const perto = (p, lista) => lista.some(x => Math.abs(p - x) <= 0.02);
function checar(c) {
  const p = [];
  let contaFecha = false;
  if (c.valor != null && c.valor_liquido != null) {
    const esp = r2(c.valor - (c.iss_valor || 0) - (c.irrf_valor || 0));
    contaFecha = Math.abs(esp - c.valor_liquido) <= 0.009;
    if (!contaFecha) p.push({ t: `Líquido esperado ${fmt(esp)} × escrito ${fmt(c.valor_liquido)}`, grave: true });
  }
  if (c.valor) {
    if (c.irrf_valor != null) {
      const pc = c.irrf_valor / c.valor * 100;
      if (!perto(pc, IRRF_OK)) p.push({ t: `IRRF = ${pc.toFixed(2).replace('.', ',')}% do valor (padrão 4,8 / 1,2 / 0,24%)` });
    }
    if (c.iss_valor != null) {
      const pc = c.iss_valor / c.valor * 100;
      if (!perto(pc, ISS_OK)) p.push({ t: `ISS = ${pc.toFixed(2).replace('.', ',')}% do valor (padrão 5%)` });
    }
  }
  // Dúvida só sobre valores some quando a conta Valor - ISS - IRRF = Líquido fecha:
  // a própria conta confirma os números. Dúvida sobre nome, empenho etc. continua.
  if (c.duvida) {
    const campos = Array.isArray(c.duvida_campos) ? c.duvida_campos : null;
    const soValores = campos ? campos.every(k => CAMPOS_NUM.includes(k)) : true;
    if (!(contaFecha && soValores)) p.push({ t: 'Dúvida na leitura: ' + c.duvida, duvida: true });
  }
  return p;
}
const chaveDup = c => [c.credor, c.empenho, c.valor, c.valor_liquido, c.referente].join('|').toLowerCase();
function duplicadas(lista) {
  const m = {}; lista.forEach(c => { if (!c.lendo && !c.erro) (m[chaveDup(c)] ||= []).push(c.id); });
  const s = new Set(); Object.values(m).forEach(ids => { if (ids.length > 1) ids.forEach(i => s.add(i)); });
  return s;
}

/* ===================== Agrupamento ===================== */
const daLista = () => state.capas.filter(c => c.naLista);
function grupos(lista) {
  const g = {};
  lista.forEach(c => (g[c.credor || '(sem credor)'] ||= []).push(c));
  return Object.keys(g).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(k => ({
    credor: k, itens: g[k],
    total: r2(g[k].reduce((s, c) => s + (c.valor != null ? c.valor : (c.valor_liquido || 0)), 0)),
  }));
}

/* ===================== Excluir ===================== */
const BTN_DEL = id => `<button class="del" data-del="${id}" aria-label="Excluir"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>`;
function excluirCapa(id) {
  const c = state.capas.find(x => x.id === id); if (!c) return;
  const nome = c.credor || 'esta capa';
  if (!confirm(`Excluir ${nome}${c.valor != null || c.valor_liquido != null ? ' (' + fmt(c.valor != null ? c.valor : c.valor_liquido) + ')' : ''}?\nSai da lista e do Status.`)) return;
  const i = fila.indexOf(c); if (i >= 0) fila.splice(i, 1);
  state.capas = state.capas.filter(x => x.id !== id);
  salvar(); render(); toast('Capa excluída.');
}

/* ===================== Renderização: Lista ===================== */
function renderLista() {
  const lista = daLista();
  const dups = duplicadas(lista);
  const lendo = lista.filter(c => c.lendo).length;
  $('hInfo').textContent = lista.length ? `${lista.length} capa${lista.length > 1 ? 's' : ''}` : '';
  let html = '', n = 1, avisos = [];
  for (const g of grupos(lista)) {
    html += `<div class="grupo"><h3>${esc(g.credor)}</h3>`;
    for (const c of g.itens) {
      const num = n++;
      const pr = c.lendo || c.erro ? [] : checar(c);
      if (dups.has(c.id)) pr.push({ t: 'Possível duplicata — confirme se são duas capas', grave: true });
      pr.forEach(x => avisos.push(`Nº ${num} (${c.credor}): ${x.t}`));
      const st = stInfo(c.status);
      html += `<div class="item" data-id="${c.id}">
        <div class="n">${num}</div>
        ${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}
        <div class="c">${c.lendo ? `<div class="t"><span><span class="spin"></span> Lendo capa…</span></div>`
          : c.erro ? `<div class="t"><span>Não foi possível ler</span></div><div class="aviso">${esc(c.erro)} Toque para tentar de novo ou preencher.</div>`
          : `<div class="t"><span>${esc(c.empenho || '-')}</span><span>${fmt(c.valor != null ? c.valor : c.valor_liquido)}</span></div>
            <div class="d">Líq. ${fmt(c.valor_liquido)} · ISS ${c.iss_valor != null ? `<b>${fmt(c.iss_valor)}</b>` : '-'} · IRRF ${c.irrf_valor != null ? `<b>${fmt(c.irrf_valor)}</b>` : '-'}</div>
            <div class="d">${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''} · <span class="pill" style="background:${st.cor}">${st.label}</span></div>
            ${pr.map(x => `<div class="aviso ${x.grave ? '' : 'am'}">⚠ ${esc(x.t)}</div>`).join('')}
            ${c.local ? `<div class="aviso am">Lido no aparelho — toque e confira com a foto</div>` : ''}`}
        </div>${BTN_DEL(c.id)}</div>`;
    }
    html += `<div class="subt"><span>SUBTOTAL</span><span>${fmt(g.total)}</span></div></div>`;
  }
  $('lista').innerHTML = html || `<div class="vazio">Nenhuma capa na lista.<br>Toque em <b>Adicionar capas</b> e escolha ou tire as fotos.</div>`;
  const total = r2(lista.reduce((s, c) => s + (c.valor != null ? c.valor : (c.valor_liquido || 0)), 0));
  $('resumo').innerHTML = !lista.length ? '' : `<div class="card">
    <b>${lista.length} capa${lista.length > 1 ? 's' : ''}</b> · total ${fmt(total)}${lendo ? ` · <span class="spin"></span> lendo ${lendo}…` : ''}
    ${avisos.length ? `<div style="margin-top:6px"><b style="color:var(--err)">Conferir (${avisos.length}):</b>${avisos.map(a => `<div class="aviso">${esc(a)}</div>`).join('')}</div>`
      : (lendo ? '' : `<div class="muted" style="margin-top:4px">Valores conferidos: sem divergências.</div>`)}
  </div>`;
}

/* ===================== Renderização: Status ===================== */
let filtro = 'todos';
function renderStatus() {
  const todas = state.capas.filter(c => !c.lendo);
  const cont = {}; todas.forEach(c => cont[c.status] = (cont[c.status] || 0) + 1);
  $('chips').innerHTML = `<button data-f="todos" class="${filtro === 'todos' ? 'on' : ''}">Todos (${todas.length})</button>` +
    STATUS.map(s => `<button data-f="${s.id}" class="${filtro === s.id ? 'on' : ''}">${s.label} (${cont[s.id] || 0})</button>`).join('');
  const q = $('busca').value.trim().toLowerCase();
  const vis = todas.filter(c => (filtro === 'todos' || c.status === filtro) &&
    (!q || [c.credor, c.empenho, c.referente, c.nota, c.mes].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  $('statusLista').innerHTML = vis.length ? vis.map(c => {
    const st = stInfo(c.status);
    return `<div class="card" style="padding:10px 12px">
      <div class="item" data-id="${c.id}" style="padding:0;border:0">
        <div class="c">
          <div class="t"><span>${esc(c.credor || '(sem credor)')}</span><span>${fmt(c.valor != null ? c.valor : c.valor_liquido)}</span></div>
          <div class="d">${esc(c.empenho || '-')} · ${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''}</div>
          ${c.nota ? `<div class="d">📝 ${esc(c.nota)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">
        <select class="st-sel" data-sid="${c.id}" style="background:${st.cor}">${STATUS.map(s => `<option value="${s.id}" ${s.id === c.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        <span class="muted" style="flex:1;text-align:right">${c.statusEm ? 'desde ' + new Date(c.statusEm).toLocaleDateString('pt-BR') : ''}</span>
        ${BTN_DEL(c.id)}
      </div></div>`;
  }).join('') : `<div class="vazio">Nenhum processo${filtro !== 'todos' || q ? ' neste filtro' : ''}.</div>`;
}
function render() { renderLista(); renderStatus(); }

/* ===================== Imagens ===================== */
async function reduzir(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Imagem inválida')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}

/* ===================== Leitura com a API do Claude ===================== */
async function chamarClaude(dataUrl) {
  const modelo = cfg.modelo;
  const headers = {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model: modelo,
    max_tokens: 16000,
    system: PROMPT,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } },
        { type: 'text', text: 'Leia esta capa de processo de pagamento.' },
      ],
    }],
  };
  if (modelo !== 'claude-haiku-5-5') { // fallback automático do servidor caso o modelo recuse
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  for (let tent = 0; ; tent++) {
    let resp;
    try { resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (e) { if (tent < 2) { await new Promise(r => setTimeout(r, 1500 * (tent + 1))); continue; } throw new Error('Sem conexão com a internet.'); }
    if (resp.ok) {
      const j = await resp.json();
      if (j.stop_reason === 'refusal') throw new Error('O modelo recusou ler esta imagem.');
      if (j.stop_reason === 'max_tokens') throw new Error('Resposta incompleta.');
      const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const m = txt.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Resposta sem dados.');
      return JSON.parse(m[0]);
    }
    if ((resp.status === 429 || resp.status >= 500) && tent < 3) {
      const ra = Number(resp.headers.get('retry-after')) || 2 * (tent + 1);
      await new Promise(r => setTimeout(r, Math.min(ra, 20) * 1000)); continue;
    }
    let msg = ''; try { msg = (await resp.json()).error?.message || ''; } catch { }
    if (resp.status === 401) throw new Error('Chave da API inválida (veja Ajustes).');
    if (resp.status === 429) throw new Error('Limite de uso da API atingido. Tente em instantes.');
    throw new Error(`Erro ${resp.status}. ${msg}`.trim());
  }
}
/* ===================== Leitura no aparelho (OCR, sem API) ===================== */
let ocrWorker = null, ocrFila = Promise.resolve();
async function ocr(dataUrl) {
  if (!window.Tesseract) throw new Error('Leitor não carregado. Abra o app com internet uma vez.');
  const tarefa = ocrFila.then(async () => {
    if (!ocrWorker) {
      try { ocrWorker = await Tesseract.createWorker('por'); }
      catch (e) { ocrWorker = null; throw new Error('Não foi possível carregar o leitor. Na primeira vez é preciso internet.'); }
    }
    return (await ocrWorker.recognize(dataUrl)).data.text || '';
  });
  ocrFila = tarefa.catch(() => { });
  return tarefa;
}
const RE_DIN = /\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d+,\d{2}/g;
const RE_ROTULO = /\b(credor|empenho|valor|iss|irrf|m[eê]s|referente)\b/i;
function dinheiro(s, somar) {
  const semPct = String(s || '').replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
  const v = (semPct.match(RE_DIN) || []).map(parseNum).filter(x => x != null);
  if (!v.length) return null;
  return somar ? r2(v.reduce((a, b) => a + b, 0)) : v[v.length - 1];
}
function interpretarTexto(texto) {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // devolve o que vem depois do rótulo; se a linha só tem o rótulo, usa a linha seguinte
  const depois = re => {
    for (let i = 0; i < linhas.length; i++) {
      const m = linhas[i].match(re); if (!m) continue;
      let resto = linhas[i].slice(m.index + m[0].length).replace(/^[\s:.\-_|]+/, '').trim();
      if (!resto && linhas[i + 1] && !RE_ROTULO.test(linhas[i + 1])) resto = linhas[i + 1];
      return resto.replace(/[_|]{2,}/g, ' ').trim();
    }
    return '';
  };
  const cortar = s => s.split(/\s{3,}|\b(?:empenho|valor|iss|irrf|m[eê]s|referente)\b/i)[0].trim();
  return {
    credor: cortar(depois(/\bcredor(?:\s*\(a\))?/i)),
    empenho: cortar(depois(/\bempenho(?:\s*n[ºo°.]*)?/i)),
    valor_liquido: dinheiro(depois(/\bvalor\s*l[ií1l]qu[ií1l]do/i)),
    valor: dinheiro(depois(/\bvalor(?!\s*l[ií1l]qu)(?:\s*bruto)?/i)),
    iss_valor: dinheiro(depois(/\bISS(?:QN)?\b/i)),
    irrf_valor: dinheiro(depois(/\bIRRF\b/i), true),
    mes: cortar(depois(/\bm[eê]s(?:\s*de\s*refer[eê]ncia)?/i)),
    referente: cortar(depois(/\breferente(?:\s*(?:a|à|ao))?\b/i)),
    duvida: '',
  };
}
async function lerLocal(dataUrl) {
  const d = interpretarTexto(await ocr(dataUrl));
  if (d.iss_valor != null && d.valor == null) d.iss_valor = null; // regra: ISS só com Valor preenchido
  const achou = d.credor || d.empenho || d.referente || CAMPOS_NUM.some(k => d[k] != null);
  if (!achou) throw new Error('Não consegui ler os campos desta foto.');
  return d;
}

const numOuNull = v => (typeof v === 'number' && Number.isFinite(v)) ? r2(v) : null;
async function lerCapa(c) {
  c.lendo = true; c.erro = ''; render();
  try {
    const usaApi = cfg.modo === 'claude';
    const d = usaApi ? await chamarClaude(c.img) : await lerLocal(c.img);
    if (!d.credor && !d.valor && !d.valor_liquido && usaApi) throw new Error(d.duvida || 'Não parece uma capa de processo.');
    c.local = !usaApi;
    const credorLido = String(d.credor || '').trim();
    if (c.diarias) { c.credor = 'Diárias'; c.empenho = credorLido; }
    else { c.credor = credorLido; c.empenho = String(d.empenho || '').trim(); }
    CAMPOS_NUM.forEach(k => c[k] = numOuNull(d[k]));
    c.mes = String(d.mes || '').trim();
    c.referente = String(d.referente || '').trim() || 'N/D';
    c.duvida = String(d.duvida || '').trim();
    c.duvida_campos = Array.isArray(d.duvida_campos) ? d.duvida_campos : [];
    if (c.diarias && c.duvida_campos.includes('credor')) c.duvida_campos = c.duvida_campos.map(k => k === 'credor' ? 'empenho' : k);
    const obs = String(d.observacao || '').trim();
    if (obs && !c.nota) c.nota = obs;
    delete c.img; // foto grande só é guardada enquanto a leitura não deu certo
  } catch (e) { c.erro = e.message || String(e); }
  c.lendo = false; salvar(); render();
}
const fila = []; let ativos = 0;
function enfileirar(c) { fila.push(c); bombear(); }
function bombear() {
  while (ativos < 3 && fila.length) {
    const c = fila.shift(); ativos++;
    lerCapa(c).finally(() => { ativos--; bombear(); if (!ativos && !fila.length) fimLote(); });
  }
}
function fimLote() {
  const l = daLista(), er = l.filter(c => c.erro).length;
  toast(er ? `Leitura concluída — ${er} capa(s) com erro.` : 'Leitura concluída.');
}
async function aoEscolherFotos(files) {
  if (!files.length) return;
  if (cfg.modo === 'claude' && !cfg.apiKey) { toast('Cadastre a chave da API em Ajustes ou mude a leitura para "No aparelho".', 4000); irPara('ajustes'); return; }
  const diarias = $('chkDiarias').checked;
  toast(`${files.length} foto(s) recebida(s). Lendo…`);
  for (const f of files) {
    try {
      const c = novaCapa({ diarias, lendo: true });
      c.img = await reduzir(f, 2000, 0.85);
      c.thumb = await reduzir(f, 900, 0.6);
      state.capas.push(c); render(); enfileirar(c);
    } catch (e) { toast('Uma das fotos não pôde ser aberta.'); }
  }
  salvar();
}
function novaCapa(extra = {}) {
  return {
    id: uid(), credor: extra.diarias ? 'Diárias' : '', empenho: '', valor: null, iss_valor: null, irrf_valor: null, valor_liquido: null,
    mes: '', referente: 'N/D', duvida: '', nota: '', thumb: '', naLista: true,
    status: 'recebido', statusEm: Date.now(), criadoEm: Date.now(), ...extra,
  };
}

/* ===================== Editor ===================== */
let editId = null, editNovo = false;
function abrirEditor(id) {
  const c = state.capas.find(x => x.id === id); if (!c || c.lendo) return;
  editId = id;
  $('edTit').textContent = editNovo ? 'Nova capa' : 'Capa';
  $('edErro').textContent = c.erro ? 'Leitura falhou: ' + c.erro : '';
  $('edFoto').hidden = !c.thumb; if (c.thumb) $('edFoto').src = c.thumb;
  $('e_credor').value = c.credor || ''; $('e_empenho').value = c.empenho || '';
  CAMPOS_NUM.forEach(k => $('e_' + k).value = fmtIn(c[k]));
  $('e_mes').value = c.mes || ''; $('e_referente').value = c.referente === 'N/D' ? '' : (c.referente || '');
  $('e_status').innerHTML = STATUS.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  $('e_status').value = c.status; $('e_nota').value = c.nota || '';
  $('edReler').hidden = !c.img;
  atualizarRotulos(); previaChecagem();
  $('sheet').classList.add('on');
}
function atualizarRotulos() { $('lblEmp').textContent = $('e_credor').value.trim() === 'Diárias' ? 'Beneficiário' : 'Empenho'; }
function lerForm() {
  const o = { credor: $('e_credor').value.trim(), empenho: $('e_empenho').value.trim(), mes: $('e_mes').value.trim(), referente: $('e_referente').value.trim() || 'N/D' };
  CAMPOS_NUM.forEach(k => o[k] = parseNum($('e_' + k).value));
  return o;
}
function previaChecagem() {
  const pr = checar(lerForm());
  $('edChecagem').innerHTML = pr.map(x => `<div class="aviso ${x.grave ? '' : 'am'}">⚠ ${esc(x.t)}</div>`).join('');
}
function fecharEditor(descartarNovo) {
  if (descartarNovo && editNovo) state.capas = state.capas.filter(c => c.id !== editId);
  editId = null; editNovo = false; $('sheet').classList.remove('on'); render();
}
function salvarEditor() {
  const c = state.capas.find(x => x.id === editId); if (!c) return;
  Object.assign(c, lerForm());
  c.nota = $('e_nota').value.trim(); c.erro = ''; c.duvida = ''; c.duvida_campos = []; c.local = false; delete c.diarias;
  mudarStatus(c, $('e_status').value);
  editNovo = false; salvar(); fecharEditor(false);
}
function mudarStatus(c, novo) { if (c.status !== novo) { c.status = novo; c.statusEm = Date.now(); } }

/* ===================== PDF ===================== */
function gerarPDF() {
  const lista = daLista().filter(c => !c.lendo && !c.erro);
  if (!lista.length) { toast('Não há capas lidas na lista.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 16, W = 178, PH = 297;
  const PRI = [31, 58, 82], SEC = [61, 90, 115], PAR = [247, 249, 250], SUB = [220, 228, 234], TXT = [32, 48, 61], DEST = [179, 84, 30];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...PRI);
  doc.text(state.titulo || 'Pagamento', M, M + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...TXT);
  doc.text('Data: ' + hoje(), M, M + 13);
  let y = M + 20, num = 1;
  for (const g of grupos(lista)) {
    const diarias = g.credor === 'Diárias';
    const alt = 7 + (g.itens.length + 2) * 6.6 + 4;
    if (y + alt > PH - M && alt < PH - 2 * M) { doc.addPage(); y = M; }
    else if (y + 28 > PH - M) { doc.addPage(); y = M; }
    doc.setFillColor(...SEC); doc.rect(M, y, W, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
    doc.text(g.credor, M + 3, y + 5);
    const body = g.itens.map(c => [String(num++), c.empenho || '-', fmt(c.valor), fmt(c.iss_valor), fmt(c.irrf_valor), fmt(c.valor_liquido), c.mes || '-', c.referente || 'N/D']);
    const nItens = body.length;
    body.push(['', 'SUBTOTAL', fmt(g.total), '', '', '', '', '']);
    const w = diarias ? [8, 45, 26, 18, 18, 26, 12, 25] : [8, 20, 26, 18, 18, 26, 12, 50];
    const colStyles = {};
    w.forEach((x, i) => colStyles[i] = { cellWidth: x, halign: i === 0 || i === 6 ? 'center' : (i >= 2 && i <= 5 ? 'right' : 'left') });
    doc.autoTable({
      startY: y + 7, margin: { left: M, right: M, top: M, bottom: M }, tableWidth: W, theme: 'plain',
      head: [['Nº', diarias ? 'Beneficiário' : 'Empenho', 'Valor', 'ISS', 'IRRF', 'Valor Líquido', 'Mês', 'Referente']],
      body, columnStyles: colStyles,
      styles: { font: 'helvetica', fontSize: 8, textColor: TXT, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: PRI, textColor: [255, 255, 255], fontStyle: 'bold' },
      didParseCell(d) {
        if (d.section === 'head') { d.cell.styles.halign = colStyles[d.column.index].halign; return; }
        if (d.row.index === nItens) { d.cell.styles.fillColor = SUB; d.cell.styles.fontStyle = 'bold'; return; }
        if (d.row.index % 2 === 1) d.cell.styles.fillColor = PAR;
        const c = g.itens[d.row.index];
        if ((d.column.index === 3 && c.iss_valor != null) || (d.column.index === 4 && c.irrf_valor != null)) {
          d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = DEST;
        }
      },
      didDrawCell(d) {
        if (d.section !== 'body') return;
        const sub = d.row.index === nItens;
        doc.setDrawColor(...(sub ? PRI : [216, 222, 227])); doc.setLineWidth(sub ? 0.35 : 0.15);
        if (sub) doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y);
        else if (d.row.index < nItens - 1) doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
      },
    });
    y = doc.lastAutoTable.finalY + 3.5;
  }
  return doc;
}
async function compartilharPDF() {
  const lendo = daLista().some(c => c.lendo);
  if (lendo) { toast('Aguarde terminar a leitura das capas.'); return; }
  const erros = daLista().filter(c => c.erro).length;
  if (erros && !confirm(`${erros} capa(s) com erro de leitura ficarão fora do PDF. Gerar mesmo assim?`)) return;
  let doc; try { doc = gerarPDF(); } catch (e) { console.error(e); toast('Erro ao gerar o PDF.'); return; }
  if (!doc) return;
  const nome = `${(state.titulo || 'Pagamento').replace(/[\\/:*?"<>|]/g, '')} ${hoje().replace(/\//g, '-')}.pdf`;
  const blob = doc.output('blob');
  const file = new File([blob], nome, { type: 'application/pdf' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nome }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  baixar(blob, nome);
}
function baixar(blob, nome) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ===================== Navegação e eventos ===================== */
function irPara(tab) {
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('hTitulo').textContent = { lista: 'Capas de Pagamento', status: 'Status dos processos', ajustes: 'Ajustes' }[tab];
  window.scrollTo(0, 0);
}
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) irPara(b.dataset.tab); });

$('bAdd').onclick = () => $('fotos').click();
$('fotos').onchange = e => { const f = [...e.target.files]; e.target.value = ''; aoEscolherFotos(f); };
$('titulo').oninput = e => { state.titulo = e.target.value.trim() || 'Pagamento'; salvar(); };
$('bPdf').onclick = compartilharPDF;
$('bManual').onclick = () => { const c = novaCapa({ diarias: $('chkDiarias').checked }); state.capas.push(c); editNovo = true; abrirEditor(c.id); };
$('bNova').onclick = () => {
  const l = daLista(); if (!l.length) return;
  if (!confirm(`Começar uma lista nova?\nAs ${l.length} capas saem da lista, mas continuam na aba Status.`)) return;
  state.capas = state.capas.filter(c => !(c.naLista && (c.erro || c.lendo)));
  state.capas.forEach(c => c.naLista = false);
  salvar(); render();
};
$('lista').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (d) { excluirCapa(d.dataset.del); return; }
  const it = e.target.closest('.item'); if (it) abrirEditor(it.dataset.id);
});
$('statusLista').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (d) { excluirCapa(d.dataset.del); return; }
  if (e.target.closest('select')) return; const it = e.target.closest('.item'); if (it) abrirEditor(it.dataset.id); });
$('statusLista').addEventListener('change', e => {
  const s = e.target.closest('select[data-sid]'); if (!s) return;
  const c = state.capas.find(x => x.id === s.dataset.sid); if (!c) return;
  mudarStatus(c, s.value); salvar(); render(); toast('Status: ' + stInfo(c.status).label);
});
$('chips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { filtro = b.dataset.f; renderStatus(); } });
$('busca').oninput = renderStatus;

$('edX').onclick = () => fecharEditor(true);
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) fecharEditor(true); });
$('edSalvar').onclick = salvarEditor;
$('edExcluir').onclick = () => {
  if (!editNovo && !confirm('Excluir esta capa de vez (da lista e do Status)?')) return;
  state.capas = state.capas.filter(c => c.id !== editId); editNovo = false; salvar(); fecharEditor(false);
};
$('edReler').onclick = () => {
  const c = state.capas.find(x => x.id === editId); if (!c || !c.img) return;
  if (cfg.modo === 'claude' && !cfg.apiKey) { toast('Cadastre a chave da API em Ajustes.'); return; }
  fecharEditor(false); enfileirar(c);
};
['e_valor', 'e_iss_valor', 'e_irrf_valor', 'e_valor_liquido'].forEach(i => $(i).oninput = previaChecagem);
$('e_credor').oninput = atualizarRotulos;

const mostrarApi = () => { $('boxApi').hidden = $('modo').value !== 'claude'; $('txtLocal').hidden = $('modo').value === 'claude'; };
$('modo').onchange = () => { cfg.modo = $('modo').value; mostrarApi(); };
$('bSalvarCfg').onclick = () => { cfg.modo = $('modo').value; cfg.apiKey = $('apiKey').value.trim(); cfg.modelo = $('modelo').value; toast('Ajustes salvos.'); };
$('bExport').onclick = () => {
  const dados = { ...state, capas: state.capas.map(({ img, ...r }) => r) };
  baixar(new Blob([JSON.stringify(dados)], { type: 'application/json' }), `capas-backup-${hoje().replace(/\//g, '-')}.json`);
};
$('bImport').onclick = () => $('fImport').click();
$('fImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.capas)) throw 0;
    if (!confirm(`Substituir os dados deste aparelho pelos do backup (${d.capas.length} processos)?`)) return;
    state = { titulo: d.titulo || 'Pagamento', capas: d.capas }; salvar(); iniciarTela(); toast('Backup importado.');
  } catch { toast('Arquivo de backup inválido.'); }
};

function iniciarTela() {
  $('titulo').value = state.titulo || 'Pagamento';
  $('apiKey').value = cfg.apiKey; $('modelo').value = cfg.modelo; $('modo').value = cfg.modo; mostrarApi();
  render();
}
(async () => {
  await carregar(); iniciarTela();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
