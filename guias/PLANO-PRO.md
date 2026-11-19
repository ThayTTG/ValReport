# Plano ValReport Pro: dados, análise e replay 2D para um time tier S

Objetivo: o ValReport vira a ferramenta de trabalho da equipe para **scrims, partidas oficiais e ranked**, com
dados confiáveis, análises que respondem perguntas de treino e um **replay 2D** no nível do Skybox/cs2.cam.

Princípios
1. **Dado confiável antes de gráfico bonito.** Cada número diz de onde vem e qual a amostra.
2. **Toda análise termina numa ação de treino** ("retake de B está em 22%: treinar retake B com 3").
3. **Separar contextos:** ranked, scrim e oficial não se misturam por padrão (filtro "Contexto").
4. **Tudo ligado:** partida ↔ evento da agenda ↔ comp do mapa ↔ tática ↔ round no replay.

---

## 1. De onde vêm os dados

| Fonte | O que tem | O que NÃO tem | Uso |
| :--- | :--- | :--- | :--- |
| **API das partidas (HenrikDev)**, já usada | Placar, rounds, economia de cada um por round (arma, colete, valor), abates com arma e tempo, **posição e mira dos 10 jogadores em cada abate, plant e defuse**, plant/defuse (site e lugar), dano por round, uso de habilidade (total) | Movimento contínuo, onde cada habilidade caiu, vida | Estatísticas, análises e **replay 2D estimado** (já no ar) |
| **Replay do jogo (.vrf)** | **Posição contínua de todos**, habilidades no mapa (fumaças, molotov, etc.), spike | Nomes e mira (o arquivo é anônimo; juntamos com a API pelo horário e pelos eventos) | **Replay 2D completo** de scrims e oficiais |
| **Equipe (manual)** | Tags de round no VOD, comentários, comps, táticas, adversário da scrim | — | Contexto que nenhum dado tem |

