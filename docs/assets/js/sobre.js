// Sobre: transparência, privacidade, metodologia, limitações, créditos e aviso legal

import { esc, num, dataHora, icone } from "./util.js";
import { B } from "./dados.js";

const link = (url, texto) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(texto)} ${icone("externo")}</a>`;

const CREDITOS = [
  { nome: "HenrikDev · Unofficial VALORANT API", papel: "Fonte dos dados", texto: "Histórico e detalhes das partidas (placar, rounds, abates com posição, economia) e histórico de elo. É uma API não oficial, mantida pela comunidade, sem vínculo com a Riot Games. O autor pede crédito e uma estrela no projeto, então fica aqui o nosso obrigado.", licenca: "Uso conforme as regras do projeto (consentimento dos jogadores, sem “grandes projetos de análise”).", url: "https://github.com/Henrik-3/unofficial-valorant-api", rotulo: "github.com/Henrik-3" },
  { nome: "valorant-api.com", papel: "Imagens e dados dos mapas", texto: "Ícones de agentes, armas e elos, cards de jogador, imagens dos mapas, minimapas, coordenadas para projetar posições e nomes das regiões (callouts). Projeto da comunidade, não oficial.", licenca: "As imagens pertencem à Riot Games; são carregadas direto do servidor deles.", url: "https://valorant-api.com", rotulo: "valorant-api.com" },
  { nome: "Riot Games", papel: "VALORANT e seus assets", texto: "O jogo, os nomes e todas as imagens de agentes, mapas, armas e elos pertencem à Riot Games. Usamos sob a política “Legal Jibber Jabber” para projetos de fãs, sem fins lucrativos e sem usar logos da Riot.", licenca: "Riot Games não endossa nem patrocina este projeto.", url: "https://www.riotgames.com/en/legal", rotulo: "Política da Riot" },
  { nome: "Inter", papel: "Fonte", texto: "A fonte de todo o site e dos cards do Discord, criada por Rasmus Andersson. Os arquivos do site são um recorte (subset) convertido para WOFF, sem alterar o desenho das letras.", licenca: "SIL Open Font License 1.1 (licença inclusa no repositório).", url: "https://rsms.me/inter/", rotulo: "rsms.me/inter" },
  { nome: "Python", papel: "Coletor, análise e exportação", texto: "Linguagem dos scripts que buscam as partidas, calculam as estatísticas, desenham os cards e exportam os dados do site.", licenca: "PSF License.", url: "https://www.python.org", rotulo: "python.org" },
  { nome: "Pillow", papel: "Cards em imagem", texto: "Biblioteca usada para desenhar os cards (PNG) enviados ao Discord.", licenca: "Licença HPND (MIT-CMU). Jeffrey A. Clark e colaboradores.", url: "https://python-pillow.org", rotulo: "python-pillow.org" },
  { nome: "fontTools", papel: "Conversão da fonte", texto: "Usado uma vez para recortar e converter a fonte Inter para WOFF, deixando o site leve no celular.", licenca: "MIT.", url: "https://github.com/fonttools/fonttools", rotulo: "github.com/fonttools" },
  { nome: "Discord (webhooks)", papel: "Entrega dos reports", texto: "Os reports diários e os cards chegam aos canais da equipe por webhooks.", licenca: "Serviço da Discord Inc.", url: "https://discord.com", rotulo: "discord.com" },
  { nome: "GitHub e GitHub Pages", papel: "Código e hospedagem", texto: "O código fica aberto no GitHub e o site é servido de graça pelo GitHub Pages, como arquivos estáticos.", licenca: "Serviço da GitHub Inc.", url: "https://pages.github.com", rotulo: "pages.github.com" },
  { nome: "Playwright", papel: "Testes", texto: "Usado para abrir o site como celular e como computador e conferir telas, links e erros antes de publicar. Também gerou a imagem de prévia do link e os ícones do app.", licenca: "Apache 2.0 (Microsoft).", url: "https://playwright.dev", rotulo: "playwright.dev" },
  { nome: "Agendador de Tarefas e PowerShell", papel: "Report diário", texto: "Fazem o report rodar sozinho às 21h no PC da equipe.", licenca: "Componentes do Windows (Microsoft).", url: "https://learn.microsoft.com/powershell/", rotulo: "Documentação" },
  { nome: "Tracker Network (tracker.gg)", papel: "Inspiração", texto: "A organização das abas (Geral, Partidas, Agentes, Mapas, Armas, Performance) foi inspirada nos trackers que a comunidade já conhece. Nenhum dado, código ou imagem do tracker.gg é usado, e não temos relação com eles.", licenca: "Só referência visual.", url: "https://tracker.gg/valorant", rotulo: "tracker.gg" },
  { nome: "OP.GG (app de desktop)", papel: "Conferência no VOD", texto: "O replay 2D do app foi usado pela equipe para conferir rounds na validação com VOD. Não está integrado ao site.", licenca: "Ferramenta de terceiros.", url: "https://op.gg", rotulo: "op.gg" },
  { nome: "YouTube", papel: "Vídeos de dica", texto: "As dicas dos reports levam para buscas e vídeos do YouTube (ou do canal de um coach, se configurado). Nenhum vídeo é copiado.", licenca: "Só links.", url: "https://www.youtube.com", rotulo: "youtube.com" },
  { nome: "Claude (Anthropic)", papel: "Assistente de IA", texto: "O código, a metodologia e estes textos foram escritos com a ajuda do Claude, assistente de IA da Anthropic, a partir das ideias e decisões da NokyLabs. Os números foram conferidos com dados reais (por exemplo, abates e mortes batem com o placar oficial).", licenca: "Ferramenta de desenvolvimento.", url: "https://www.anthropic.com/claude", rotulo: "anthropic.com" },
];

export function viewSobre() {
  const m = B.meta;
  const repo = m.projeto?.repo || "https://github.com/ThayTTG/ValReport";
  const refs = Object.entries(m.refs || {}).map(([f, n]) => `${f}: ${n}`).join(" · ");
  return {
    titulo: "Sobre, créditos e transparência",
    html: `<div class="prosa">
    <h1>Sobre o ValReport</h1>
    <p style="margin-top:10px">O ValReport é a versão web do report diário da nossa equipe, feito pela <strong>NokyLabs</strong>. Ele mostra as partidas de quem faz parte da equipe <em>e autorizou aparecer</em>, com as estatísticas que a comunidade já conhece dos trackers e uma camada de análise tática própria: impacto por round, índice justo por função, trades, posicionamento, formações e sinergia.</p>
    <div class="indice-sobre">${[["transparencia", "Transparência"], ["privacidade", "Privacidade"], ["metodologia", "Como calculamos"], ["limitacoes", "Limitações"], ["instalar", "Instalar no celular"], ["creditos", "Créditos"], ["legal", "Aviso legal"]].map(([id, t]) => `<button class="chip" type="button" data-rolar="${id}" style="cursor:pointer">${t}</button>`).join("")}</div>

    <h2 id="transparencia">Transparência: de onde vêm os números</h2>
    <ul>
      <li><strong>O site não consulta nenhuma API.</strong> Ele é estático (GitHub Pages) e só lê arquivos gerados uma vez por dia.</li>
      <li><strong>Coleta:</strong> um script em Python roda no PC da equipe às 21h. Ele busca as partidas na HenrikDev API (não oficial), guarda tudo localmente, manda o report para o Discord e exporta os dados deste site.</li>
      <li><strong>Quais partidas entram:</strong> só 5v5 no modo padrão (competitivo, Premier e personalizadas 5v5). Swiftplay, Skirmish, Deathmatch e afins ficam de fora, porque distorceriam as médias.</li>
      <li><strong>Elo:</strong> o histórico de RR vem do mesmo serviço (HenrikDev), e o report guarda cada atualização para montar o gráfico de evolução.</li>
      <li><strong>Notas da IGL:</strong> textos escritos pela IGL no PC da equipe (editor local) e publicados junto com os dados. São opinião e leitura tática da equipe, não um número calculado.</li>
      <li><strong>Código aberto:</strong> todo cálculo pode ser conferido em ${link(repo, "o repositório do projeto")}.</li>
      <li><strong>Agora:</strong> ${num(m.contagem?.partidas)} partidas e ${num(m.contagem?.rounds)} rounds exportados em ${esc(dataHora(m.gerado_em))}. Modelo de chance de vitória treinado com ${num(m.modelo?.rounds)} rounds. Referências por função (outros jogadores dos lobbies): ${esc(refs || "—")}.</li>
      <li><strong>Feito com IA:</strong> o código foi escrito com ajuda do Claude (Anthropic), e isso está nos créditos abaixo.</li>
    </ul>

    <h2 id="privacidade">Privacidade</h2>
    <ul>
      <li><strong>Pelo nome, só quem autorizou.</strong> Cada pessoa da equipe precisa estar na lista de autorizados para aparecer. Hoje são ${m.equipe.length}${m.ocultos ? `, e ${m.ocultos} ainda não ${m.ocultos === 1 ? "está" : "estão"} na lista` : ""}.</li>
      <li><strong>Todo o resto é anônimo.</strong> Aliados aleatórios, adversários e membros que não autorizaram aparecem como “Aliado 2” ou “Adversário 4”, sem nome, Riot ID, card ou nível. Agente, elo e números da partida continuam, porque sem eles o placar não faz sentido. A API pede que dados só sejam mostrados com consentimento e proíbe revelar nomes ocultos. Por isso anonimizamos todo mundo de fora.</li>
      <li><strong>Riot ID</strong> dos membros fica oculto, a menos que a equipe ative essa opção.</li>
      <li><strong>Nada sensível vai para o site:</strong> nenhuma chave de API, webhook ou senha.</li>
      <li><strong>Sem rastreamento:</strong> não há cookies, analytics nem anúncios. O site só guarda no seu navegador a escolha de tema claro ou escuro. Se você instalar o ValReport como app, uma cópia das páginas e imagens já vistas fica no aparelho para abrir sem internet (dá para apagar desinstalando o app ou limpando os dados do site).</li>
      <li><strong>Notas da IGL</strong> são públicas como o resto do site. Elas não citam pelo nome quem está fora da lista de autorizados.</li>
      <li><strong>Imagens externas:</strong> ícones, mapas e cards vêm de <code>media.valorant-api.com</code>, então seu navegador faz pedidos a esse servidor. A fonte é servida pelo próprio site.</li>
      <li><strong>Quer sair?</strong> Qualquer pessoa da equipe pode pedir para sair a qualquer momento. Se você é de fora e se reconheceu em alguma partida, ${link(`${repo}/issues`, "abra uma issue")} e a gente remove.</li>
    </ul>

    <h2 id="metodologia">Como calculamos</h2>
    <h3>Impacto por round</h3>
    <p>Um modelo estima a chance de cada time vencer o round a cada momento. Ele considera quantos estão vivos de cada lado, se a spike foi plantada e a diferença de economia. Cada abate, morte, plant ou defuse muda essa chance, e a variação vai para quem fez a ação. A assistência leva ${Math.round(100 * (m.regras.peso_assist ?? 0.25))}% do crédito, e uma morte que foi trocada pesa ${Math.round(100 * (m.regras.peso_trocada ?? 0.5))}% de uma morte comum. O número mostrado é a média por round, em pontos percentuais: +10% quer dizer que, em média, a pessoa aumentou em 10 pontos a chance do time vencer cada round. O modelo começa com uma referência e vai aprendendo com as partidas salvas.</p>
    <h3>Índice NokyLabs (0–100)</h3>
    <p>O índice é <strong>por função</strong>. <strong>50 é a média</strong> de quem jogou a mesma função <strong>nos lobbies de vocês</strong>, ou seja, os outros jogadores das mesmas partidas, e não uma média do elo. O impacto é o que mais pesa. Depois vêm as métricas típicas de cada função: first kills para duelista, assistências e uso do kit para iniciador, KAST e sobrevivência para controlador e sentinela. A <strong>margem</strong> vem de reamostrar os rounds 300 vezes, num intervalo de 90%. O veredito (acima, na média ou abaixo) só aparece com <strong>${num(m.regras.amostra_minima)}+ rounds</strong> na função. A janela é de ${m.regras.janela_dias} dias, o mesmo número do Discord. O índice de uma única partida usa a mesma conta e é bem mais instável.</p>
    <h3>Régua “vs elo”</h3>
    <p>Abaixo do índice aparece uma segunda régua: o mesmo cálculo, mas comparando só com quem jogou <strong>a mesma função na mesma faixa de elo</strong> (por exemplo, controladores no Platina), juntando todas as partidas salvas. Ela responde à pergunta “isso é bom para o meu elo?”, enquanto a primeira responde “isso é bom para os lobbies que eu peguei?”. Com poucas referências nessa faixa, a régua se apoia na média geral da função, e o site avisa.</p>
    <h3>Destaques, recordes e semana</h3>
    <p>A aba <strong>Destaques</strong> abre com o MVP da semana e os donos dos recordes (quem tem mais recordes ganha a coroa; o selo “novo” marca recordes dos últimos 7 dias). Os <strong>recordes</strong> mostram o melhor número de cada estatística numa única partida (seguem os filtros). Médias por round, como ACS, ADR e impacto, só contam partidas com 10 rounds ou mais, para uma rendição rápida não virar recorde. A <strong>Semana</strong> resume os últimos 7 dias: MVP (maior impacto por round, com pelo menos 20 rounds), comparação com a semana anterior, os rounds de maior impacto e os que valem rever no VOD. Aos domingos, o mesmo resumo vai para o Discord.</p>
    <h3>Trades e posicionamento</h3>
    <p>Uma morte conta como <strong>trocada</strong> quando o time da vítima mata o assassino em até ${m.regras.janela_trade_s} s. A distância até o aliado mais próximo é medida na hora da morte: até <strong>${m.regras.trade_m} m</strong> ainda dá para trocar, e acima de <strong>${m.regras.isolado_m} m</strong> a morte conta como isolada. No jogo, 100 unidades equivalem a 1 m. Abates e mortes acima de ${m.regras.isolado_m} m contam como jogadas solo.</p>
    <h3>Economia, clutches e o resto</h3>
    <ul>
      <li><strong>Tipo de round</strong> pela carga média de cada time. Eco fica abaixo de ${num(m.regras.eco)}; force vai até ${num(m.regras.armado - 1)}; armado é a partir de ${num(m.regras.armado)}. Anti-eco é vocês armados contra eco. Os rounds 1 e 13 são pistol.</li>
      <li><strong>Clutch</strong> é quando a pessoa fica como a última viva do time. O “esperado” soma as chances que o modelo dava em cada situação.</li>
      <li><strong>Estatísticas comuns:</strong> ADR = dano ÷ rounds da partida; ACS = score ÷ rounds; KAST = % de rounds com abate, assistência, sobrevivência ou morte trocada; DDΔ = dano causado − recebido, por round.</li>
      <li><strong>Ficam de fora:</strong> rounds AFK, rounds vazios de rendição e morte na própria spike, como no placar oficial.</li>
    </ul>

    <h2 id="limitacoes">Limitações</h2>
    <ul>
      <li>A API informa só o <strong>total de habilidades</strong> por partida. Não dá para saber quando nem onde cada uma foi usada, e por isso não há mapa de calor de habilidades.</li>
      <li><strong>HS% por arma</strong> é aproximado, porque usa a arma comprada no round. Já os abates por arma são exatos.</li>
      <li>A <strong>média do lobby muda com o lobby</strong>: jogar contra gente mais forte tende a baixar o índice, mesmo jogando igual.</li>
      <li><strong>Amostras pequenas variam muito</strong>, e por isso mostramos a margem e esperamos ${num(m.regras.amostra_minima)} rounds para dar veredito.</li>
      <li>As posições são as do <strong>momento de cada abate</strong>. Não é um replay completo.</li>
      <li>Os dados dependem da HenrikDev API, que pode atrasar ou sair do ar. O site mostra a última exportação.</li>
      <li>O <strong>gráfico de elo</strong> começa quando o report passou a guardar o histórico. Partidas mais antigas que o limite da API não aparecem.</li>
    </ul>

    <h2 id="instalar">Instalar no celular</h2>
    <p>O ValReport funciona como app: abre em tela cheia, ganha ícone próprio e mostra a última versão vista mesmo sem internet.</p>
    <ul>
      <li><strong>Android (Chrome):</strong> toque no botão ${icone("instalar")} no topo do site, quando ele aparecer, ou no menu ⋮ → <em>Instalar app</em>.</li>
      <li><strong>iPhone (Safari):</strong> toque em <em>Compartilhar</em> → <em>Adicionar à Tela de Início</em>.</li>
      <li><strong>Computador (Chrome ou Edge):</strong> use o ícone de instalar na barra de endereço.</li>
    </ul>

    <h2 id="creditos">Créditos</h2>
    <p>Tudo o que usamos até aqui, e o que cada um faz no projeto:</p>
    </div>
    <div class="creditos">${CREDITOS.map((c) => `<article class="credito"><span class="selo selo--destaque">${esc(c.papel)}</span><h3>${esc(c.nome)}</h3><p>${esc(c.texto)}</p><p class="licenca">${esc(c.licenca)}</p>${link(c.url, c.rotulo)}</article>`).join("")}</div>

    <div class="prosa">
    <h2 id="legal">Aviso legal</h2>
    <p><strong>ValReport was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.</strong></p>
    <p>O ValReport foi criado sob a política “Legal Jibber Jabber” da Riot Games, usando assets da Riot Games. A Riot Games não endossa nem patrocina este projeto. VALORANT e todas as propriedades associadas são marcas registradas da Riot Games, Inc.</p>
    <p>A HenrikDev API não é endossada pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém oficialmente envolvido na produção ou gestão das propriedades da Riot Games.</p>
    <p>É um projeto de fã, gratuito, sem anúncios e sem fins lucrativos. O código está no GitHub sob a licença indicada no repositório.</p>
    </div>`,
  };
}
