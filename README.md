# ValReport · by NokyLabs

Report diário e site de estatísticas da nossa equipe de VALORANT, com partidas, agentes, mapas, armas, performance, formações e sinergia, no estilo dos trackers e com uma camada de análise tática própria.

> **Projeto de fã, sem fins lucrativos.** ValReport was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

**Site:** publicado pelo GitHub Pages a partir da pasta [`docs/`](docs/). O link aparece em *Settings → Pages* depois de ativar (veja [PUBLICAR.md](PUBLICAR.md)).

---

## O que tem aqui

| Parte | O que faz |
| :--- | :--- |
| **Report diário** (`coletor_valorant.py`, `gerar_report.py`) | Às 21h, busca as partidas da equipe, calcula as estatísticas e escreve relatórios em Markdown, organizados por formação (Toda Equipe, Solo, Duo...). |
| **Cards e Discord** (`cards.py`, `mapa_calor.py`, `discord_envio.py`) | Desenha cards em imagem (tema escuro, vertical) e manda tudo para os canais da equipe por webhook. |
| **Site** (`exportar_site.py` + `docs/`) | Exporta os dados para JSON e publica um site estático, mobile-first, com tema claro e escuro. |

### Abas do site

- **Por jogador:** Geral · Partidas · Agentes · Mapas · Armas · Performance (com evolução de elo e recordes pessoais) · Mapa de calor (filtra por tipo de round)
- **Equipe:** Visão geral (com ranking) · Semana (MVP, comparação com a semana anterior, rounds para rever) · Partidas · Formações · Sinergia · Comparar · Mapas (com o plano da IGL) · Recordes
- **Por partida:** Placar · Rounds (killfeed, economia e leitura de cada round) · Mapa 2D · Leitura da equipe · Notas da IGL
- **Filtros:** fila, temporada, período, mapa, agente e "com quem" (sem a equipe, com a equipe, com uma pessoa específica)

### O que é diferente de um tracker comum

- **Impacto por round:** quanto cada ação mudou a chance do time vencer o round, a partir de um modelo de chance de vitória.
- **Índice NokyLabs (0–100) por função:** 50 é a média da mesma função **nos lobbies de vocês**, com margem de confiança e veredito só a partir de 100 rounds.
- **Trades e posicionamento:** distância até o aliado mais próximo em cada morte, mortes trocadas e jogadas solo.
- **Formações e sinergia:** sozinho × juntos, quem vinga quem e a taxa de vitória de cada dupla.
- **Régua “vs elo”:** o mesmo índice comparado só com quem joga a mesma função na mesma faixa de elo.
- **Notas da IGL:** a IGL escreve o plano de cada mapa e a leitura de partidas e rounds num editor local, e as notas aparecem no site.
- **App instalável:** o site funciona como app no celular (PWA), com ícone e leitura sem internet, e tem prévia bonita quando o link é compartilhado.

A metodologia completa está na página **Sobre** do site e em [`avaliacao.py`](avaliacao.py).

---

## Como funciona

```
PC da equipe (21h)                                   GitHub
──────────────────                                   ──────
coletor_valorant.py ──► HenrikDev API (não oficial)
        │
        ▼
dados/partidas/  (fica só no PC, nunca vai para o GitHub)
        │
        ├──► gerar_report.py ──► relatórios .md + cards ──► Discord (webhooks)
        │
        └──► exportar_site.py ──► docs/data/*.json ──(git push)──► GitHub Pages ──► site
```

O site **não chama nenhuma API**. Ele só lê os JSON gerados no PC, por isso não precisa de servidor, chave nem login.

## Privacidade e consentimento

- Pelo nome, aparecem **só os jogadores da equipe que autorizaram** (`site.jogadores_autorizados` no `config.json`). Por padrão, só a primeira pessoa da lista.
- **Todo o resto é anônimo** ("Aliado 2", "Adversário 4"), sem nome, Riot ID, card ou nível. A HenrikDev API pede consentimento de quem tem os dados exibidos e proíbe revelar nomes ocultos.
- A chave da API e os webhooks ficam em variáveis de ambiente do Windows e **nunca** entram no repositório (`config.json` e `dados/` estão no `.gitignore`).
- O site não tem cookies, analytics nem anúncios.

> ⚠️ **Chave da API para site público:** pelas regras da HenrikDev, a chave *Basic* é indicada para uso privado e educacional. Para **sites públicos**, eles indicam a chave *Advanced*, que se pede pelo Discord da HenrikDev, com resposta em 1–2 semanas. Antes de divulgar o site, peça essa chave.

## Instalação (Windows)

1. **Python 3.11+** ([python.org](https://www.python.org)). Marque "Add to PATH".
2. **Chave da HenrikDev API:** gere no [dashboard](https://api.henrikdev.xyz/dashboard/) e guarde com `setx HENRIKDEV_API_KEY "sua-chave"`.
3. Copie `config.exemplo.json` para `config.json` e preencha os jogadores.
4. Rode `rodar_report.bat` uma vez para testar. Ele instala o Pillow sozinho se faltar.
5. Para agendar às 21h, rode `instalar_agendamento.ps1` no PowerShell.
6. **Discord (opcional):** crie webhooks e guarde nas variáveis `DISCORD_WEBHOOK_EQUIPE`, `..._JOGADORES`, `..._FORMACOES` e `..._DICAS` (veja o [LEIA-ME.md](LEIA-ME.md)).
7. **Site:** siga o [PUBLICAR.md](PUBLICAR.md).

Para ver o site no próprio PC antes de publicar: `py -m http.server 8000 -d docs` e abra http://localhost:8000.

## Estrutura

```
├── coletor_valorant.py      busca partidas (HenrikDev API) e chama o resto
├── avaliacao.py             modelo de chance de vitória, impacto, índice por função, trades
├── armazem.py               guarda partidas e o modelo em dados/
├── gerar_report.py          relatórios .md por formação
├── cards.py, mapa_calor.py  cards em imagem (Pillow)
├── discord_envio.py         envio por webhook
├── exportar_site.py         JSON do site + publicação (git)
├── notas_igl.py             editor local das Notas da IGL (abre com editar_notas.bat)
├── docs/                    o site (HTML, CSS, JS, fontes) + docs/data (gerado)
├── fontes/                  Inter (SIL OFL 1.1) para os cards
├── config.exemplo.json      modelo do config.json (o real fica fora do Git)
├── notas/                   rascunho das notas da IGL, só no PC (fora do Git)
└── dados/                   partidas, cache, histórico de elo, reports e logs, só no PC (fora do Git)
```

## Créditos

Tudo o que usamos está em [CREDITOS.md](CREDITOS.md) e na página **Sobre** do site. Destaques: [HenrikDev Unofficial VALORANT API](https://github.com/Henrik-3/unofficial-valorant-api) (dados), [valorant-api.com](https://valorant-api.com) (imagens e dados dos mapas), Riot Games (o jogo e seus assets) e [Inter](https://rsms.me/inter/) (fonte, SIL OFL 1.1). O código foi escrito com ajuda do Claude (Anthropic).

## Licença

O **código** deste repositório está sob a licença [MIT](LICENSE). A fonte Inter segue a [SIL Open Font License 1.1](fontes/OFL.txt). Nomes, imagens e marcas do VALORANT pertencem à Riot Games e **não** estão cobertos pela licença MIT.
