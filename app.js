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

/* ===================== Utilidades ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const n2 = v => v == null || v === '' ? null : r2(Number(v)); // numeric do Postgres chega como texto/número
const fmt = v => v == null ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtIn = v => v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoje = () => new Date().toLocaleDateString('pt-BR');
const dataHora = s => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const dataCurta = s => s ? new Date(s).toLocaleDateString('pt-BR') : '';
const montante = p => p.valor != null ? p.valor : (p.valor_liquido || 0);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(ltda|me|epp|eireli|s\/?a)\b/g, '').replace(/[^a-z0-9]/g, '');
function parseNum(s) {
  s = String(s ?? '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : null;
}
let toastT;
function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms);
}
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

/* ===================== Servidor (Supabase) ===================== */
const CFG = window.CAPAS_CONFIG || {};
let sb = null, usuario = null;
let processos = new Map(); // id -> processo
let canal = null;

function normalizar(p) {
  const o = { ...p };
  CAMPOS_NUM.forEach(k => o[k] = n2(p[k]));
  o.duvida_campos = Array.isArray(p.duvida_campos) ? p.duvida_campos : [];
  return o;
}
async function carregarTudo() {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('processos').select('*').order('criado_em', { ascending: false }).range(de, de + 999);
    if (error) throw error;
    todos.push(...data);
    if (data.length < 1000) break;
  }
  processos = new Map(todos.map(p => [p.id, normalizar(p)]));
  podarSelecao(); render();
}
function assinarTempoReal() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel('processos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'processos' }, ev => {
      if (ev.eventType === 'DELETE') processos.delete(ev.old.id);
      else processos.set(ev.new.id, normalizar(ev.new));
      podarSelecao(); render();
      if (editId && ev.eventType === 'DELETE' && ev.old.id === editId) { fecharEditor(); toast('Este processo foi excluído por outra pessoa.'); }
    })
    .subscribe(st => { $('hInfo').innerHTML = `<span class="ponto ${st === 'SUBSCRIBED' ? '' : 'off'}"></span>${st === 'SUBSCRIBED' ? 'ao vivo' : 'reconectando'}`; });
}
async function atualizar(id, campos) {
  const { data, error } = await sb.from('processos').update(campos).eq('id', id).select().single();
  if (error) throw error;
  processos.set(id, normalizar(data)); render();
  return data;
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
  // Dúvida só sobre valores some quando a conta fecha: a própria conta confirma os números.
  if (c.duvida) {
    const campos = Array.isArray(c.duvida_campos) && c.duvida_campos.length ? c.duvida_campos : null;
    const soValores = campos ? campos.every(k => CAMPOS_NUM.includes(k)) : true;
    if (!(contaFecha && soValores)) p.push({ t: 'Dúvida na leitura: ' + c.duvida });
  }
  return p;
}
// Duplicatas: mesma foto, ou mesmo credor + mesmo valor + mesmo empenho/referente.
function duplicatasDe(p) {
  if (p.leitura === 'lendo') return [];
  const out = [];
  for (const q of processos.values()) {
    if (q.id === p.id || q.leitura === 'lendo') continue;
    if (p.foto_hash && q.foto_hash === p.foto_hash) { out.push({ q, foto: true }); continue; }
    if (p.leitura !== 'ok' || q.leitura !== 'ok') continue;
    if (!norm(p.credor) || norm(p.credor) !== norm(q.credor)) continue;
    if (montante(p) !== montante(q) || !montante(p)) continue;
    const mesmoEmp = (p.empenho || '') === (q.empenho || '');
    const mesmaRef = norm(p.referente) === norm(q.referente);
    if (p.credor === 'Diárias' ? mesmoEmp : (mesmoEmp && mesmaRef)) out.push({ q, foto: false });
  }
  return out;
}
const textoDup = d => `${d.foto ? 'Mesma foto já enviada' : 'Possível duplicata'}: lançado por ${d.q.criado_por_nome || '?'} em ${dataCurta(d.q.criado_em)}`;

