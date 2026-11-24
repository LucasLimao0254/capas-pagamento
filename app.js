'use strict';
/* ===================== Fluxo do processo ===================== */
// setor = quem pode mexer no processo nesta etapa (o administrador pode tudo)
const ETAPAS = [
  { id: 'montagem', n: 1, label: 'Montagem (capa)', setor: 'compras', onde: 'Compras', cor: '#3D5A73' },
  { id: 'controle', n: 2, label: 'No Controle Interno', setor: 'controle', onde: 'Controle Interno', cor: '#5B4B8A' },
  { id: 'enc_contabilidade', n: 3, label: 'Encaminhado à Contabilidade', setor: 'controle', onde: 'a caminho da Contabilidade', cor: '#1F6F8B' },
  { id: 'contabilidade', n: 4, label: 'Recebido pela Contabilidade', setor: 'controle', onde: 'Contabilidade', cor: '#1F6F8B' },
  { id: 'correcao', n: 5, label: 'Devolvido ao Compras p/ correção', setor: 'compras', onde: 'Compras (correção)', cor: '#A33A3A' },
  { id: 'controle_corrigido', n: 6, label: 'No Controle (corrigido)', setor: 'controle', onde: 'Controle Interno', cor: '#5B4B8A' },
  { id: 'pagamento', n: 7, label: 'Encaminhado p/ pagamento', setor: 'controle', onde: 'Financeiro', cor: '#9E4A1A' },
  { id: 'pos_pagamento', n: 8, label: 'No Controle após pagamento', setor: 'controle', onde: 'Controle Interno', cor: '#276A43' },
  { id: 'concluido', n: 9, label: 'Encaminhado à Contabilidade (final)', setor: null, onde: 'Contabilidade (concluído)', cor: '#5A6672' },
];
const etInfo = id => ETAPAS.find(e => e.id === id) || ETAPAS[0];
const SETORES = { compras: 'Compras', controle: 'Controle Interno' };
// Botões de cada etapa: para onde vai e o que pedir
const PASSOS = {
  montagem: [{ para: 'controle', txt: 'Encaminhar ao Controle Interno' }],
  controle: [{ para: 'enc_contabilidade', txt: 'Encaminhar à Contabilidade' }, { para: 'correcao', txt: 'Devolver ao Compras p/ correção', motivo: true, perigo: true }],
  controle_corrigido: [{ para: 'enc_contabilidade', txt: 'Encaminhar à Contabilidade' }, { para: 'correcao', txt: 'Devolver ao Compras p/ correção', motivo: true, perigo: true }],
  enc_contabilidade: [{ para: 'contabilidade', txt: 'Contabilidade recebeu' }],
  contabilidade: [{ para: 'pagamento', txt: 'Encaminhado p/ pagamento / foto enviada', forma: true }],
  correcao: [{ para: 'controle_corrigido', txt: 'Devolver ao Controle corrigido' }],
  pagamento: [{ para: 'pos_pagamento', txt: 'Pago — voltou ao Controle', data: true }],
  pos_pagamento: [{ para: 'concluido', txt: 'Encaminhar à Contabilidade (final)' }],
  concluido: [],
};
const CAMPOS_NUM = ['valor', 'iss_valor', 'irrf_valor', 'valor_liquido'];

/* ===================== Utilidades ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const n2 = v => v == null || v === '' ? null : r2(Number(v)); // numeric do Postgres chega como texto/número
const fmt = v => v == null ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtIn = v => v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dataHora = s => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const dataCurta = s => s ? new Date(s).toLocaleDateString('pt-BR') : '';
const dataDia = s => s ? s.split('-').reverse().join('/') : ''; // 'aaaa-mm-dd' -> 'dd/mm/aaaa'
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
const msgErro = e => (e && (e.message || e.error_description)) || String(e);

/* ===================== Servidor (Supabase) ===================== */
const CFG = window.CAPAS_CONFIG || {};
let sb = null, usuario = null;
let processos = new Map(); // id -> processo
let perfis = new Map();    // id -> perfil
let canal = null;
const meuPerfil = () => (usuario && perfis.get(usuario.id)) || { setor: null, admin: false, nome: '' };
const souAdmin = () => !!meuPerfil().admin;
const meuSetor = () => meuPerfil().setor;
const podeMexer = p => souAdmin() || (!!meuSetor() && meuSetor() === etInfo(p.status).setor);
const podeLancar = () => souAdmin() || meuSetor() === 'compras';
const podeRecolher = () => souAdmin() || meuSetor() === 'controle';

