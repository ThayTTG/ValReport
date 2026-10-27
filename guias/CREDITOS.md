# Créditos e transparência

Tudo o que o ValReport usa até aqui, o que cada coisa faz no projeto e sob qual licença. A mesma lista aparece na página **Sobre** do site.

## Dados e imagens

| Projeto | O que usamos | Licença / regras |
| :--- | :--- | :--- |
| [HenrikDev · Unofficial VALORANT API](https://github.com/Henrik-3/unofficial-valorant-api) | Histórico e detalhes das partidas (v4): placar, rounds, abates com posição, economia. Histórico de elo (mmr-history) para o gráfico de RR. | API não oficial, sem vínculo com a Riot. Regras do projeto: consentimento dos jogadores; proibidos "grandes projetos de análise", checadores de loja e revelar nomes ocultos. O autor pede crédito e uma estrela no repositório. |
| [valorant-api.com](https://valorant-api.com) | Ícones de agentes, habilidades, armas e elos, cards de jogador, imagens e minimapas dos mapas (inclusive no mapa tático das Táticas), coordenadas para projetar posições e nomes de regiões (callouts). | Projeto da comunidade, não oficial. As imagens pertencem à Riot Games. |
| [Riot Games](https://www.riotgames.com/en/legal) | O jogo VALORANT e todos os seus assets. | Uso sob a política "Legal Jibber Jabber" para projetos de fãs, sem fins lucrativos e sem usar logos da Riot. |

## Código e ferramentas

| Projeto | Para quê | Licença |
| :--- | :--- | :--- |
| [Python](https://www.python.org) | Coletor, análise, cards e exportação | PSF License |
| [Pillow](https://python-pillow.org) | Desenho dos cards (PNG) do Discord | MIT-CMU (HPND), Jeffrey A. Clark e colaboradores |
| [Inter](https://rsms.me/inter/), de Rasmus Andersson | Fonte do site e dos cards | SIL Open Font License 1.1 ([texto](fontes/OFL.txt)) |
| [fontTools](https://github.com/fonttools/fonttools) | Recorte e conversão da Inter para WOFF (uma vez) | MIT |
| [Discord](https://discord.com) (webhooks) | Entrega dos reports | Serviço da Discord Inc. |
| [GitHub](https://github.com) | Código do site | Serviço da GitHub Inc. |
| [Vercel](https://vercel.com) | Hospedagem do site | Serviço da Vercel Inc. |
| [Supabase](https://supabase.com) | Login, banco de dados, imagens das equipes e arquivos das Táticas (espaço privado) | Serviço da Supabase Inc. |
| [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 | Transforma, no navegador, cada página de um PDF das Táticas numa imagem. Fica em `docs/assets/vendor/pdfjs/` com a licença junto | Apache 2.0 (Mozilla) |
| [Playwright](https://playwright.dev) | Testes do site em celular e computador; também gerou a imagem de prévia (`og.png`) e os ícones do app | Apache 2.0 (Microsoft) |
| Agendador de Tarefas e PowerShell | Report diário às 21h | Componentes do Windows (Microsoft) |
| [Claude](https://www.anthropic.com/claude) (Anthropic) | Assistente de IA usado para escrever e revisar o código, a metodologia e os textos, a partir das ideias e decisões da NokyLabs | Ferramenta de desenvolvimento |

## Referências e ferramentas de terceiros (sem integração)

| Projeto | Relação com o ValReport |
| :--- | :--- |
| [Tracker Network (tracker.gg)](https://tracker.gg/valorant) | Inspiração para organizar as abas (Geral, Partidas, Agentes, Mapas, Armas, Performance). Nenhum dado, código ou imagem do tracker.gg é usado, e não temos relação com eles. |
| [OP.GG](https://op.gg) (app de desktop) | O replay 2D foi usado pela equipe para conferir rounds na validação com VOD. Não está integrado. |
| [YouTube](https://www.youtube.com) | As dicas dos reports levam para buscas e vídeos (ou para o canal de um coach, se configurado). Só links. |

## Aviso legal

**ValReport was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.**

O ValReport foi criado sob a política "Legal Jibber Jabber" da Riot Games, usando assets da Riot Games. A Riot Games não endossa nem patrocina este projeto. VALORANT e todas as propriedades associadas são marcas registradas da Riot Games, Inc.

A HenrikDev API não é endossada pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém oficialmente envolvido na produção ou gestão das propriedades da Riot Games.