/* ===================== Filtros ===================== */
const filtros = { p: { status: 'todos', busca: '' }, l: { status: 'todos', busca: '' } };
function filtrar(f) {
  const q = f.busca.trim().toLowerCase();
  return [...processos.values()].filter(c => (f.status === 'todos' || c.status === f.status) &&
    (!q || [c.credor, c.empenho, c.referente, c.nota, c.mes, c.criado_por_nome].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
function chipsHtml(f) {
  const cont = {}; for (const c of processos.values()) cont[c.status] = (cont[c.status] || 0) + 1;
  return `<button data-f="todos" class="${f.status === 'todos' ? 'on' : ''}">Todos (${processos.size})</button>` +
    STATUS.map(s => `<button data-f="${s.id}" class="${f.status === s.id ? 'on' : ''}">${s.label} (${cont[s.id] || 0})</button>`).join('');
}

/* ===================== Renderização: Processos ===================== */
const BTN_DEL = id => `<button class="del" data-del="${id}" aria-label="Excluir"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>`;
function renderProcessos() {
  $('pChips').innerHTML = chipsHtml(filtros.p);
  const vis = filtrar(filtros.p);
  const lendo = [...processos.values()].filter(c => c.leitura === 'lendo').length;
  const erros = [...processos.values()].filter(c => c.leitura === 'erro').length;
  $('pResumo').innerHTML = (lendo || erros || envio.total) ? `<div class="card muted">
    ${envio.total ? `<span class="spin"></span> Enviando fotos: ${envio.feitas}/${envio.total}<br>` : ''}
    ${lendo ? `<span class="spin"></span> Lendo ${lendo} capa(s)…<br>` : ''}
    ${erros ? `<span style="color:var(--err)">${erros} capa(s) com erro de leitura — toque para tentar de novo.</span>` : ''}</div>` : '';
  $('pLista').innerHTML = vis.length ? vis.map(c => {
    const st = stInfo(c.status);
    let corpo;
    if (c.leitura === 'lendo') corpo = `<div class="t"><span><span class="spin"></span> Lendo capa…</span></div><div class="d">Enviada por ${esc(c.criado_por_nome || '')}</div>`;
    else if (c.leitura === 'erro') corpo = `<div class="t"><span>Não foi possível ler</span></div><div class="aviso">${esc(c.leitura_erro)} Toque para tentar de novo ou preencher.</div>`;
    else {
      const pr = checar(c), dups = duplicatasDe(c);
      corpo = `<div class="t"><span>${esc(c.credor || '(sem credor)')}</span><span>${fmt(montante(c))}</span></div>
        <div class="d">${c.credor === 'Diárias' ? 'Beneficiário: ' : ''}${esc(c.empenho || '-')} · ${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''}</div>
        <div class="d">Líq. ${fmt(c.valor_liquido)} · ISS ${c.iss_valor != null ? `<b>${fmt(c.iss_valor)}</b>` : '-'} · IRRF ${c.irrf_valor != null ? `<b>${fmt(c.irrf_valor)}</b>` : '-'}</div>
        ${c.nota ? `<div class="d">📝 ${esc(c.nota)}</div>` : ''}
        ${dups.map(d => `<div class="aviso">⚠ ${esc(textoDup(d))}</div>`).join('')}
        ${pr.map(x => `<div class="aviso ${x.grave ? '' : 'am'}">⚠ ${esc(x.t)}</div>`).join('')}`;
    }
    return `<div class="proc" data-id="${c.id}">
      <div class="topo"><div class="c">${corpo}</div>${BTN_DEL(c.id)}</div>
      <div class="rodape">
        <select class="st-sel" data-sid="${c.id}" style="background:${st.cor}">${STATUS.map(s => `<option value="${s.id}" ${s.id === c.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        <span class="muted" style="text-align:right">${esc(c.status_por_nome || '')}${c.status_em ? ' · ' + dataCurta(c.status_em) : ''}</span>
      </div></div>`;
  }).join('') : `<div class="vazio">${processos.size ? 'Nenhum processo neste filtro.' : 'Nenhum processo ainda.<br>Toque em <b>Adicionar capas</b> e escolha ou tire as fotos.'}</div>`;
}

/* ===================== Renderização: Lista (seleção → PDF) ===================== */
let selecao = new Set(ls.get('selecao', []));
function salvarSelecao() { ls.set('selecao', [...selecao]); }
function podarSelecao() {
  let mudou = false;
  for (const id of selecao) if (!processos.has(id) || processos.get(id).leitura !== 'ok') { selecao.delete(id); mudou = true; }
  if (mudou) salvarSelecao();
}
function renderLista() {
  $('lChips').innerHTML = chipsHtml(filtros.l);
  const vis = filtrar(filtros.l).filter(c => c.leitura === 'ok');
  $('lLista').innerHTML = vis.length ? vis.map(c => {
    const st = stInfo(c.status), m = selecao.has(c.id);
    return `<label class="sel ${m ? 'marcado' : ''}" data-lid="${c.id}">
      <input type="checkbox" ${m ? 'checked' : ''} data-chk="${c.id}">
      <div class="c" style="flex:1;min-width:0">
        <div class="t"><span>${esc(c.credor || '(sem credor)')}</span><span>${fmt(montante(c))}</span></div>
        <div class="d">${esc(c.empenho || '-')} · ${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''}</div>
        <div class="d"><span class="pill" style="background:${st.cor}">${st.label}</span> · lançado ${dataCurta(c.criado_em)}</div>
      </div></label>`;
  }).join('') : `<div class="vazio">Nenhum processo lido neste filtro.</div>`;
  const sel = [...selecao].map(id => processos.get(id)).filter(Boolean);
  $('barra').hidden = !sel.length;
  $('barraInfo').innerHTML = `<b>${sel.length}</b> selecionado${sel.length > 1 ? 's' : ''} · ${fmt(r2(sel.reduce((s, c) => s + montante(c), 0)))}`;
}
function render() { if (!usuario) return; renderProcessos(); renderLista(); }

/* ===================== Imagens ===================== */
async function reduzir(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Imagem inválida')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
  } finally { URL.revokeObjectURL(url); }
}
async function hashArquivo(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ===================== Envio e leitura ===================== */
const envio = { total: 0, feitas: 0 };
const fila = []; let ativos = 0;
function enfileirar(tarefa) { fila.push(tarefa); bombear(); }
function bombear() {
  while (ativos < 3 && fila.length) {
    const t = fila.shift(); ativos++;
    t().catch(e => { console.error(e); toast(e.message || 'Erro ao enviar.'); })
      .finally(() => { ativos--; envio.feitas++; if (!ativos && !fila.length) { envio.total = envio.feitas = 0; } render(); bombear(); });
  }
}
async function pedirLeitura(id) {
  const { error } = await sb.functions.invoke('ler-capa', { body: { id, modelo: ls.get('modelo', 'claude-opus-5-5') } });
  if (error) {
    let msg = 'Não foi possível pedir a leitura ao servidor.';
    try { const j = await error.context.json(); if (j.erro) msg = j.erro; } catch { }
    await atualizar(id, { leitura: 'erro', leitura_erro: msg }).catch(() => { });
  }
}
async function enviarFoto(file, diarias, hash) {
  const blob = await reduzir(file, 2000, 0.85);
  const { data: p, error } = await sb.from('processos').insert({ diarias, credor: diarias ? 'Diárias' : '', leitura: 'lendo', foto_hash: hash }).select().single();
  if (error) throw error;
  processos.set(p.id, normalizar(p)); render();
  const caminho = `${p.id}.jpg`;
  const up = await sb.storage.from('capas').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) { await atualizar(p.id, { leitura: 'erro', leitura_erro: 'Falha ao enviar a foto. Exclua e envie de novo.' }); return; }
  await atualizar(p.id, { foto_path: caminho });
  await pedirLeitura(p.id);
}
async function aoEscolherFotos(files) {
  if (!files.length) return;
  const diarias = $('chkDiarias').checked;
  const hashes = new Map(); // hash -> processo existente
  for (const p of processos.values()) if (p.foto_hash) hashes.set(p.foto_hash, p);
  const aceitas = [];
  let repetidasLote = 0;
  for (const f of files) {
    let h = null; try { h = await hashArquivo(f); } catch { }
    if (h && hashes.has(h)) {
      const q = hashes.get(h);
      if (q === 'lote') { repetidasLote++; if (!confirm('Você escolheu a mesma foto duas vezes neste envio. Enviar as duas?')) continue; }
      else if (!confirm(`Esta foto já foi enviada por ${q.criado_por_nome || '?'} em ${dataCurta(q.criado_em)}${q.credor ? ` (${q.credor}, ${fmt(montante(q))})` : ''}.\nEnviar mesmo assim?`)) continue;
    }
    if (h) hashes.set(h, 'lote');
    aceitas.push([f, h]);
  }
  if (!aceitas.length) return;
  envio.total += aceitas.length;
  toast(`${aceitas.length} foto(s) sendo enviada(s)…`);
  for (const [f, h] of aceitas) enfileirar(() => enviarFoto(f, diarias, h));
  render();
}
async function lancarManual() {
  const diarias = $('chkDiarias').checked;
  const { data, error } = await sb.from('processos').insert({ diarias, credor: diarias ? 'Diárias' : '', leitura: 'ok' }).select().single();
  if (error) { toast('Erro: ' + error.message); return; }
  processos.set(data.id, normalizar(data)); render();
  editNovo = true; abrirEditor(data.id);
}
async function excluir(id, perguntar = true) {
  const c = processos.get(id); if (!c) return;
  if (perguntar && !confirm(`Excluir ${c.credor || 'este processo'}${montante(c) ? ' (' + fmt(montante(c)) + ')' : ''}?\nSai para toda a equipe.`)) return false;
  const { error } = await sb.from('processos').delete().eq('id', id);
  if (error) { toast('Erro ao excluir: ' + error.message); return false; }
  if (c.foto_path) sb.storage.from('capas').remove([c.foto_path]).catch(() => { });
  processos.delete(id); selecao.delete(id); salvarSelecao(); render();
  if (perguntar) toast('Processo excluído.');
  return true;
}

/* ===================== Editor ===================== */
let editId = null, editNovo = false;
async function abrirEditor(id) {
  const c = processos.get(id); if (!c || c.leitura === 'lendo') return;
  editId = id;
  $('edTit').textContent = editNovo ? 'Novo processo' : 'Processo';
  $('edErro').textContent = c.leitura === 'erro' ? 'Leitura falhou: ' + c.leitura_erro : '';
  $('e_credor').value = c.credor || ''; $('e_empenho').value = c.empenho || '';
  CAMPOS_NUM.forEach(k => $('e_' + k).value = fmtIn(c[k]));
  $('e_mes').value = c.mes || ''; $('e_referente').value = c.referente === 'N/D' ? '' : (c.referente || '');
  $('e_status').innerHTML = STATUS.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  $('e_status').value = c.status; $('e_nota').value = c.nota || '';
  $('edReler').hidden = !c.foto_path;
  $('edFoto').hidden = true; $('edFoto').removeAttribute('src');
  $('edInfo').innerHTML = `Lançado por ${esc(c.criado_por_nome || '?')} em ${dataHora(c.criado_em)}` +
    (c.alterado_por_nome && c.alterado_em !== c.criado_em ? `<br>Última alteração: ${esc(c.alterado_por_nome)} em ${dataHora(c.alterado_em)}` : '');
  atualizarRotulos(); previaChecagem();
  $('sheet').classList.add('on');
  if (c.foto_path) {
    sb.storage.from('capas').createSignedUrl(c.foto_path, 600).then(({ data }) => {
      if (data && editId === id) { $('edFoto').src = data.signedUrl; $('edFoto').hidden = false; }
    });
  }
  sb.from('status_historico').select('de, para, em, por_nome').eq('processo_id', id).order('em').then(({ data }) => {
    if (!data || editId !== id || !data.length) return;
    $('edInfo').innerHTML += `<br><b>Histórico de status</b><ul class="hist">${data.map(h => `<li>${dataHora(h.em)} — ${h.de ? esc(stInfo(h.de).label) + ' → ' : ''}${esc(stInfo(h.para).label)} (${esc(h.por_nome || '?')})</li>`).join('')}</ul>`;
  });
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
async function fecharEditor(descartarNovo) {
  const id = editId, novo = editNovo;
  editId = null; editNovo = false; $('sheet').classList.remove('on');
  if (descartarNovo && novo && id) await excluir(id, false);
  render();
}
async function salvarEditor() {
  const id = editId; if (!id) return;
  const campos = { ...lerForm(), nota: $('e_nota').value.trim(), status: $('e_status').value, duvida: '', duvida_campos: [], diarias: $('e_credor').value.trim() === 'Diárias' };
  const c = processos.get(id);
  if (c && c.leitura === 'erro') { campos.leitura = 'ok'; campos.leitura_erro = ''; }
  $('edSalvar').disabled = true;
  try { await atualizar(id, campos); editNovo = false; await fecharEditor(false); toast('Salvo.'); }
  catch (e) { toast('Erro ao salvar: ' + e.message); }
  finally { $('edSalvar').disabled = false; }
}

/* ===================== PDF ===================== */
function grupos(lista) {
  const g = {};
  lista.forEach(c => (g[c.credor || '(sem credor)'] ||= []).push(c));
  return Object.keys(g).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(k => ({
    credor: k, itens: g[k], total: r2(g[k].reduce((s, c) => s + montante(c), 0)),
  }));
}
function gerarPDF(lista, titulo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 16, W = 178, PH = 297;
  const PRI = [31, 58, 82], SEC = [61, 90, 115], PAR = [247, 249, 250], SUB = [220, 228, 234], TXT = [32, 48, 61], DEST = [179, 84, 30];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...PRI);
  doc.text(titulo || 'Pagamento', M, M + 6);
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
  const lista = [...selecao].map(id => processos.get(id)).filter(c => c && c.leitura === 'ok');
  if (!lista.length) { toast('Marque pelo menos um processo.'); return; }
  const titulo = $('titulo').value.trim() || 'Pagamento';
  let doc; try { doc = gerarPDF(lista, titulo); } catch (e) { console.error(e); toast('Erro ao gerar o PDF.'); return; }
  const nome = `${titulo.replace(/[\\/:*?"<>|]/g, '')} ${hoje().replace(/\//g, '-')}.pdf`;
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

/* ===================== Exportar / importar ===================== */
function exportarCSV() {
  const cols = ['credor', 'empenho', 'valor', 'iss_valor', 'irrf_valor', 'valor_liquido', 'mes', 'referente', 'status', 'nota', 'criado_por_nome', 'criado_em', 'status_por_nome', 'status_em'];
  const cel = v => { const s = v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = [cols.join(';'), ...[...processos.values()].filter(c => c.leitura === 'ok').map(c => cols.map(k => cel(k === 'status' ? stInfo(c.status).label : c[k])).join(';'))];
  baixar(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `processos-${hoje().replace(/\//g, '-')}.csv`);
}
const DO_BACKUP = c => ({
  credor: c.credor || '', empenho: c.empenho || '', mes: c.mes || '', referente: c.referente || 'N/D', nota: c.nota || '',
  valor: n2(c.valor), iss_valor: n2(c.iss_valor), irrf_valor: n2(c.irrf_valor), valor_liquido: n2(c.valor_liquido),
  status: STATUS.some(s => s.id === c.status) ? c.status : 'recebido', diarias: c.credor === 'Diárias', leitura: 'ok',
  ...(c.criado_em || c.criadoEm ? { criado_em: new Date(c.criado_em || c.criadoEm).toISOString() } : {}),
});
async function importarLista(capas) {
  const validas = capas.filter(c => !c.lendo && !c.erro && (c.credor || c.valor != null || c.valor_liquido != null)).map(DO_BACKUP);
  if (!validas.length) { toast('Nada para importar.'); return 0; }
  for (let i = 0; i < validas.length; i += 200) {
    const { error } = await sb.from('processos').insert(validas.slice(i, i + 200));
    if (error) throw error;
  }
  await carregarTudo();
  return validas.length;
}
// Processos salvos neste aparelho pela versão antiga (antes do servidor)
function lerLocalAntigo() {
  return new Promise(ok => {
    try {
      const r = indexedDB.open('capas-db', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => ok(null);
      r.onsuccess = () => {
        try {
          const q = r.result.transaction('kv').objectStore('kv').get('state');
          q.onsuccess = () => ok(q.result && Array.isArray(q.result.capas) ? q.result : null); q.onerror = () => ok(null);
        } catch { ok(null); }
      };
    } catch { ok(null); }
  });
}
async function verificarLocalAntigo() {
  if (ls.get('localImportado', false)) return;
  const st = await lerLocalAntigo();
  const n = st ? st.capas.filter(c => !c.lendo && !c.erro).length : 0;
  $('boxLocal').hidden = !n;
  if (n) $('bLocal').textContent = `Enviar ${n} processo(s) salvos só neste aparelho`;
}

/* ===================== Login e início ===================== */
function mostrar(tela) {
  $('telaConfig').hidden = tela !== 'config';
  $('telaLogin').hidden = tela !== 'login';
  $('nav').hidden = tela !== 'app';
  document.body.classList.toggle('semnav', tela !== 'app');
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', tela === 'app' && s.id === 'tab-' + abaAtual));
}
let abaAtual = 'processos';
function irPara(tab) {
  abaAtual = tab;
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('hTitulo').textContent = { processos: 'Processos', lista: 'Lista para impressão', ajustes: 'Ajustes' }[tab];
  window.scrollTo(0, 0);
}
async function entrouNoApp(user) {
  usuario = user;
  $('aEmail').textContent = user.email || '';
  $('aNome').value = user.user_metadata?.nome || '';
  mostrar('app'); irPara(abaAtual);
  try { await carregarTudo(); } catch (e) { toast('Erro ao carregar: ' + e.message, 5000); }
  assinarTempoReal();
  verificarLocalAntigo();
}
function saiuDoApp() {
  usuario = null; processos = new Map();
  if (canal) { sb.removeChannel(canal); canal = null; }
  $('hInfo').textContent = ''; $('hTitulo').textContent = 'Capas de Pagamento';
  mostrar('login');
}

/* ===================== Eventos ===================== */
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) irPara(b.dataset.tab); });
$('fLogin').addEventListener('submit', async e => {
  e.preventDefault(); $('lErro').textContent = ''; $('bEntrar').disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('lEmail').value.trim(), password: $('lSenha').value });
  $('bEntrar').disabled = false;
  if (error) { $('lErro').textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message; $('lSenha').value = ''; $('lSenha').focus(); return; }
  $('lSenha').value = ''; // a entrada no app vem pelo aviso de login (onAuthStateChange)
});
$('bAdd').onclick = () => $('fotos').click();
$('fotos').onchange = e => { const f = [...e.target.files]; e.target.value = ''; aoEscolherFotos(f); };
$('bManual').onclick = lancarManual;

function ligarFiltro(k, chips, busca, rend) {
  $(chips).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { filtros[k].status = b.dataset.f; rend(); } });
  $(busca).oninput = e => { filtros[k].busca = e.target.value; rend(); };
}
ligarFiltro('p', 'pChips', 'pBusca', renderProcessos);
ligarFiltro('l', 'lChips', 'lBusca', renderLista);

$('pLista').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (d) { excluir(d.dataset.del); return; }
  if (e.target.closest('select')) return;
  const it = e.target.closest('.proc'); if (it) abrirEditor(it.dataset.id);
});
$('pLista').addEventListener('change', async e => {
  const s = e.target.closest('select[data-sid]'); if (!s) return;
  try { await atualizar(s.dataset.sid, { status: s.value }); toast('Status: ' + stInfo(s.value).label); }
  catch (er) { toast('Erro: ' + er.message); render(); }
});
$('lLista').addEventListener('change', e => {
  const c = e.target.closest('[data-chk]'); if (!c) return;
  if (c.checked) selecao.add(c.dataset.chk); else selecao.delete(c.dataset.chk);
  salvarSelecao(); renderLista();
});
$('bSelVis').onclick = () => { filtrar(filtros.l).filter(c => c.leitura === 'ok').forEach(c => selecao.add(c.id)); salvarSelecao(); renderLista(); };
$('bLimpar').onclick = () => { selecao.clear(); salvarSelecao(); renderLista(); };
$('bPdf').onclick = compartilharPDF;
$('titulo').value = ls.get('titulo', 'Pagamento');
$('titulo').oninput = e => ls.set('titulo', e.target.value);

$('edX').onclick = () => fecharEditor(true);
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) fecharEditor(true); });
$('edSalvar').onclick = salvarEditor;
$('edExcluir').onclick = async () => { const id = editId, novo = editNovo; if (await excluir(id, !novo) !== false) { editNovo = false; fecharEditor(false); } };
$('edReler').onclick = async () => {
  const id = editId; await fecharEditor(false);
  try { await atualizar(id, { leitura: 'lendo', leitura_erro: '' }); await pedirLeitura(id); } catch (e) { toast('Erro: ' + e.message); }
};
['e_valor', 'e_iss_valor', 'e_irrf_valor', 'e_valor_liquido'].forEach(i => $(i).oninput = previaChecagem);
$('e_credor').oninput = atualizarRotulos;

