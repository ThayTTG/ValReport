# 🎮 Report Diário de VALORANT — NokyLabs (versão 2)


## Onde fica cada coisa

- **`Atalhos\`**: os botões de dois cliques (report, atualizar agora, publicar o site, notas da IGL e o instalador do agendamento).
- **`ferramentas\`**: o código Python. Para rodar algo na mão, abra o PowerShell na pasta principal e use `py ferramentas\nome.py`.
- **`guias\`**: este LEIA-ME, o PUBLICAR e os CREDITOS.
- **`docs\`**: o site. **`dados\`** e **`notas\`**: só no seu PC. **`config.json`**: na pasta principal.

Coleta as partidas da equipe pela HenrikDev API e gera, todo dia às 21h, reports em `.md`
com análise tática por partida, avaliação justa por função e análise de duos/trios/five stack.

## Arquivos

| Arquivo | Para que serve |
| :--- | :--- |
| `ferramentas\coletor_valorant.py` | Busca as partidas novas, guarda e chama o gerador |
| `ferramentas\avaliacao.py` | O "cérebro": chance de vitória, impacto, trades, distâncias, avaliação por função |
| `ferramentas\armazem.py` | Guarda as partidas compactadas e o modelo de chance de vitória |
| `ferramentas\gerar_report.py` | Escreve os reports (`py ferramentas\gerar_report.py 2026-10-23` refaz um dia) |
| `config.json` | Jogadores, apelidos, filas e ajustes finos |
| `Atalhos\rodar_report.bat` | Roda tudo com dois cliques |
| `Atalhos\instalar_agendamento.ps1` | Agenda o report diário às 21h e a atualização do site a cada 20 min |
| `Atalhos\atualizar_agora.bat` | Procura partidas novas agora e atualiza o site (sem report nem Discord) |

## Atualizando da versão 1

1. Substitua os arquivos `.py` e o `config.json` pelos novos. **Não apague a pasta `dados`.**
2. Rode o `Atalhos\rodar_report.bat`. Na primeira vez ele faz uma migração automática:
   - compacta as partidas guardadas (ficam ~10x menores);
   - refaz o `historico.csv` com as correções (o antigo fica em `historico_v1.csv`);
   - busca de novo as partidas que tinham sido ignoradas — inclusive as **personalizadas (scrims)**,
     que antes ficavam de fora por engano.

## Onde ficam os resultados (`dados\reports\AAAA-MM-DD\`)

* `00_resumo_do_dia.md` → números do dia, avaliação resumida, rounds de destaque e a observar
* `00_avaliacao_14_dias.md` → avaliação justa por função de cada jogador
* `00_resumo_dos_grupos.md` → duos, trios e five stack
* `00_validacao_vod.md` → rounds da semana para você conferir no replay (as respostas vão na planilha
  `dados\validacao\validacao_AAAA-Sxx.csv`)
* `01_NokyTTG_Corrode_Omen_23h36.md` (etc.) → relatório tático de cada partida

Rodar mais de uma vez no mesmo dia não apaga nada: as execuções do dia se somam.

## Como a avaliação funciona

### Impacto (chance de vitória)
Em cada momento do round a ferramenta calcula a chance de o ataque vencer, considerando quantos
estão vivos de cada lado, se a spike foi plantada e a diferença de equipamento. A tabela começa
com valores de referência e vai aprendendo com as partidas de vocês.

* Cada abate vale **o quanto mudou a chance de vitória** (abrir um 5v5 vale muito; matar o último
  com o round ganho vale quase nada; clutch é valorizado naturalmente).
* Quem morre perde essa variação — **metade**, se a morte foi trocada pelo time.
* Assistências dividem 25% do valor do abate; plant e defuse também contam.
* No report, `+16%` num round = suas ações aumentaram em 16 pontos a chance do time vencer aquele
  round. O total da partida equivale a quantos rounds as suas ações "geraram".

### Avaliação justa por função
* **Índice 0–100**, em que **50 = média da sua função nos seus próprios lobbies** (já ajusta pelo elo).
* O impacto é o que mais pesa; depois as métricas típicas da função (first kills para duelista,
  assistências/utilitário para iniciador, KAST/sobrevivência para controlador e sentinela).
* Usa os **últimos 14 dias**, mostra uma **margem** e só dá veredito com **100+ rounds** na função.

### Trade, jogadas solo e clutch
* A API registra onde os 10 jogadores estavam em cada abate. **Até 15 m** de um aliado = em alcance
  de trade; **mais de 30 m** = jogada solo/isolada. (Medido nos jogos de vocês: nas mortes trocadas,
  o aliado mais próximo estava a ~8,5 m; nas não trocadas, a ~17,5 m.)
* Clutches são comparados com o que seria normal vencer naquelas situações.

### Uso do kit (habilidades)
* Habilidades por round comparadas com a média da função nos seus lobbies, ultimates por partida,
  assistências a cada 10 habilidades (mostra se a skill está gerando abates para o time) e abates
  feitos com habilidade.
* Limite da API: ela só informa o **total** de habilidades da partida — não quando nem onde cada uma
  foi usada. Mapa de calor de skills e "abates antes/depois da skill" dependem do arquivo de replay.

### Duos e trios
* **Isolado × juntos** nos últimos 14 dias, comparando só nas funções que cada um jogou com o grupo.
* **Quem troca quem** e a **distância entre vocês** quando alguém do grupo morre.
* Veredito "rende mais/menos junto" só com 3+ partidas em cada lado.

## Ajustes no `config.json`

| Chave | O que faz | Padrão |
| :--- | :--- | :--- |
| `jogadores` / `apelidos` | Quem entra no report e como aparece | — |
| `filas_incluidas` | Filas analisadas. `custom` = personalizada (scrims). Para Sem Classificação, adicione `"unrated"` | competitive, premier, custom |
| `janela_dias` | Período da avaliação justa | 14 |
| `janela_referencia_dias` | Período usado para calcular a média de cada função nos lobbies | 60 |
| `amostra_minima_rounds` | Rounds mínimos na função para dar veredito | 100 |
| `min_partidas_grupo` | Partidas mínimas (isolado e juntos) para o veredito do grupo | 3 |
| `destaque_impacto_pct` / `observar_impacto_pct` | Impacto mínimo/máximo de um round para aparecer no resumo do dia | 35 / -20 |
| `max_rounds_no_resumo` | Quantos rounds de cada tipo aparecem por jogador no resumo | 5 |
| `distancia_trade` / `distancia_isolado` | Em unidades do jogo (100 = 1 m) | 1500 / 3000 |
| `peso_morte_trocada` / `peso_assistencia` | Quanto pesa uma morte trocada / a parte da assistência | 0.5 / 0.25 |
| `funcoes_extras` | Agente novo ainda não cadastrado, ex.: `{"NovoAgente": "Duelista"}` | — |

## Correções desta versão
* Rounds de rendição (Surrendered) eram contados como rounds jogados — distorciam ADR e KAST.
* O dano por round não estava sendo lido (dica "sem impacto de dano" aparecia por engano).
* Rounds AFK/desconectado agora ficam fora da avaliação e aparecem como aviso.
* A API às vezes duplica o dano de quem reconecta; agora é ajustado pelo total oficial.
* Partidas personalizadas (Custom Game) eram ignoradas.

## 🎬 Validação com VOD (uns 10 minutos por semana)
1. Abra `dados\validacao\validacao_AAAA-Sxx.csv` no Excel (uma planilha por semana).
2. Ela traz, para cada jogador, os 3 rounds mais bem e os 3 mais mal avaliados dos últimos 7 dias.
3. Assista no replay e escreva na coluna `sua_avaliacao`: **sim** (concordo), **não** ou **parcial**.
4. Salve. Na próxima execução, a avaliação de 14 dias mostra a % de concordância por tipo de leitura.
   Leituras com 3+ conferências e menos de 50% de concordância são as regras a calibrar.

As respostas nunca se perdem: o script atualiza a planilha da semana sem apagar o que você escreveu.

## 📺 Vídeos personalizados (seção `videos` do `config.json`)
A ordem de escolha do link é: **link fixo** → **canal do coach** → **wiki** → busca geral no YouTube.

```json
"videos": {
  "canal_youtube": "@CanalDoCoach",
  "wiki_busca": "",
  "nome_da_fonte": "canal do coach",
  "links_fixos": [
    {"tema": "lineup", "agente": "Omen", "mapa": "Corrode", "url": "https://...", "titulo": "Lineups do coach: Omen no Corrode"},
    {"tema": "isolada", "url": "https://...", "titulo": "Aula de trade do coach"}
  ]
}
```

* `canal_youtube`: as buscas acontecem **dentro do canal** (ex.: `@CanalDoCoach`).
* `wiki_busca`: endereço de busca de uma wiki/site, com `{busca}` no lugar do termo
  (ex.: `https://site.com/search?q={busca}`). Só é usado se não houver canal.