Sobre o .vrf:
- O Valorant grava os replays no PC de quem jogou (pasta Demos). Hoje dá para gravar personalizadas e baixar partidas de amigos.
- Não há API oficial. A leitura usa um projeto da comunidade ([ValorantWebReplayer](https://github.com/talhakoek/ValorantWebReplayer), MIT, com um leitor em .NET para Windows).
- **Riscos:** o formato pode mudar a cada patch, e a licença do leitor de base ainda precisa ser conferida. Por isso o .vrf é um "a mais": o replay estimado continua funcionando para tudo.

---

## 2. Scrims e partidas oficiais

**O que já funciona**
- A coleta já busca **personalizadas** e **Premier**, desde que estejam em `filas_incluidas` (o padrão é `competitive`, `premier`, `custom`) e sejam 5v5 no modo padrão.
- A personalizada aparece no histórico de cada jogador que estava nela. Basta 1 jogador da equipe na coleta.

**A fazer**
1. **Contexto de cada partida**, automático, com troca manual:
   - Personalizada no horário de um evento da agenda do tipo **Scrim** → *Scrim vs <adversário do evento>*.
   - Personalizada no horário de **Campeonato ou Partida oficial** → *Oficial* (torneios de terceiros rodam em personalizada).
   - Premier → *Oficial (Premier)*.
   - Personalizada sem evento → *Personalizada* (a liderança marca como scrim ou treino em 1 toque).
2. **Filtro "Contexto"** (Ranked · Scrim · Oficial · Todas) em todas as telas de estatística. O padrão da Equipe passa a ser *Scrim + Oficial*.
3. **Adversários**: cadastro simples (nome, tag, elo médio, região) ligado às scrims. Página do adversário com o histórico contra ele: placar por mapa e tendências (ver 3.3).
4. **Relatório pós-scrim**, gerado sozinho quando a partida chega e postado no Discord:
   - placar por mapa;
   - pistol, conversão de vantagem e retakes;
   - os 5 rounds mais importantes, com link direto para o replay;
   - quem foi o MVP.
5. **Ligar a agenda à partida:** o evento passa a mostrar o resultado e os rounds, e a partida mostra o evento e a comp planejada contra a comp que foi jogada.
6. **Partidas fora da coleta** (ex.: conta de reserva): a liderança cola o ID ou link da partida e ela entra na coleta.

---

## 3. Análises (o que um analista de time tier S olha)

### 3.1 Por mapa e lado (a "planilha do analista")
- **Rounds:** taxa de vitória no ataque e na defesa, pistol (ATQ/DEF), round seguinte ao pistol (bonus/anti-eco).
- **Economia:** vitória por tipo de compra (eco, force, half, full) contra o tipo do adversário.
- **Vantagem:** conversão de 5v4 (quem pega o primeiro abate fecha quanto?) e recuperação em 4v5.
- **Execução:** site e tempo médio do plant, plant cedo × tarde, e vitória pós-plant (o "pós-plant" fecha?).
- **Defesa:** retake por site (tentativas, sucesso) e onde o time perde o primeiro duelo.
- **Duelos:** onde acontece o primeiro contato de cada round (mapa de calor pelo tempo do round: 0–20 s, 20–40 s...).
- **Trades:** % das mortes trocadas, tempo médio da troca e quem está longe demais (já existe por jogador, falta por mapa e site).

### 3.2 Por jogador (além do que já existe)
- Desempenho por **contexto** (ranked × scrim × oficial): quem rende no oficial?
- **Primeiro duelo por posição** (callout): onde a pessoa ganha e perde a abertura.
- **Consistência** (desvio do Índice partida a partida) e **forma** (últimas 5 contra a média).
- **Metas pessoais** com acompanhamento.

### 3.3 Adversário (scouting com os dados das scrims e oficiais)
- Comps por mapa, sites que eles atacam e quando, pistol e o que compram no round seguinte, quem abre os rounds, onde ficam na defesa (posições nos primeiros 20 s).
- **Relatório de scouting** em 1 página antes de um oficial.

### 3.4 Rounds para rever (fila de VOD)
Lista automática dos rounds que mais valem VOD review:
- os que mais mudaram a chance de vitória (impacto já calculado);
- vantagens perdidas (5v4 que virou derrota);
- retakes;
- clutches.

Cada um abre direto no replay 2D, e a equipe marca como "revisado", com comentário.

---

## 4. Replay 2D

### Fase 1, no ar (todas as partidas, inclusive ranked)
- [x] Round inteiro no minimapa:
  - ícone do agente, cor do time e cone da mira;
  - nome de cada jogador;
  - rastro dos últimos 3 s;
  - X onde cada um morreu;
  - linha do abate e spike (plant e defuse).
- [x] Play/pausa, linha do tempo com marcas de abate, plant e defuse, velocidade de 0,25x a 8x, round anterior e próximo, tela cheia.
- [x] Desenho em cima: caneta, seta, círculo, borracha, 4 cores, desfazer, limpar e salvar a imagem (PNG).
- [x] Painéis dos dois times com arma, colete e valor do equipamento no round, e quem está vivo no instante.
- [x] Killfeed sincronizado: tocar num abate pula para 1,5 s antes dele.
- [x] Atalhos de teclado: espaço, ← →, `,` e `.` para trocar de round, 1 a 6 para velocidade, P A C E para as ferramentas, Ctrl+Z.
- Limite: entre os eventos o caminho é **estimado em linha reta**, e o começo do round sai do spawn. O site avisa isso na tela.

### Fase 2: replay completo com .vrf (scrims e oficiais)
1. **Envio:** botão "Enviar replay" na partida, ou atalho no PC (`Atalhos\enviar_replay.bat`), que pega o .vrf mais recente da pasta Demos.
2. **Processamento:** o leitor da comunidade roda no PC da equipe (Windows) ou num serviço à parte e gera `trilhas.json`:
   - posição a cada ~100 ms;
   - habilidades: tipo, lugar, início e fim;
   - spike.
3. **Junção com a partida:** casamos o .vrf com a partida da API pelo mapa, pelo horário e pela sequência de abates. Assim os nomes, agentes e armas voltam.
4. **No visualizador:** com `d.replay`, as trilhas substituem a estimativa, e entram as camadas de **habilidades** (fumaça, molotov, paredes) com tempo de vida.
5. Arquivos no Supabase Storage (privado da equipe); só as trilhas compactadas (~1–3 MB por partida) vão para o site.

### Fase 3: ferramentas de análise no replay
- **Sobrepor rounds:** ver vários rounds do mesmo lado e mapa ao mesmo tempo, por exemplo "todas as defesas do B" ou "todos os pistols de ataque".
- **Mapa de posições por tempo do round:** onde cada jogador costuma estar aos 15 s, 30 s e 45 s.
- **Playlists:** "rounds para rever", "retakes de A", "execuções que funcionaram", compartilháveis com a equipe.
- **Desenhos salvos e compartilhados:** a IGL desenha num round, e o desenho fica salvo junto do comentário.
- **Seguir um jogador:** visão centrada num jogador, com a linha do tempo dele.
- **Exportar** um round como vídeo curto (GIF/MP4) para o Discord.

---

## 5. Rotina de time (como usar)
| Quando | O quê | Onde |
| :--- | :--- | :--- |
| Depois de cada scrim | Relatório pós-scrim e os 5 rounds para rever | Discord → replay 2D |
| 2x por semana | VOD review dos rounds marcados, desenhando no replay | Replay 2D + comentários |
| Semanal | Planilha do analista por mapa: o que treinar | Mapas → Desempenho |
| Antes de oficial | Scouting do adversário + comps e defaults do mapa | Adversário + Mapas → Comp |
| Mensal | Map pool (votação ou pontos), metas pessoais | Map pool, perfil |

---

## 6. Ordem de execução

| # | Entrega | Por que primeiro | Tamanho |
| :--- | :--- | :--- | :--- |
| 1 | ✅ Replay 2D (fase 1) | Base de tudo, já funciona em todas as partidas | feito |
| 2 | ✅ Contexto da partida + filtro (Ranked · Scrim · Oficial) + ligar agenda ↔ partida | Sem isso, scrim e ranked se misturam | feito |
| 3 | ✅ Planilha do analista por mapa/lado (3.1) | O que mais muda o treino | feito |
| 4 | Rounds para rever + playlists no replay | Liga dado → VOD | M |
| 5 | Relatório pós-scrim no Discord | Hábito do time | P |
| 6 | Replay .vrf (fase 2): atalho do PC + junção | Movimento real e habilidades | G |
| 7 | Adversários e scouting (3.3) | Preparação de oficial | M |
| 8 | Ferramentas da fase 3 (sobrepor rounds, posições por tempo) | Nível analista profissional | G |

P = poucos dias, M = cerca de uma semana, G = mais de uma semana.

---

## 7. Riscos e cuidados
- **Formato do .vrf** muda com patches: o leitor é da comunidade e pode quebrar. Mitigação: o replay estimado sempre funciona; o .vrf é a camada extra.
- **Termos da Riot:** só lemos arquivos que o próprio jogo grava no PC de quem jogou, sem mexer no cliente nem no jogo. Mesmo assim, conferir a política da Riot antes de divulgar fora da equipe.
- **Privacidade:** replays e partidas continuam privados da equipe (Supabase com RLS). Adversários aparecem como "Adversário N" fora das scrims cadastradas.
- **Amostra:** as análises mostram o tamanho da amostra e só dão veredito a partir de um mínimo de rounds.