$('modelo').value = ls.get('modelo', 'claude-opus-5-5');
$('modelo').onchange = e => { ls.set('modelo', e.target.value); toast('Modelo salvo.'); };
$('bSalvarNome').onclick = async () => {
  const nome = $('aNome').value.trim();
  const { error } = await sb.auth.updateUser({ data: { nome } });
  if (error) { toast('Erro: ' + error.message); return; }
  await sb.auth.refreshSession(); toast('Nome salvo.');
};
$('bSair').onclick = async () => { if (confirm('Sair desta conta?')) { await sb.auth.signOut(); } };
$('bExport').onclick = exportarCSV;
$('bImport').onclick = () => $('fImport').click();
$('fImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.capas)) throw new Error('Arquivo de backup inválido.');
    if (!confirm(`Enviar ${d.capas.length} processo(s) do backup para o servidor da equipe?`)) return;
    toast(`${await importarLista(d.capas)} processo(s) importado(s).`);
  } catch (er) { toast(er.message || 'Arquivo de backup inválido.'); }
};
$('bLocal').onclick = async () => {
  const st = await lerLocalAntigo(); if (!st) return;
  if (!confirm('Enviar os processos salvos neste aparelho para o servidor da equipe?')) return;
  try { const n = await importarLista(st.capas); ls.set('localImportado', true); $('boxLocal').hidden = true; toast(`${n} processo(s) enviado(s).`); }
  catch (er) { toast('Erro: ' + er.message); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && usuario) carregarTudo().catch(() => { }); });

(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  try { localStorage.removeItem('apiKey'); localStorage.removeItem('modo2'); } catch { } // chave antiga: agora fica só no servidor
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) { mostrar('config'); return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  // Não chamar o Supabase dentro deste aviso (pode travar): o início do app vai para depois.
  sb.auth.onAuthStateChange((ev, sessao) => {
    if (sessao?.user) {
      const novo = !usuario; usuario = sessao.user;
      if (novo) setTimeout(() => entrouNoApp(sessao.user), 0);
    } else if (usuario) saiuDoApp();
    else mostrar('login');
  });
})();