* `nome_da_fonte`: aparece ao lado do link, ex.: "▶️ Assistir (canal do coach)".
* `links_fixos`: um vídeo específico para um tema. `agente` e `mapa` são opcionais; o link mais
  específico vence (tema + agente + mapa > tema + agente > tema + mapa > só tema).

**Temas disponíveis:** `lineup` (pixel de skill), `pixel` (posições), `mira` (abertura de mira),
`first_death` (primeiro duelo), `isolada` (trade/posicionamento), `anti_eco`, `clutch`, `save`,
`solo` (lurk), `utilitario` (uso do kit), `funcao` (como jogar a função).

---

## Cards e pastas (novo)

Cada dia gera, em `dados\reports\AAAA-MM-DD\`, uma pasta por formação:

- **Toda Equipe** — resumo do dia, avaliação de 14 dias, validação do VOD, resumo dos grupos e `cards\` (equipe, economia, mapas)
- **Solo - Nome** — relatórios das partidas e `cards\` (resumo_solo, agente, dicas + `dicas.md` com os links dos vídeos)
- **Duo - A e B**, **Trio - ...**, **Quad - ...** — análise da formação + `cards\formacao.png`
- Cards extras: `calor.png` (mapa de calor de cada jogador, no mapa que mais jogou no dia), `calor_equipe.png`
  (mapa mais jogado pela equipe no dia) e `five_stack.png` (quando os 5 jogarem juntos)

### Mapa de calor
- Usa as posições de cada abate que a API já traz (sem replay). Calor = onde as mortes se repetem; pontos brancos = mortes;
  verdes = de onde saiu o abate. Janela: últimos 14 dias no mesmo mapa.
- Minimapa e nomes das regiões (A Main, B Site...) vêm da valorant-api.com e ficam em `dados\cache\mapas\`
  (baixados na primeira execução e atualizados a cada 14 dias). Sem internet, o mapa é redesenhado pelas posições.
- Mortes na própria spike não entram (igual ao placar oficial).

Os cards são desenhados pelo `ferramentas\cards.py` (Pillow, fonte Inter da pasta `fontes`), direto no seu PC. Não usam IA nem API de imagem.

## Discord (novo)

1. No Discord, crie os canais: `#equipe`, `#jogadores`, `#formacoes` e `#dicas`.
   (#equipe: equipe, economia, mapas e calor da equipe · #jogadores: resumo, agente e calor de cada um ·
   #formacoes: um card por duo/trio/quad/five · #dicas: dicas com os links dos vídeos)
2. Em cada canal: ⚙️ Editar canal → Integrações → Webhooks → Novo webhook → **Copiar URL do webhook**.
3. Guarde cada URL numa variável de ambiente do Windows (PowerShell, uma linha por canal, trocando pelo link copiado):
   ```
   setx DISCORD_WEBHOOK_EQUIPE "https://discord.com/api/webhooks/..."
   setx DISCORD_WEBHOOK_JOGADORES "https://discord.com/api/webhooks/..."
   setx DISCORD_WEBHOOK_FORMACOES "https://discord.com/api/webhooks/..."
   setx DISCORD_WEBHOOK_DICAS "https://discord.com/api/webhooks/..."
   ```
   Feche e abra o terminal depois (e reinicie o agendamento, se já estiver criado). Canal sem webhook é pulado.
4. Teste: `py ferramentas\discord_envio.py --teste` — cada canal recebe uma mensagem de teste.
5. Pronto: o `Atalhos\rodar_report.bat` envia sozinho depois de gerar o report. Cada dia é enviado uma vez; para reenviar: `py ferramentas\discord_envio.py 2026-10-23 --forcar`.

> A URL do webhook é como uma senha: quem tiver o link consegue postar no canal. Não compartilhe nem cole em prints.
> Para trocar nome/foto do remetente, use `"discord": {"nome": "NokyLabs", "avatar_url": "https://..."}` no `config.json`.

---

## Site (ValReport)

Depois do report e do Discord, o `ferramentas\exportar_site.py` gera os dados do site em `dados\site\` e envia para o Supabase (só a equipe vê). O site fica em https://valreport.vercel.app.

- **Quem aparece:** quem joga na equipe do site (líder, co-líderes e jogadores com o Riot ID verificado) e quem está em `"site" → "jogadores_autorizados"` no `config.json`. Todo o resto vira "Aliado/Adversário", sem nome.
- **Elenco pelo site (etapa 3b):** o report, a coleta e o Discord usam os membros da equipe no site. Quem está no `config.json` e ainda não entrou no site continua. O apelido do `config.json` continua valendo; quem não tem usa o do site. Cada pessoa do site é achada pelo puuid, então trocar de nick não quebra o histórico. Para desligar: `"site": {"elenco_do_site": false}`.
- **Ver no PC:** `py -m http.server 8000 -d docs` e abra http://localhost:8000.
- **Publicar:** siga o `guias\PUBLICAR.md` uma vez. Depois disso, `Atalhos\publicar_site.bat` publica com dois cliques, ou ponha `"publicar_automatico": true` para publicar sozinho.
- **Atualização a cada 20 min:** o `Atalhos\instalar_agendamento.ps1` cria também a tarefa "NokyLabs - Atualizar site VALORANT", que roda escondida e só publica quando acha partida nova. O que ela achar fica em `dados/pendentes.json` e entra no report das 21h normalmente. Para pausar, use `"coleta_rapida": false` no `config.json`. O site também confere sozinho a cada 20 min e tem o botão de atualizar no topo.
- **Créditos e transparência:** `CREDITOS.md` e a página Sobre do site.
- **Notas da IGL:** dois cliques em `Atalhos\editar_notas.bat`. Abre o site no seu PC com campos para escrever: na partida (aba *Notas da IGL* e no *Placar*), em cada round (aba *Rounds*) e no plano de cada mapa (*Equipe → Mapas*). Salve com o botão ou Ctrl+Enter. As notas vão para o site na próxima publicação. Os convidados não veem as notas; mesmo assim, não cite pelo nome quem é de fora da equipe. Para não publicar notas: `"site": {"publicar_notas": false}`.
- **Elo:** o coletor guarda o histórico de RR de cada jogador em `dados\elo\` (gráfico na aba *Performance*). Para desligar: `"coletar_elo": false`.
- **Resumo da semana:** aos domingos, o card `semana.png` (MVP, cada um contra a semana anterior e rounds para rever) vai junto da mensagem da equipe no Discord. No site, fica na aba *Equipe → Semana*.
- **Prévia do link e app:** ao compartilhar o link, aparece a imagem `docs\assets\img\og.png`. Se o endereço do site mudar, ponha `"url_publica"` em `"site"`. No celular, o site pode ser instalado como app.
