# Publicar o ValReport (Vercel + Supabase)

O ValReport 2.0 tem três partes. O **código do site** fica no GitHub ([ThayTTG/ValReport](https://github.com/ThayTTG/ValReport)) e a **Vercel** publica a pasta `docs` em https://valreport.vercel.app. Os **dados das partidas** vão do seu PC direto para o **Supabase**, e só a equipe vê. As partidas nunca vão para o GitHub.

## Todo dia (já automático)

- O report das 21h e a coleta de 20 em 20 minutos exportam os dados e enviam para o Supabase. Para isso, o PC precisa da variável `SUPABASE_SECRET_KEY` (guia da etapa 1).
- **Quem aparece:** quem joga na equipe do site (líder, co-líderes e jogadores com o Riot ID verificado), mais quem está em `"jogadores"` no `config.json` e ainda não entrou no site. Quem é de fora da lista aparece como "Aliado" ou "Adversário", sem nome.
- **Equipe Premier:** a coleta das 21h confere o elenco no jogo uma vez por dia.

## Quando o código muda (atualizações do site)

Dois cliques em `Atalhos\publicar_site.bat`. Ele exporta, envia os dados ao Supabase e publica o código no GitHub. Em 1 a 2 minutos a Vercel atualiza o site. `config.json`, `dados\` e `notas\` nunca vão para o GitHub (`.gitignore`).

## Dicas

- **Ver no PC antes de publicar:** `py -m http.server 8000 -d docs` e abra http://localhost:8000 (o login só funciona no endereço da Vercel).
- **Algo não apareceu?** Rode `py ferramentas\exportar_site.py --verificar` e leia as mensagens que começam com "Site:" e "Elenco:".
- **Elenco só do config.json (sem o site):** `"site": {"elenco_do_site": false}` no `config.json`.
- **Histórico antigo:** as partidas que já estiveram no GitHub foram apagadas do histórico em 26/10/2026. O backup ficou em `Downloads\ValReport-backup-2026-10-26_1938.bundle` e pode ser apagado quando quiser.