function normalizar(p) {
  const o = { ...p };
  CAMPOS_NUM.forEach(k => o[k] = n2(p[k]));
  o.duvida_campos = Array.isArray(p.duvida_campos) ? p.duvida_campos : [];
  return o;
}
async function carregarPerfis() {
  const { data, error } = await sb.from('perfis').select('*').order('criado_em');
  if (error) throw error;
  perfis = new Map(data.map(p => [p.id, p]));
}
async function carregarTudo() {
  await carregarPerfis();
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('processos').select('*').order('criado_em', { ascending: false }).range(de, de + 999);
    if (error) throw error;
    todos.push(...data);
    if (data.length < 1000) break;
  }
  processos = new Map(todos.map(p => [p.id, normalizar(p)]));
  podarSelecao(); render(); renderAjustes();
}
function assinarTempoReal() {
  if (canal) sb.removeChannel(canal);
  canal = sb.channel('processos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'processos' }, ev => {
      if (ev.eventType === 'DELETE') processos.delete(ev.old.id);
      else processos.set(ev.new.id, normalizar(ev.new));
      podarSelecao(); agendarRender();
      if (editId && ev.eventType === 'DELETE' && ev.old.id === editId) { fecharEditor(); toast('Este processo foi excluído por outra pessoa.'); }
      else if (editId && ev.new && ev.new.id === editId && ev.new.status !== editEtapa) {
        // Outra pessoa moveu o processo aberto: atualiza etapa e permissões sem apagar o que foi digitado
        const c = processos.get(editId);
        editEtapa = c.status; aplicarEstadoEditor(c);
        $('edErro').textContent = `Atenção: ${c.status_por_nome || 'outra pessoa'} moveu este processo para "${etInfo(c.status).n}. ${etInfo(c.status).label}". O que você digitou ainda não foi salvo.`;
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'perfis' }, ev => {
      if (ev.eventType === 'DELETE') perfis.delete(ev.old.id); else perfis.set(ev.new.id, ev.new);
      agendarRender(); renderAjustes();
      if (editId && processos.get(editId)) aplicarEstadoEditor(processos.get(editId)); // mudou o setor de alguém
    })
    .subscribe(st => { $('hInfo').innerHTML = `<span class="ponto ${st === 'SUBSCRIBED' ? '' : 'off'}"></span>${st === 'SUBSCRIBED' ? 'ao vivo' : 'reconectando'}`; });
}
async function atualizar(id, campos) {
  const { data, error } = await sb.from('processos').update(campos).eq('id', id).select();
  if (error) throw error;
  if (!data.length) throw new Error('Este processo não está com o seu setor.');
  processos.set(id, normalizar(data[0])); render();
  return data[0];
}
async function chamar(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  if (data && data.id) { processos.set(data.id, normalizar(data)); render(); }
  return data;
}

/* ===================== Checagens e alertas ===================== */
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
// Usa um índice montado uma vez por desenho da tela (comparar todos com todos ficava lento com muitos processos).
let idxDup = null;
const chaveDados = q => norm(q.credor) + '|' + montante(q);
function montarIndiceDup() {
  const porFoto = new Map(), porDados = new Map();
  const add = (m, k, q) => { const l = m.get(k); if (l) l.push(q); else m.set(k, [q]); };
  for (const q of processos.values()) {
    if (q.leitura === 'lendo') continue;
    if (q.foto_hash) add(porFoto, q.foto_hash, q);
    if (q.leitura === 'ok' && norm(q.credor) && montante(q)) add(porDados, chaveDados(q), q);
  }
  idxDup = { porFoto, porDados };
}
function duplicatasDe(p) {
  if (p.leitura === 'lendo') return [];
  if (!idxDup) montarIndiceDup();
  const out = [], vistos = new Set();
  for (const q of (p.foto_hash && idxDup.porFoto.get(p.foto_hash)) || []) {
    if (q.id !== p.id) { out.push({ q, foto: true }); vistos.add(q.id); }
  }
  if (p.leitura !== 'ok' || !norm(p.credor) || !montante(p)) return out;
  for (const q of idxDup.porDados.get(chaveDados(p)) || []) {
    if (q.id === p.id || vistos.has(q.id)) continue;
    const mesmoEmp = (p.empenho || '') === (q.empenho || '');
    const mesmaRef = norm(p.referente) === norm(q.referente);
    if (p.credor === 'Diárias' ? mesmoEmp : (mesmoEmp && mesmaRef)) out.push({ q, foto: false });
  }
  return out;
}
// Capa que ficou "lendo" por mais de 3 minutos (app fechou no envio ou a leitura falhou sem responder)
const travada = p => p.leitura === 'lendo' && Date.now() - new Date(p.alterado_em || p.criado_em).getTime() > 3 * 60000;
const lendoDeVerdade = p => p.leitura === 'lendo' && !travada(p);
const textoDup = d => `${d.foto ? 'Mesma foto já enviada' : 'Possível duplicata'}: lançado por ${d.q.criado_por_nome || '?'} em ${dataCurta(d.q.criado_em)}`;
const diasNaEtapa = p => Math.floor((Date.now() - new Date(p.status_em).getTime()) / 86400000);
const diasParado = () => Number(ls.get('diasParado', 3));
const parado = p => p.status !== 'concluido' && !lendoDeVerdade(p) && diasNaEtapa(p) >= diasParado();
// Retenção a recolher: processo pago com ISS/IRRF retido ainda não recolhido
const retPendentes = p => !p.pago_em ? [] : [
  ...(p.iss_valor > 0 && !p.iss_recolhido_em ? ['iss'] : []),
  ...(p.irrf_valor > 0 && !p.irrf_recolhido_em ? ['irrf'] : []),
];

