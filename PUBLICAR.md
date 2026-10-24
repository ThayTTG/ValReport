# Publicar o site no GitHub Pages

Passo a passo para transformar a pasta do report (`ValorantReport`) no repositório [ThayTTG/ValReport](https://github.com/ThayTTG/ValReport) e ligar o site. Leva uns 10 minutos, uma vez só.

## 0. Antes de tudo: consentimento e chave

1. **Combine com a equipe.** Só quem autorizar aparece pelo nome. No `config.json`, acrescente:
   ```json
   "site": {
     "jogadores_autorizados": ["SeuNome#TAG"],
     "mostrar_riot_id": false,
     "publicar_automatico": false
   }
   ```
   Ponha na lista o Riot ID de cada pessoa que disser "pode". Quem não estiver na lista aparece como "Aliado", sem nome.
2. **Chave da HenrikDev:** para site público, a HenrikDev indica a chave *Advanced* (90 req/min). Ela é pedida no Discord da HenrikDev pelo [dashboard](https://api.henrikdev.xyz/dashboard/), com resposta em 1–2 semanas. Até lá, deixe o site sem divulgar.

## 1. Instalar o Git

Baixe o [Git para Windows](https://git-scm.com/download/win) e instale com as opções padrão. Ele já vem com o *Git Credential Manager*, que faz o login no GitHub pelo navegador.

## 2. Ligar a pasta ao repositório

Abra o PowerShell **dentro da pasta do report** e rode:

```powershell
git init -b main
git remote add origin https://github.com/ThayTTG/ValReport.git
git status
```

No `git status`, confira que **não aparecem** `config.json` nem a pasta `dados/`. O `.gitignore` protege os dois. Se aparecerem, pare e me avise.

## 3. Gerar os dados e enviar

```powershell
py exportar_site.py --verificar
git add .
git commit -m "Primeira versão do ValReport"
git push -u origin main
```

Na primeira vez, o navegador abre para você entrar no GitHub.

## 4. Ligar o GitHub Pages

No GitHub: **Settings → Pages → Build and deployment**
- *Source*: **Deploy from a branch**
- *Branch*: **main** e pasta **/docs** → **Save**

Em 1–2 minutos o link aparece no topo dessa página (algo como `https://thayttg.github.io/ValReport/`).

## 5. Atualizar todo dia

- **Manual:** dois cliques em `publicar_site.bat` (exporta e faz `git push`).
- **Automático:** no `config.json`, troque `"publicar_automatico": false` para `true`. O report das 21h passa a publicar sozinho.

## Dicas

- **Ver antes de publicar:** `py -m http.server 8000 -d docs` e abra http://localhost:8000.
- **Tirar alguém do site:** remova o Riot ID de `jogadores_autorizados` e publique de novo. O histórico do Git ainda guarda versões antigas dos arquivos. Se precisar apagar de vez, me peça ajuda para limpar o histórico.
- **Algo não apareceu?** Rode `py exportar_site.py --verificar` e leia as mensagens que começam com "Site:".
