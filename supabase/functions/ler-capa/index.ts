// Função "ler-capa" (Supabase Edge Function).
// Recebe { id, modelo }, lê a foto do processo com o Claude e grava os campos no banco.
// Responde na hora (202) e termina a leitura em segundo plano: o app recebe o resultado
// pelo tempo real do banco, mesmo que o celular feche o app no meio.
// Segredo necessário (Edge Functions → Secrets): ANTHROPIC_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk@1.2.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const MODELOS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const CAMPOS_NUM = ["valor", "iss_valor", "irrf_valor", "valor_liquido"] as const;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  type: "object",
  properties: {
    credor: { type: "string" },
    empenho: { type: "string" },
    valor: { type: ["number", "null"] },
    iss_valor: { type: ["number", "null"] },
    irrf_valor: { type: ["number", "null"] },
    valor_liquido: { type: ["number", "null"] },
    mes: { type: "string" },
    referente: { type: "string" },
    observacao: { type: "string" },
    duvida: { type: "string" },
    duvida_campos: {
      type: "array",
      items: { type: "string", enum: ["credor", "empenho", "valor", "iss_valor", "irrf_valor", "valor_liquido", "mes", "referente"] },
    },
  },
  required: ["credor", "empenho", "valor", "iss_valor", "irrf_valor", "valor_liquido", "mes", "referente", "observacao", "duvida", "duvida_campos"],
  additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function mensagemErro(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Chave da API do Claude inválida no servidor.";
  if (e instanceof Anthropic.PermissionDeniedError) return "A chave da API não tem permissão para este modelo.";
  if (e instanceof Anthropic.RateLimitError) return "Limite de uso da API atingido. Tente de novo em instantes.";
  if (e instanceof Anthropic.BadRequestError) return "Pedido recusado pela API: " + e.message;
  if (e instanceof Anthropic.APIConnectionError) return "Sem conexão com a API do Claude.";
  if (e instanceof Anthropic.APIError) return `Erro ${e.status} na API do Claude.`;
  return e instanceof Error ? e.message : String(e);
}

async function lerComClaude(foto: Uint8Array, mediaType: string, modelo: string) {
  const client = new Anthropic(); // usa ANTHROPIC_API_KEY
  const pedido = {
    model: modelo,
    max_tokens: 16000,
    system: PROMPT,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64(foto) } },
        { type: "text", text: "Leia esta capa de processo de pagamento." },
      ],
    }],
  };
  // Haiku não tem fallback no servidor; os demais trocam de modelo sozinhos se houver recusa.
  // deno-lint-ignore no-explicit-any
  const resp: any = modelo === "claude-haiku-5-5"
    // deno-lint-ignore no-explicit-any
    ? await client.messages.create(pedido as any)
    // deno-lint-ignore no-explicit-any
    : await client.beta.messages.create({ ...pedido, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as any);
  if (resp.stop_reason === "refusal") throw new Error("O modelo recusou ler esta imagem.");
  if (resp.stop_reason === "max_tokens") throw new Error("Resposta incompleta do modelo.");
  // deno-lint-ignore no-explicit-any
  const texto = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Resposta sem dados.");
  return JSON.parse(m[0]);
}

// Chave de servidor injetada pelo Supabase: formato novo (SUPABASE_SECRET_KEYS, JSON) ou antigo.
function chaveServidor(): string {
  try {
    const novas = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = novas.default ?? Object.values(novas)[0];
    if (typeof k === "string" && k) return k;
  } catch { /* usa a antiga */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const adminClient = () => createClient(Deno.env.get("SUPABASE_URL")!, chaveServidor(), { auth: { persistSession: false } });

async function processar(id: string, modelo: string) {
  const admin = adminClient();
  const { data: p, error } = await admin.from("processos").select("id, foto_path, diarias, nota").eq("id", id).single();
  if (error || !p) return;
  try {
    if (!p.foto_path) throw new Error("Processo sem foto.");
    const { data: arq, error: e2 } = await admin.storage.from("capas").download(p.foto_path);
    if (e2 || !arq) throw new Error("Não foi possível abrir a foto no servidor.");
    const d = await lerComClaude(new Uint8Array(await arq.arrayBuffer()), arq.type || "image/jpeg", modelo);
    if (!d.credor && d.valor == null && d.valor_liquido == null) throw new Error(d.duvida || "Não parece uma capa de processo.");
    const lido = String(d.credor || "").trim();
    let campos: string[] = Array.isArray(d.duvida_campos) ? d.duvida_campos : [];
    const upd: Record<string, unknown> = {
      leitura: "ok", leitura_erro: "",
      mes: String(d.mes || "").trim(),
      referente: String(d.referente || "").trim() || "N/D",
      duvida: String(d.duvida || "").trim(),
    };
    if (p.diarias) {
      upd.credor = "Diárias"; upd.empenho = lido;
      campos = campos.map((k) => (k === "credor" ? "empenho" : k));
    } else {
      upd.credor = lido; upd.empenho = String(d.empenho || "").trim();
    }
    upd.duvida_campos = campos;
    for (const k of CAMPOS_NUM) upd[k] = num(d[k]);
    const obs = String(d.observacao || "").trim();
    if (obs && !p.nota) upd.nota = obs;
    await admin.from("processos").update(upd).eq("id", id);
  } catch (e) {
    console.error("ler-capa", id, e);
    await admin.from("processos").update({ leitura: "erro", leitura_erro: mensagemErro(e) }).eq("id", id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);

  // Só usuários logados no app: a própria função confere o login com o servidor de autenticação.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!chaveServidor()) return json({ erro: "Chave de servidor do Supabase indisponível na função." }, 500);
  const { data: { user } } = token ? await adminClient().auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ erro: "Faça login de novo." }, 401);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ erro: "Chave da API do Claude não cadastrada no servidor." }, 500);

  let corpo: { id?: string; modelo?: string };
  try { corpo = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }
  if (!corpo.id) return json({ erro: "Falta o id do processo." }, 400);
  const modelo = MODELOS.includes(corpo.modelo ?? "") ? corpo.modelo! : "claude-opus-5-5";

  // @ts-ignore EdgeRuntime existe no Supabase
  EdgeRuntime.waitUntil(processar(corpo.id, modelo));
  return json({ ok: true }, 202);
});
