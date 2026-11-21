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
4. Em **Details/Settings** da função, **desligue "Verify JWT"** (ou "Enforce JWT verification"). A própria função confere o login de quem chama; a verificação antiga do Supabase não aceita as chaves novas e faria a leitura falhar.

## 5. Cadastrar a chave do Claude
**Edge Functions → Secrets → Add new secret**:
- Name: `ANTHROPIC_API_KEY`
- Value: sua chave (console.anthropic.com → API Keys)

Dica: no console da Anthropic, defina um limite de gasto mensal.

## 6. Ligar o app ao projeto
**Project Settings → API** (ou **Data API**): copie
- **Project URL** (ex.: `https://abcd1234.supabase.co`)
- a chave **anon public**

e coloque em [`config.js`](config.js). Nos projetos novos, use a **publishable key** (`sb_publishable_...`) no lugar da *anon*.
A chave *anon*/*publishable* é pública por natureza; **nunca** coloque a *service_role* nem a *secret key* (`sb_secret_...`) no app nem a envie a ninguém: a função do servidor já recebe a dela automaticamente.

## 7. Cadastrar a equipe
**Authentication → Users → Add user → Create new user**: e-mail e senha de cada pessoa, com **Auto Confirm User** marcado.
Para trocar a senha de alguém, faça pelo mesmo menu.

## 8. Definir os setores
A conta mais antiga do projeto (quem criou o Supabase) vira **administrador** automaticamente.
No app, o administrador abre **Ajustes → Equipe** e escolhe o setor de cada pessoa: **Compras** ou **Controle Interno**.
Sem setor, a pessoa só visualiza.

Pronto: cada pessoa abre o app, entra com e-mail e senha e, em **Ajustes**, coloca o próprio nome.

## Atualizações do banco
Quando uma versão nova do app trouxer mudanças em `supabase/schema.sql`, cole o arquivo inteiro de novo no
**SQL Editor** e clique em **Run** *antes* de publicar o app. Ele só acrescenta o que falta e converte os dados.