/* ===================== Filtros ===================== */
const filtros = { p: { f: 'todos', busca: '' }, l: { f: 'todos', busca: '' } };
function passaFiltro(c, f) {
  if (f === 'todos') return true;
  if (f === 'comigo') return podeMexer(c) && c.status !== 'concluido';
  if (f === 'parados') return parado(c);
  if (f === 'retencoes') return retPendentes(c).length > 0;
  if (f === 'abertos') return c.status !== 'concluido';
  return c.status === f;
}
function filtrar(fl) {
  const q = fl.busca.trim().toLowerCase();
  return [...processos.values()].filter(c => passaFiltro(c, fl.f) &&
    (!q || [c.credor, c.empenho, c.referente, c.nota, c.mes, c.criado_por_nome].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
function chipsHtml(fl, extras) {
  const todos = [...processos.values()];
  const n = f => todos.filter(c => passaFiltro(c, f)).length;
  const chip = (f, txt) => `<button data-f="${f}" class="${fl.f === f ? 'on' : ''}">${txt} (${n(f)})</button>`;
  return chip('todos', 'Todos') + extras.map(([f, t]) => chip(f, t)).join('') +
    ETAPAS.map(e => chip(e.id, `${e.n}. ${e.label}`)).join('');
}

/* ===================== Renderização: Processos ===================== */
const BTN_DEL = id => `<button class="del" data-del="${id}" aria-label="Excluir"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button>`;
const etapaPill = p => { const e = etInfo(p.status); return `<span class="etapa" style="background:${e.cor}">${e.n}. ${esc(e.label)}</span>`; };
const TAG_PARADO = '<span class="tag"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>parado</span>';
function botoesPassos(p) {
  if (!podeMexer(p) || p.leitura !== 'ok') return '';
  return (PASSOS[p.status] || []).map(s => `<button class="btn ${s.perigo ? 'per' : ''}" data-mv="${p.id}" data-para="${s.para}">${esc(s.txt)}</button>`).join('');
}
function renderProcessos() {
  const perf = meuPerfil();
  $('boxLancar').hidden = !podeLancar();
  $('boxSetor').hidden = podeLancar();
  $('boxSetor').innerHTML = perf.setor
    ? `Você está no <b>${SETORES[perf.setor]}</b>. Toque nos botões dos processos que estão com o seu setor para movê-los.`
    : `Você ainda não tem setor definido: pode ver os processos, mas não alterá-los. Peça ao administrador para definir o seu setor.`;
  $('pChips').innerHTML = chipsHtml(filtros.p, [['comigo', 'Com meu setor'], ['parados', 'Parados'], ['retencoes', 'Retenções a recolher']]);
  montarIndiceDup();
  const vis = filtrar(filtros.p);
  const todos = [...processos.values()];
  const lendo = todos.filter(lendoDeVerdade).length;
  const erros = todos.filter(c => c.leitura === 'erro' || travada(c)).length;
  const nParados = todos.filter(parado).length;
  const nRet = todos.filter(c => retPendentes(c).length).length;
  const linhas = [];
  if (envio.total) linhas.push(`<span class="spin"></span> Enviando fotos: ${envio.feitas}/${envio.total}`);
  if (lendo) linhas.push(`<span class="spin"></span> Lendo ${lendo} capa(s)…`);
  if (erros) linhas.push(`<span style="color:var(--err)">${erros} capa(s) com erro de leitura — toque para tentar de novo.</span>`);
  if (nParados) linhas.push(`<a href="#" data-ir="parados" style="color:var(--err)">⏱ ${nParados} processo(s) parado(s) há ${diasParado()}+ dias na mesma etapa</a>`);
  if (nRet) linhas.push(`<a href="#" data-ir="retencoes" style="color:var(--warn)">💰 ${nRet} processo(s) pago(s) com ISS/IRRF a recolher</a>`);
  $('pResumo').innerHTML = linhas.length ? `<div class="card muted">${linhas.join('<br>')}</div>` : '';
  $('pLista').innerHTML = vis.length ? vis.slice(0, limites.p).map(c => {
    const e = etInfo(c.status);
    const rodape = `<div class="rodape">${etapaPill(c)}<span class="com">com ${esc(e.onde)} há ${diasNaEtapa(c)} dia(s)</span>${parado(c) ? TAG_PARADO : ''}</div>`;
    let corpo, depois = rodape;
    if (lendoDeVerdade(c)) corpo = `<div class="t"><span><span class="spin"></span> Lendo capa…</span></div><div class="d">Enviada por ${esc(c.criado_por_nome || '')}</div>`;
    else if (travada(c)) corpo = `<div class="t"><span>A leitura não terminou</span></div><div class="aviso">A foto não chegou a ser lida (o app pode ter sido fechado durante o envio). ${podeMexer(c) ? 'Toque para ler de novo ou preencher.' : ''}</div>`;
    else if (c.leitura === 'erro') corpo = `<div class="t"><span>Não foi possível ler</span></div><div class="aviso">${esc(c.leitura_erro)} ${podeMexer(c) ? 'Toque para tentar de novo ou preencher.' : ''}</div>`;
    else {
      const pr = checar(c), dups = duplicatasDe(c), ret = retPendentes(c);
      // etapa logo abaixo do credor: primeiro "em que pé está", depois os detalhes
      corpo = `<div class="t"><span>${esc(c.credor || '(sem credor)')}</span><span>${fmt(montante(c))}</span></div>${rodape}`;
      depois = `<div class="d">${c.credor === 'Diárias' ? 'Beneficiário: ' : ''}${esc(c.empenho || '-')} · ${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''}</div>
        <div class="d">Líq. ${fmt(c.valor_liquido)} · ISS ${c.iss_valor != null ? `<b>${fmt(c.iss_valor)}</b>` : '-'} · IRRF ${c.irrf_valor != null ? `<b>${fmt(c.irrf_valor)}</b>` : '-'}${c.pago_em ? ` · pago em ${dataDia(c.pago_em)}` : ''}</div>
        ${c.nota ? `<div class="d">📝 ${esc(c.nota)}</div>` : ''}
        ${dups.map(d => `<div class="aviso">⚠ ${esc(textoDup(d))}</div>`).join('')}
        ${pr.map(x => `<div class="aviso ${x.grave ? '' : 'am'}">⚠ ${esc(x.t)}</div>`).join('')}
        ${ret.length ? `<div class="aviso am">💰 A recolher: ${ret.map(r => r.toUpperCase()).join(' e ')}</div>` : ''}`;
    }
    return `<div class="proc${parado(c) ? ' parado' : ''}" data-id="${c.id}">
      <div class="topo"><div class="c">${corpo}</div>${podeMexer(c) ? BTN_DEL(c.id) : ''}</div>
      ${depois}
      ${botoesPassos(c) ? `<div class="acoes">${botoesPassos(c)}</div>` : ''}
    </div>`;
  }).join('') + botaoMais('p', vis.length) : `<div class="vazio">${processos.size ? 'Nenhum processo neste filtro.' : (podeLancar() ? 'Nenhum processo ainda.<br>Toque em <b>Adicionar capas</b> e escolha ou tire as fotos.' : 'Nenhum processo ainda.')}</div>`;
}
// Desenha 100 por vez (desenhar milhares de cartões deixava o celular lento)
const POR_PAGINA = 100;
const limites = { p: POR_PAGINA, l: POR_PAGINA };
const botaoMais = (k, total) => total > limites[k]
  ? `<div class="row" style="margin:10px 0"><button class="btn sec" data-mais="${k}">Mostrar mais (${total - limites[k]} restantes)</button></div>` : '';
let renderPendente = false;
function agendarRender() { // junta várias mudanças seguidas (tempo real) num só desenho
  if (renderPendente) return;
  renderPendente = true;
  requestAnimationFrame(() => { renderPendente = false; render(); });
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
  $('lChips').innerHTML = chipsHtml(filtros.l, [['abertos', 'Em andamento']]);
  const vis = filtrar(filtros.l).filter(c => c.leitura === 'ok');
  // agrupado por credor, como sai no PDF, com quantos estão marcados e o subtotal marcado
  const grupos = new Map();
  for (const c of vis.slice(0, limites.l)) {
    const k = (c.credor || '(sem credor)').trim();
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  $('lLista').innerHTML = vis.length ? [...grupos].map(([credor, itens]) => {
    const marc = itens.filter(c => selecao.has(c.id));
    const sub = r2(marc.reduce((s, c) => s + montante(c), 0));
    return `<section class="grupo" aria-label="${esc(credor)}">
      <div class="gtopo"><span>${esc(credor)}</span><span>${marc.length} de ${itens.length}${marc.length ? ` · <b>${fmt(sub)}</b>` : ''}</span></div>
      ${itens.map(c => {
        const m = selecao.has(c.id);
        return `<label class="sel ${m ? 'marcado' : ''}" data-lid="${c.id}">
        <input type="checkbox" ${m ? 'checked' : ''} data-chk="${c.id}">
        <div class="c" style="flex:1;min-width:0">
          <div class="t"><span>${esc(c.empenho || '-')} · ${esc(c.referente || 'N/D')}${c.mes ? ' · ' + esc(c.mes) : ''}</span><span>${fmt(montante(c))}</span></div>
          <div class="d">${etapaPill(c)} · lançado ${dataCurta(c.criado_em)}</div>
        </div></label>`;
      }).join('')}
    </section>`;
  }).join('') + botaoMais('l', vis.length) : `<div class="vazio">Nenhum processo lido neste filtro.</div>`;
  const sel = [...selecao].map(id => processos.get(id)).filter(Boolean);
  $('barra').hidden = !sel.length;
  $('barraInfo').innerHTML = `<b>${sel.length}</b> selecionado${sel.length > 1 ? 's' : ''} · ${fmt(r2(sel.reduce((s, c) => s + montante(c), 0)))}`;
}
function render() { if (!usuario) return; idxDup = null; renderProcessos(); renderLista(); }

/* ===================== Renderização: Ajustes ===================== */
function renderAjustes() {
  if (!usuario) return;
  const perf = meuPerfil();
  $('aEmail').textContent = `${usuario.email || ''} · ${perf.setor ? SETORES[perf.setor] : 'sem setor'}${perf.admin ? ' · administrador' : ''}`;
  if (document.activeElement !== $('aNome')) $('aNome').value = perf.nome || '';
  $('boxAdmin').hidden = !perf.admin;
  $('bImport').hidden = !podeLancar(); // importar cria processos, e só o Compras (ou o administrador) cria
  if (!perf.admin) return;
  // pendência: sem setor (não vê/mexe em nada) ou sem nome (vai preencher no primeiro acesso)
  const pend = p => [!p.setor && !p.admin && 'Ainda não pode mexer em nenhum processo: escolha o setor.', !nomeValido(p.nome) && 'O nome é pedido no primeiro acesso.'].filter(Boolean);
  const nPend = [...perfis.values()].filter(p => pend(p).length).length;
  $('aPend').hidden = !nPend;
  $('aPend').textContent = `${nPend} pendência${nPend > 1 ? 's' : ''}`;
  $('aEquipe').innerHTML = [...perfis.values()].map(p => { const pe = pend(p); return `<div class="pessoa${pe.length ? ' pend' : ''}">
    <div class="c"><b>${esc(p.nome || '(sem nome)')}</b><br><span class="muted">${esc(p.email || '')}</span></div>
    <select data-pset="${p.id}" aria-label="Setor de ${esc(p.nome || p.email || 'pessoa')}"><option value="">Sem setor</option>${Object.entries(SETORES).map(([k, v]) => `<option value="${k}" ${p.setor === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label><input type="checkbox" data-padm="${p.id}" ${p.admin ? 'checked' : ''}> admin</label>
    ${pe.length ? `<span class="pend-txt">${pe.join(' ')}</span>` : ''}
  </div>`; }).join('');
}

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
    t().catch(e => { console.error(e); toast(msgErro(e) || 'Erro ao enviar.'); })
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
  if (!podeLancar()) { toast('Só o Compras lança processos novos.'); return; }
  const diarias = $('chkDiarias').checked;
  const hashes = new Map(); // hash -> processo existente
  for (const p of processos.values()) if (p.foto_hash) hashes.set(p.foto_hash, p);
  const aceitas = [];
  for (const f of files) {
    let h = null; try { h = await hashArquivo(f); } catch { }
    if (h && hashes.has(h)) {
      const q = hashes.get(h);
      if (q === 'lote') { if (!confirm('Você escolheu a mesma foto duas vezes neste envio. Enviar as duas?')) continue; }
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
  if (!podeLancar()) { toast('Só o Compras lança processos novos.'); return; }
  const diarias = $('chkDiarias').checked;
  const { data, error } = await sb.from('processos').insert({ diarias, credor: diarias ? 'Diárias' : '', leitura: 'ok' }).select().single();
  if (error) { toast('Erro: ' + msgErro(error)); return; }
  processos.set(data.id, normalizar(data)); render();
  editNovo = true; abrirEditor(data.id);
}
async function excluir(id, perguntar = true) {
  const c = processos.get(id); if (!c) return;
  if (perguntar && !confirm(`Excluir ${c.credor || 'este processo'}${montante(c) ? ' (' + fmt(montante(c)) + ')' : ''}?\nSai da lista de toda a equipe. Isso não pode ser desfeito.`)) return false;
  const { data, error } = await sb.from('processos').delete().eq('id', id).select('id');
  if (error || !data.length) { toast(error ? 'Erro ao excluir: ' + msgErro(error) : 'Este processo não está com o seu setor.'); return false; }
  if (c.foto_path) sb.storage.from('capas').remove([c.foto_path]).catch(() => { });
  processos.delete(id); selecao.delete(id); salvarSelecao(); render();
  if (perguntar) toast('Processo excluído.');
  return true;
}

/* ===================== Mover de etapa ===================== */
let mv = null; // { id, passo }
function abrirMover(id, para) {
  const p = processos.get(id); if (!p) return;
  const passo = (PASSOS[p.status] || []).find(s => s.para === para); if (!passo) return;
  mv = { id, passo };
  $('mvTit').textContent = passo.txt;
  $('mvDesc').innerHTML = `<b>${esc(p.credor || '(sem credor)')}</b> · ${fmt(montante(p))}<br>${esc(etInfo(p.status).n + '. ' + etInfo(p.status).label)} → <b>${esc(etInfo(para).n + '. ' + etInfo(para).label)}</b>`;
  $('mvBoxForma').hidden = !passo.forma;
  $('mvBoxData').hidden = !passo.data; $('mvData').value = hojeISO();
  $('mvLblObs').textContent = passo.motivo ? 'Motivo da devolução (obrigatório)' : 'Observação (opcional)';
  $('mvObs').value = ''; $('mvErro').textContent = '';
  $('mover').classList.add('on');
  if (passo.motivo) setTimeout(() => $('mvObs').focus(), 50);
}
function fecharMover() { mv = null; $('mover').classList.remove('on'); }
async function confirmarMover() {
  if (!mv) return;
  const { id, passo } = mv;
  let obs = $('mvObs').value.trim();
  if (passo.motivo && !obs) { $('mvErro').textContent = 'Informe o motivo da devolução.'; return; }
  if (passo.data && !$('mvData').value) { $('mvErro').textContent = 'Informe a data do pagamento.'; return; }
  if (passo.forma) obs = [$('mvForma').value, obs].filter(Boolean).join(' — ');
  $('mvOk').disabled = true;
  try {
    // Movendo pelo editor com alterações não salvas: salva antes, para não perder o que foi digitado
    const c = processos.get(id);
    if (editId === id && c && podeMexer(c) && formMudou(c)) await atualizar(id, camposDoForm());
    await chamar('mover_processo', { p_id: id, p_para: passo.para, p_obs: obs, p_pago_em: passo.data ? $('mvData').value : null });
    fecharMover(); toast(`Movido para: ${etInfo(passo.para).n}. ${etInfo(passo.para).label}`);
    if (editId === id) { editEtapa = processos.get(id).status; $('edErro').textContent = ''; aplicarEstadoEditor(processos.get(id)); }
  } catch (e) { $('mvErro').textContent = msgErro(e); }
  finally { $('mvOk').disabled = false; }
}
async function desfazer(id) {
  if (!confirm('Desfazer o último passo deste processo? Ele volta para a etapa anterior.')) return;
  try {
    await chamar('desfazer_movimento', { p_id: id }); toast('Passo desfeito.');
    if (editId === id) { editEtapa = processos.get(id).status; aplicarEstadoEditor(processos.get(id)); }
  }
  catch (e) { toast(msgErro(e), 4000); }
}
async function recolher(id, imposto, marcar) {
  let data = null;
  if (marcar) {
    data = prompt(`Data do recolhimento do ${imposto.toUpperCase()} (dd/mm/aaaa):`, hoje());
    if (data == null) return;
    const m = data.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) { toast('Data inválida. Use dd/mm/aaaa.'); return; }
    data = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  } else if (!confirm(`Desmarcar o recolhimento do ${imposto.toUpperCase()}?`)) return;
  try { await chamar('marcar_recolhido', { p_id: id, p_imposto: imposto, p_data: data }); toast(marcar ? 'Recolhimento registrado.' : 'Recolhimento desmarcado.'); if (editId === id) aplicarEstadoEditor(processos.get(id)); }
  catch (e) { toast(msgErro(e), 4000); }
}

/* ===================== Editor ===================== */
let editId = null, editNovo = false, editEtapa = null;
const CAMPOS_FORM = ['e_credor', 'e_empenho', 'e_valor', 'e_valor_liquido', 'e_iss_valor', 'e_irrf_valor', 'e_mes', 'e_referente', 'e_nota'];
async function abrirEditor(id) {
  const c = processos.get(id); if (!c || lendoDeVerdade(c)) return;
  editId = id; editEtapa = c.status;
  $('edTit').textContent = editNovo ? 'Novo processo' : (c.credor || 'Processo');
  $('edErro').textContent = c.leitura === 'erro' ? 'Leitura falhou: ' + c.leitura_erro
    : travada(c) ? 'A leitura desta capa não terminou. Toque em "Ler de novo" ou preencha os campos e salve.' : '';
  preencherCampos(c);
  $('edFoto').hidden = true; $('edFoto').removeAttribute('src'); $('edFoto').classList.remove('zoom'); $('edDica').hidden = true;
  aplicarEstadoEditor(c);
  $('sheet').classList.add('on');
  if (c.foto_path) {
    sb.storage.from('capas').createSignedUrl(c.foto_path, 600).then(({ data }) => {
      if (data && editId === id) { $('edFoto').src = data.signedUrl; $('edFoto').hidden = false; $('edDica').hidden = false; }
    });
  }
}
function preencherCampos(c) {
  $('e_credor').value = c.credor || ''; $('e_empenho').value = c.empenho || '';
  CAMPOS_NUM.forEach(k => $('e_' + k).value = fmtIn(c[k]));
  $('e_mes').value = c.mes || ''; $('e_referente').value = c.referente === 'N/D' ? '' : (c.referente || '');
  $('e_nota').value = c.nota || '';
  atualizarRotulos(); previaChecagem();
}
// Etapa, botões, permissões, retenções e histórico — sem mexer no que foi digitado nos campos
function aplicarEstadoEditor(c) {
  const id = c.id, pode = podeMexer(c), e = etInfo(c.status);
  $('edEtapa').innerHTML = `${etapaPill(c)} <span class="com">com ${esc(e.onde)} há ${diasNaEtapa(c)} dia(s)</span>${parado(c) ? TAG_PARADO : ''}` +
    (pode ? '' : `<p class="muted" style="margin:6px 0 0">Somente leitura: este processo está com ${e.setor ? SETORES[e.setor] : 'a Contabilidade (concluído)'}.</p>`);
  $('edAcoes').innerHTML = editNovo ? '' : botoesPassos(c);
  CAMPOS_FORM.forEach(k => $(k).disabled = !pode);
  $('edSalvar').hidden = !pode; $('edExcluir').hidden = !pode;
  $('edReler').hidden = !(pode && c.foto_path);
  // retenções (ISS/IRRF) — só faz sentido depois de pago
  const linhasRet = ['iss', 'irrf'].filter(k => c[k + '_valor'] > 0).map(k => {
    const quando = c[k + '_recolhido_em'];
    const btn = podeRecolher() && c.pago_em ? (quando ? `<button class="btn sec" data-rec="${k}" data-marcar="0">Desmarcar</button>` : `<button class="btn" data-rec="${k}" data-marcar="1">Marcar recolhido</button>`) : '';
    return `<div class="ret"><span>${k.toUpperCase()} ${fmt(c[k + '_valor'])}: ${quando ? `recolhido em ${dataDia(quando)}` : (c.pago_em ? '<b style="color:var(--warn)">a recolher</b>' : 'aguardando pagamento')}</span>${btn}</div>`;
  });
  $('edRet').innerHTML = linhasRet.length ? `<label>Retenções</label>${linhasRet.join('')}` : '';
  $('edInfo').innerHTML = `Lançado por ${esc(c.criado_por_nome || '?')} em ${dataHora(c.criado_em)}` +
    (c.pago_em ? `<br>Pago em ${dataDia(c.pago_em)}` : '') +
    (c.alterado_por_nome && c.alterado_em !== c.criado_em ? `<br>Última alteração: ${esc(c.alterado_por_nome)} em ${dataHora(c.alterado_em)}` : '');
  sb.from('status_historico').select('de, para, em, por_nome, obs').eq('processo_id', id).order('em').then(({ data }) => {
    if (!data || editId !== id || !data.length) return;
    $('edInfo').innerHTML += `<br><b>Histórico</b><ul class="hist">${data.map(h => `<li>${dataHora(h.em)} — ${h.de ? '' : 'Lançado: '}${esc(etInfo(h.para).n + '. ' + etInfo(h.para).label)} (${esc(h.por_nome || '?')})${h.obs ? `<br><i>“${esc(h.obs)}”</i>` : ''}</li>`).join('')}</ul>`;
    // "Desfazer" aparece para quem fez o último passo (o setor da etapa anterior) ou para o administrador
    const ult = data[data.length - 1], atual = processos.get(id);
    if (!editNovo && atual && ult.de && ult.para === atual.status && (souAdmin() || (meuSetor() && meuSetor() === etInfo(ult.de).setor))
        && !$('edAcoes').querySelector('[data-desf]')) {
      $('edAcoes').insertAdjacentHTML('beforeend', `<button class="btn sec" data-desf="${id}">↶ Desfazer último passo (${esc(etInfo(ult.de).n + '. ' + etInfo(ult.de).label)})</button>`);
    }
  });
}
// O que foi digitado no editor é diferente do que está salvo?
function formMudou(c) {
  const f = lerForm();
  return ['credor', 'empenho', 'mes', 'referente', ...CAMPOS_NUM].some(k => (f[k] ?? null) !== (k === 'referente' ? (c.referente || 'N/D') : (c[k] ?? (CAMPOS_NUM.includes(k) ? null : ''))))
    || $('e_nota').value.trim() !== (c.nota || '');
}
const camposDoForm = () => ({ ...lerForm(), nota: $('e_nota').value.trim(), diarias: $('e_credor').value.trim() === 'Diárias' });
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
  editId = null; editNovo = false; editEtapa = null; $('sheet').classList.remove('on');
  if (descartarNovo && novo && id) await excluir(id, false);
  render();
}
async function salvarEditor() {
  const id = editId; if (!id) return;
  const campos = { ...camposDoForm(), duvida: '', duvida_campos: [] };
  const c = processos.get(id);
  if (c && c.leitura !== 'ok') { campos.leitura = 'ok'; campos.leitura_erro = ''; } // erro ou leitura travada: preenchido à mão
  $('edSalvar').disabled = true;
  try { await atualizar(id, campos); editNovo = false; await fecharEditor(false); toast('Salvo.'); }
  catch (e) { toast('Erro ao salvar: ' + msgErro(e)); }
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
  const cols = [['credor', 'Credor'], ['empenho', 'Empenho'], ['valor', 'Valor'], ['iss_valor', 'ISS'], ['irrf_valor', 'IRRF'], ['valor_liquido', 'Valor Líquido'], ['mes', 'Mês'], ['referente', 'Referente'],
    ['etapa', 'Etapa'], ['dias', 'Dias na etapa'], ['pago_em', 'Pago em'], ['iss_recolhido_em', 'ISS recolhido em'], ['irrf_recolhido_em', 'IRRF recolhido em'], ['nota', 'Observação'], ['criado_por_nome', 'Lançado por'], ['criado_em', 'Lançado em']];
  const cel = v => { const s = v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const val = (c, k) => k === 'etapa' ? `${etInfo(c.status).n}. ${etInfo(c.status).label}` : k === 'dias' ? diasNaEtapa(c)
    : ['pago_em', 'iss_recolhido_em', 'irrf_recolhido_em'].includes(k) ? dataDia(c[k]) : k === 'criado_em' ? dataHora(c[k]) : c[k];
  const linhas = [cols.map(c => c[1]).join(';'), ...[...processos.values()].filter(c => c.leitura === 'ok').map(c => cols.map(([k]) => cel(val(c, k))).join(';'))];
  baixar(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `processos-${hoje().replace(/\//g, '-')}.csv`);
}
const ETAPA_ANTIGA = { recebido: 'montagem', pendente_certidao: 'controle', pendente_pagamento: 'pagamento', pago: 'pos_pagamento', devolvido: 'correcao' };
const DO_BACKUP = c => {
  const status = ETAPA_ANTIGA[c.status] || (ETAPAS.some(e => e.id === c.status) ? c.status : 'montagem');
  return {
    credor: c.credor || '', empenho: c.empenho || '', mes: c.mes || '', referente: c.referente || 'N/D', nota: c.nota || '',
    valor: n2(c.valor), iss_valor: n2(c.iss_valor), irrf_valor: n2(c.irrf_valor), valor_liquido: n2(c.valor_liquido),
    status, diarias: c.credor === 'Diárias', leitura: 'ok',
    ...(status === 'pos_pagamento' ? { pago_em: hojeISO() } : {}),
    ...(c.criado_em || c.criadoEm ? { criado_em: new Date(c.criado_em || c.criadoEm).toISOString() } : {}),
  };
};
async function importarLista(capas) {
  let validas = capas.filter(c => !c.lendo && !c.erro && (c.credor || c.valor != null || c.valor_liquido != null)).map(DO_BACKUP);
  if (!validas.length) { toast('Nada para importar.'); return 0; }
  // Quem não é administrador só pode criar na Montagem
  if (!souAdmin()) validas = validas.map(v => ({ ...v, status: 'montagem', pago_em: undefined }));
  // pago_em não pode ser gravado direto (só pelo botão); o administrador importa a etapa e registra o pagamento depois
  validas = validas.map(({ pago_em, ...v }) => v);
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
  $('boxLocal').hidden = !n || !podeLancar();
  if (n) $('bLocal').textContent = `Enviar ${n} processo(s) salvos só neste aparelho`;
}

/* ===================== Login e início ===================== */
function mostrar(tela) {
  $('telaConfig').hidden = tela !== 'config';
  $('telaLogin').hidden = tela !== 'login';
  $('telaNome').hidden = tela !== 'nome';
  $('nav').hidden = tela !== 'app';
  document.body.classList.toggle('semnav', tela !== 'app');
  if (tela !== 'app') $('bBusca').hidden = true;
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', tela === 'app' && s.id === 'tab-' + abaAtual));
}
let abaAtual = 'processos';
function irPara(tab) {
  abaAtual = tab;
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab));
  document.querySelectorAll('nav button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  atualizarBusca();
  $('hTitulo').textContent = { processos: 'Processos', lista: 'Lista para impressão', ajustes: 'Ajustes' }[tab];
  window.scrollTo(0, 0);
}
// Nome é obrigatório: pelo menos 3 letras (sem contar espaços).
const nomeValido = n => (n || '').replace(/\s/g, '').length >= 3;
async function entrouNoApp(user) {
  usuario = user;
  try { await carregarPerfis(); } catch { }
  if (perfis.size && !nomeValido(meuPerfil().nome)) { pedirNome(); return; }
  mostrar('app'); irPara(abaAtual);
  try { await carregarTudo(); } catch (e) { toast('Erro ao carregar: ' + msgErro(e), 5000); }
  // primeira vez com setor "Compras" ou sem setor → já mostra o que está com o setor
  if (filtros.p.f === 'todos' && meuSetor() && !ls.get('filtroEscolhido', false)) { filtros.p.f = 'comigo'; render(); }
  assinarTempoReal();
  verificarLocalAntigo();
}
function pedirNome() {
  $('nErro').textContent = ''; $('nNome').value = '';
  $('hTitulo').textContent = 'Capas de Pagamento';
  mostrar('nome'); $('nNome').focus();
}
async function salvarNome(nome) {
  nome = nome.trim().replace(/\s+/g, ' ');
  if (!nomeValido(nome)) return 'Escreva seu nome (pelo menos 3 letras).';
  const { data, error } = await sb.from('perfis').update({ nome }).eq('id', usuario.id).select();
  if (error || !data.length) return 'Erro: ' + (error ? msgErro(error) : 'perfil não encontrado');
  perfis.set(usuario.id, data[0]);
  return '';
}
function saiuDoApp() {
  usuario = null; processos = new Map(); perfis = new Map();
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
  $(chips).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { filtros[k].f = b.dataset.f; limites[k] = POR_PAGINA; if (k === 'p') ls.set('filtroEscolhido', true); rend(); } });
  $(busca).oninput = e => { filtros[k].busca = e.target.value; limites[k] = POR_PAGINA; rend(); };
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mais]'); if (!b) return;
  e.preventDefault(); limites[b.dataset.mais] += POR_PAGINA; render();
});
ligarFiltro('p', 'pChips', 'pBusca', renderProcessos);
ligarFiltro('l', 'lChips', 'lBusca', renderLista);

// Busca escondida atrás da lupa do cabeçalho (sobra espaço para os cartões). Com texto digitado, fica sempre à mostra.
const buscaAberta = { p: false, l: false };
const abaBusca = () => ({ processos: 'p', lista: 'l' })[abaAtual];
function atualizarBusca() {
  const k = abaBusca();
  $('bBusca').hidden = !k || $('nav').hidden;
  for (const [kk, id] of [['p', 'pBusca'], ['l', 'lBusca']]) $(id).hidden = !(buscaAberta[kk] || filtros[kk].busca);
  const aberta = !!k && !$(k === 'p' ? 'pBusca' : 'lBusca').hidden;
  $('bBusca').classList.toggle('on', aberta);
  $('bBusca').setAttribute('aria-expanded', aberta);
}
$('bBusca').onclick = () => {
  const k = abaBusca(); if (!k) return;
  const inp = $(k === 'p' ? 'pBusca' : 'lBusca');
  buscaAberta[k] = inp.hidden;
  if (!buscaAberta[k] && filtros[k].busca) { inp.value = ''; filtros[k].busca = ''; limites[k] = POR_PAGINA; render(); }
  atualizarBusca();
  if (buscaAberta[k]) inp.focus();
};

$('bVerSenha').onclick = () => {
  const s = $('lSenha'), ver = s.type === 'password';
  s.type = ver ? 'text' : 'password';
  $('bVerSenha').setAttribute('aria-pressed', ver);
  $('bVerSenha').setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha');
};

// Toque na foto da capa: amplia em tela cheia; toque de novo fecha.
$('edFoto').onclick = () => $('edFoto').classList.toggle('zoom');
$('pResumo').addEventListener('click', e => { const a = e.target.closest('[data-ir]'); if (a) { e.preventDefault(); filtros.p.f = a.dataset.ir; ls.set('filtroEscolhido', true); renderProcessos(); } });

$('pLista').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (d) { excluir(d.dataset.del); return; }
  const m = e.target.closest('[data-mv]'); if (m) { abrirMover(m.dataset.mv, m.dataset.para); return; }
  const it = e.target.closest('.proc'); if (it) abrirEditor(it.dataset.id);
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
$('sheet').addEventListener('click', e => {
  if (e.target === $('sheet')) { fecharEditor(true); return; }
  const m = e.target.closest('[data-mv]'); if (m) { abrirMover(m.dataset.mv, m.dataset.para); return; }
  const d = e.target.closest('[data-desf]'); if (d) { desfazer(d.dataset.desf); return; }
  const r = e.target.closest('[data-rec]'); if (r && editId) { recolher(editId, r.dataset.rec, r.dataset.marcar === '1'); }
});
$('edSalvar').onclick = salvarEditor;
$('edExcluir').onclick = async () => { const id = editId, novo = editNovo; if (await excluir(id, !novo) !== false) { editNovo = false; fecharEditor(false); } };
$('edReler').onclick = async () => {
  const id = editId; await fecharEditor(false);
  try { await atualizar(id, { leitura: 'lendo', leitura_erro: '' }); await pedirLeitura(id); } catch (e) { toast('Erro: ' + msgErro(e)); }
};
['e_valor', 'e_iss_valor', 'e_irrf_valor', 'e_valor_liquido'].forEach(i => $(i).oninput = previaChecagem);
$('e_credor').oninput = atualizarRotulos;

$('mvX').onclick = fecharMover;
$('mover').addEventListener('click', e => { if (e.target === $('mover')) fecharMover(); });
$('mvOk').onclick = confirmarMover;

$('modelo').value = ls.get('modelo', 'claude-opus-5-5');
$('modelo').onchange = e => { ls.set('modelo', e.target.value); toast('Modelo salvo.'); };
$('diasParado').value = String(diasParado());
$('diasParado').onchange = e => { ls.set('diasParado', Number(e.target.value)); render(); toast('Alerta ajustado.'); };
$('bSalvarNome').onclick = async () => {
  const erro = await salvarNome($('aNome').value);
  if (erro) { toast(erro); return; }
  renderAjustes(); render(); toast('Nome salvo.');
};
$('fNome').addEventListener('submit', async e => {
  e.preventDefault(); $('nErro').textContent = ''; $('bNome').disabled = true;
  const erro = await salvarNome($('nNome').value);
  $('bNome').disabled = false;
  if (erro) { $('nErro').textContent = erro; $('nNome').focus(); return; }
  entrouNoApp(usuario);
});
$('bNomeSair').onclick = () => sb.auth.signOut();
$('aEquipe').addEventListener('change', async e => {
  const s = e.target.closest('[data-pset]'), a = e.target.closest('[data-padm]');
  const id = (s || a)?.dataset.pset || (s || a)?.dataset.padm; if (!id) return;
  const campos = s ? { setor: s.value || null } : { admin: a.checked };
  const { data, error } = await sb.from('perfis').update(campos).eq('id', id).select();
  if (error || !data.length) { toast('Erro: ' + (error ? msgErro(error) : 'sem permissão')); renderAjustes(); return; }
  perfis.set(id, data[0]); render(); renderAjustes(); toast('Equipe atualizada.');
});
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
  } catch (er) { toast(msgErro(er) || 'Arquivo de backup inválido.'); }
};
$('bLocal').onclick = async () => {
  const st = await lerLocalAntigo(); if (!st) return;
  if (!confirm('Enviar os processos salvos neste aparelho para o servidor da equipe?')) return;
  try { const n = await importarLista(st.capas); ls.set('localImportado', true); $('boxLocal').hidden = true; toast(`${n} processo(s) enviado(s).`); }
  catch (er) { toast('Erro: ' + msgErro(er)); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && usuario) carregarTudo().catch(() => { }); });
// dias parados e leituras travadas mudam com o tempo: redesenha a cada minuto
setInterval(() => { if (usuario && !document.hidden) agendarRender(); }, 60000);

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
