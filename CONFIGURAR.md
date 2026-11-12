# Configurar o servidor (Supabase)

Faça uma vez. Os nomes dos menus podem variar um pouco no painel do Supabase.

## 1. Criar o projeto
1. Entre em https://supabase.com e crie uma conta.
2. **New project** → escolha um nome (ex.: `capas-pagamento`), uma senha para o banco (guarde-a) e a região **South America (São Paulo)**.

## 2. Fechar o cadastro público
**Authentication → Sign In / Providers → Email**: desligue **Allow new users to sign up**. Assim só entra quem você cadastrar.

## 3. Criar o banco
**SQL Editor → New query** → cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
Deve aparecer "Success". Pode rodar de novo sem perder dados.

## 4. Publicar a função que lê as capas
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nome: `ler-capa` (exatamente assim).
3. Apague o exemplo, cole todo o conteúdo de [`supabase/functions/ler-capa/index.ts`](supabase/functions/ler-capa/index.ts) → **Deploy**.
4. Deixe ligada a opção de exigir login (**Verify JWT**).

## 5. Cadastrar a chave do Claude
**Edge Functions → Secrets → Add new secret**:
- Name: `ANTHROPIC_API_KEY`
- Value: sua chave (console.anthropic.com → API Keys)

Dica: no console da Anthropic, defina um limite de gasto mensal.

## 6. Ligar o app ao projeto
**Project Settings → API** (ou **Data API**): copie
- **Project URL** (ex.: `https://abcd1234.supabase.co`)
- a chave **anon public**

e coloque em [`config.js`](config.js). A chave *anon* é pública por natureza; **nunca** use a chave *service_role* no app.

## 7. Cadastrar a equipe
**Authentication → Users → Add user → Create new user**: e-mail e senha de cada pessoa, com **Auto Confirm User** marcado.
Para trocar a senha de alguém, faça pelo mesmo menu.

Pronto: cada pessoa abre o app, entra com e-mail e senha e, em **Ajustes**, coloca o próprio nome.
