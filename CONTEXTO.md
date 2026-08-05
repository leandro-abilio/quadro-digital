# Contexto do Projeto — Quadro Digital

## O que é

Duas extensões VSCode para transmitir código ao vivo em sala de aula:
- **quadro-professor** — professor controla pelo painel lateral do VSCode
- **quadro-aluno** — aluno vê o código em tempo real no painel lateral do VSCode

## Publisher e repositório

- Publisher: `leandro-abilio` (Leandro Abilio Silva)
- Marketplace: https://marketplace.visualstudio.com/publishers/leandro-abilio
- GitHub: https://github.com/leandro-abilio/quadro-digital

## Versões atuais

- quadro-professor: **2.4.2** — publicada no Marketplace. Debounce 500ms→1.5s, timestamp de sala pública via relógio do servidor, contagem de presença no modo Firebase, botão "Encerrar" com contraste corrigido
- quadro-aluno: **2.3.3** — publicada no Marketplace. Poll 1.5s→2.5s, tolerância de sala pública 15s→20s, fallback de "nenhuma sala" com entrada manual, heartbeat de presença, botão "Sair" com contraste corrigido

## Arquitetura técnica

### Professor (quadro-professor)
- Extensão VSCode com `WebviewViewProvider` — painel lateral nativo
- Servidor HTTP Node.js na porta 3456 (módulo `http` nativo, sem Express)
- Polling: alunos fazem GET `/estado` a cada 1.5s
- Transmissão em tempo real via `onDidChangeTextDocument` com debounce de 500ms
- Também serve página HTML em `/` para alunos acessarem pelo navegador

### Aluno (quadro-aluno)
- Extensão VSCode com `WebviewViewProvider` — painel lateral nativo
- Polling via `http.get`/`https.get` do Node.js (não via fetch no Webview — bloqueado pelo VSCode)
- Reconexão automática indefinida
- Suporte a rede local (HTTP) e Firebase (HTTPS, próprio ou Salas Públicas)

### Página web (modo navegador)
- Servida em `/` pelo servidor do professor
- Autenticação por senha digitada na própria página
- Polling via `fetch` do navegador a cada 1.5s
- Syntax highlighting em JavaScript puro (sem CDN)

## Funcionalidades implementadas

### Professor
- ▶ Iniciar transmissão (escolhe modo: Firebase — nuvem, ou rede local; ngrok e Cloudflare Tunnel removidos, ver "Limpeza" abaixo)
- 👁 Apagão — oculta código dos alunos
- 🧊 Freeze — congela tela dos alunos, professor troca de arquivo à vontade
- ✂️ Trecho — transmite só linhas selecionadas (Ctrl+Shift+Q)
- 🔢 Números de linha
- ⏱ Temporizador — define MM:SS, controla com ▶ ⏸ ↺, pisca vermelho ao acabar
- ⏹ Encerrar sessão
- Destaque automático da linha do cursor
- Escolha de IP (lista todos, ignora loopback, prefere Ethernet/Wi-Fi)
- Copiar dados da sessão para o chat

### Aluno (extensão)
- Conectar por Firebase (Salas Públicas ou sala/senha manual) ou rede local (IP + senha)
- A− / A+ para fonte local
- Reconexão automática (dot laranja ao reconectar)
- Destaque da linha do professor
- Toast ao copiar

### Aluno (navegador)
- Tela de senha antes de entrar
- A− / A+ para fonte local
- Destaque da linha do professor
- Toast ao copiar

## Automação via Veyon

```bash
# Rede local
code --command quadroAluno.conectarDireto --args "[\"192.168.1.42\",\"senha\"]"

# Firebase (URL do Realtime Database + sala) — só funciona com sala/senha conhecida
# de antemão, não automatiza a escolha de uma sala pública por nome
code --command quadroAluno.conectarDireto --args "[\"https://meu-projeto-default-rtdb.firebaseio.com\",\"gato-casa-azul\",\"firebase\"]"
```

## Situação da rede na escola

- Rede: `10.110.4.x`
- Professor: `10.110.4.45`
- Fortinet com isolamento de cliente — bloqueia:
  - Comunicação direta entre máquinas (porta 3456)
  - HTTPS externo no Node.js fora da porta 443 padrão (ex: túneis dedicados como ngrok/Cloudflare Tunnel)
  - HTTPS externo no navegador nas mesmas condições
- Ticket aberto com TI — prazo de resposta ~6 meses (dispensável agora, ver abaixo)
- **RESOLVIDO (2026-07-31): modo Firebase publicado e testado em campo na escola — funcionou.** HTTPS puro na porta 443 passa pelo Fortinet normalmente. **Este é o modo recomendado para a rede da escola.**
- ngrok e Cloudflare Tunnel foram tentados antes do Firebase e **não funcionaram** (dependem de portas/protocolos de túnel dedicados fora do HTTPS padrão — 7844 no caso do Cloudflare) — código de ambos removido do projeto (ver "Limpeza" abaixo).

## Limpeza do projeto (2026-07-31)

- Removidos os modos **Cloudflare Tunnel** e **ngrok** do `quadro-professor` e `quadro-aluno` (`iniciarCloudflare`, `iniciarNgrok`/`lerUrlNgrok`, itens do QuickPick, badges, `modoNgrok`) — nenhum dos dois funciona na rede da escola, e o Firebase os substitui com vantagem (zero configuração externa via Salas Públicas).
- Mantidos: rede local e Firebase (recomendado para redes restritivas).
- Menu de escolha de modo reordenado nas duas extensões: **Firebase primeiro**, rede local depois (Firebase é o caminho recomendado agora).
- `.vscode/launch.json` criado em `quadro-professor/` e `quadro-aluno/` (não existia) — necessário para o F5 abrir o Extension Development Host direto, sem pedir para escolher um debugger.

## Modo Firebase (relay) — com lobby de Salas Públicas

Usa a API REST do Firebase Realtime Database como intermediário: o professor grava o estado em `/salas/{sala}.json` (PUT) e os alunos leem de lá (GET) a cada 1.5s — mesmo polling de sempre, só muda o destino. Não abre servidor local nem depende da porta 3456; é só HTTPS de saída na porta 443.

### Dois modos de projeto (híbrido)
- **Meu Firebase**: professor/aluno configuram a URL do próprio projeto (fluxo original, URL salva em `globalState`).
- **Salas Públicas (compartilhado)**: usa um projeto Firebase já embutido na extensão (`SALAS_PUBLICAS_URL`, atualmente `https://quadro-digital-dds-default-rtdb.firebaseio.com`), sem nenhuma configuração do lado do professor ou aluno.

### Pública x privada
- **Privada** (padrão): sala não aparece em nenhuma lista — só entra quem souber a sala/senha (fluxo original, sala = segredo compartilhado).
- **Pública**: professor dá um nome de exibição (ex: "Turma 9 - Matemática"); a sala é registrada em `/salas_publicas/{sala}` com esse nome, e o aluno pode navegar por uma lista de salas ativas em vez de digitar sala/senha. A sala ainda tem seu ID aleatório por trás, mas ele fica visível/irrelevante já que qualquer aluno pode entrar.
- Uma sala pública "viva" manda heartbeat a cada 5s (`INTERVALO_HEARTBEAT_PUBLICO`) atualizando o campo `timestamp` em `/salas_publicas/{sala}`. O aluno, ao listar, filtra e só mostra salas com heartbeat dos últimos 20s (`VALIDADE_SALA_PUBLICA`) — assim uma sessão encerrada abruptamente (crash, sem passar pelo `cmdEncerrar`) some da lista sozinha em poucos segundos, sem precisar de limpeza manual.
- Ao encerrar normalmente, o professor também dá DELETE em `/salas_publicas/{sala}` (`removerSalaPublica`), além do DELETE de sempre em `/salas/{sala}`.
- **Timestamp do heartbeat usa o relógio do servidor Firebase** (`{".sv": "timestamp"}`), não `Date.now()` do professor — ver "Bug: aluno não via a sala pública" abaixo.

### Regras de segurança do Realtime Database (atualizar em qualquer projeto usado, próprio ou compartilhado)
```json
{
  "rules": {
    "salas": {
      "$sala": { ".read": true, ".write": true }
    },
    "salas_publicas": {
      ".read": true,
      "$sala": { ".write": true }
    },
    "presencas": {
      "$sala": {
        ".read": true,
        "$id": { ".write": true }
      }
    }
  }
}
```
Diferença importante: `salas` só permite ler *uma* sala por vez (quem não sabe o nome não entra — é o segredo). `salas_publicas` tem `.read: true` no nó inteiro, porque o aluno precisa listar *todas* as salas públicas de uma vez para montar o lobby. `presencas` é parecido: `.read: true` em `$sala` pro professor conseguir contar todos os alunos de uma vez, mas o `.write` só é liberado por `$id` — cada aluno só escreve o próprio heartbeat, nunca o nó inteiro.

**Ação pendente do usuário**: atualizar as rules no console do Firebase (projeto `quadro-digital-dds` e qualquer "Meu Firebase" em uso) para incluir o bloco `presencas` acima — sem isso a contagem de alunos conectados no modo Firebase não funciona (as escritas falham silenciosamente).

### Fluxo do professor (`cmdIniciarFirebase` em `quadro-professor/src/extension.js`)
1. QuickPick: "Salas Públicas (compartilhado)" ou "Meu Firebase" → define a URL
2. QuickPick: "Privada" ou "Pública" → se pública, pede o nome de exibição
3. Gera a sala (`gerarSenha()`), testa acesso (`testarFirebase`, dentro de `/salas/{sala}`, nunca na raiz — bloqueada de propósito)
4. Se pública: `registrarSalaPublica` (PUT inicial) + inicia o heartbeat (`setInterval` chamando `atualizarHeartbeatPublico` a cada 5s, guardado em `heartbeatPublicoTimer`)
5. `publicarEstado()` continua sendo o ponto único que também escreve em `/salas/{sala}` a cada atualização de conteúdo — não mudou
6. Ao encerrar: `clearInterval` do heartbeat, `limparFirebase` (DELETE sala) e, se pública, `removerSalaPublica` (DELETE do lobby)

### Fluxo do aluno (`cmdConectarFirebase` em `quadro-aluno/src/extension.js`)
1. QuickPick: "Salas Públicas (compartilhado)" ou "Meu Firebase" (URL salva em `globalState`, chave própria do aluno)
2. QuickPick: "Ver salas públicas" (lista via `listarSalasPublicas`, já filtrando por atividade) ou "Entrar com sala/senha" (fluxo manual de sempre)
3. Em ambos os casos termina em `finalizarConexaoFirebase(url, sala)`, que faz o teste de conexão e inicia o polling — não duplica lógica entre os dois caminhos
4. `conectarDireto` (automação Veyon) continua funcionando só no fluxo manual (sala/senha conhecidas de antemão) — não tem como automatizar a escolha de uma sala pública por nome ainda

### Testado (2026-07-31)
- Rules atualizadas no projeto `quadro-digital-dds` e validadas via curl: registro/listagem de salas públicas, filtro de sala "encerrada" (heartbeat antigo) excluída da lista, e confirmação de que as regras antigas de `/salas` não quebraram.
- **Testado dentro do VSCode (F5) com o fluxo completo do lobby (Salas Públicas, pública/privada) e com ngrok/Cloudflare Tunnel removidos — funcionou.**
- Versões bumpadas (2.4.0 professor / 2.3.0 aluno) e `.vsix` empacotados. **Ainda não publicado no Marketplace** — falta rodar `vsce publish` (feito manualmente pelo Leandro, que já tem o PAT).

### Cota do plano gratuito do Firebase e otimização com ETag (2026-07-31)
O plano Spark (gratuito) do Realtime Database libera ~10GB/mês de download (~360MB/dia mostrado no console). O polling do aluno a cada 1.5s, sem otimização, baixaria o estado inteiro mesmo sem mudança nenhuma: numa turma de 30 alunos numa aula de 50min, isso dá **~180MB só nessa aula** (2000 requisições/aluno × ~3KB) — 2 turmas no mesmo dia já estourariam a cota.

**Solução implementada**: `buscarEstadoFirebase()` em `quadro-aluno/src/extension.js` agora usa o suporte a ETag da API REST do Firebase — envia o header `X-Firebase-ETag: true` para receber um `ETag` na resposta, e nas leituras seguintes manda `If-None-Match: {etag}`. Quando o conteúdo não mudou, o Firebase responde `304 Not Modified` **sem corpo** (confirmado via curl: 0 bytes vs ~173 bytes numa resposta normal pequena — a economia cresce com o tamanho do código transmitido). Como a maioria dos polls acontece sem mudança real, isso derruba o consumo de banda em bem mais de 90% no caso comum.
- `etagFirebaseAtual` e `ultimoCorpoFirebase` guardam o último ETag e corpo conhecidos; resetados em `finalizarConexaoFirebase` a cada nova conexão (pra não reaproveitar ETag de uma sala anterior).
- Em caso de `304`, `buscarEstadoFirebase` retorna o corpo em cache — o restante da lógica em `buscarEstado()` não precisou mudar, já que compara `timestamp` normalmente.
- Testado via curl direto contra `quadro-digital-dds`: `304` confirmado sem mudança, `200` com ETag novo após um PUT diferente.

### Teste em campo (2026-08-04) e ajuste de debounce/poll
Testado com alunos reais na escola — funcionou, mas consumiu **260MB em meia aula**, mesmo já com o ETag (2.3.1) publicado. Causa: o estado inclui `timestamp: Date.now()` a cada publicação, então o corpo nunca é byte-idêntico entre uma escrita e outra — o ETag só rende 304 nas pausas do professor. Como a escrita tinha debounce de só 500ms e o poll do aluno era de 1.5s, em trechos de digitação contínua a maioria dos polls caía em cima de um estado novo (200 completo), não em 304.

**Ajuste feito**: aumentado o debounce de publicação do professor de 500ms para **1.5s** (`registrarListenersEdicao` em `quadro-professor/src/extension.js`) e o intervalo de poll do aluno de 1.5s para **2.5s** (`quadro-aluno/src/extension.js`). Menos escritas durante digitação contínua = mais chance de os polls baterem no mesmo ETag; menos polls no total = menos requisições mesmo nos casos de 200. Troca: leve aumento na latência percebida pelo aluno (pouco perceptível numa aula). Ainda não testado em campo com os novos valores — validar na próxima aula e, se ainda precisar de mais economia, considerar não republicar quando só a seleção/cursor muda sem digitação real (hoje já não republica, só atualiza local) ou aumentar ainda mais o poll.

### Bug: aluno não via a sala pública ("nenhuma sala ativa") (2026-08-04)
Um aluno relatou não conseguir conectar — a extensão mostrava "Nenhuma sala pública ativa no momento" mesmo com o professor transmitindo. Só esse aluno teve o problema (não a turma toda), o que aponta para o relógio do **PC do aluno** e não do professor — comum em laboratórios de escola (CMOS/bateria fraca, sem NTP).

Causa: `listarSalasPublicas` (aluno) filtra salas comparando `Date.now()` do próprio PC do aluno com o campo `timestamp` gravado pelo professor com `Date.now()` do PC *dele*. Se qualquer um dos dois relógios estiver errado por mais que a janela de tolerância, a sala parece "morta" mesmo com heartbeat em dia.

**Correções aplicadas**:
- `registrarSalaPublica`/`atualizarHeartbeatPublico` (professor) agora gravam `timestamp` usando `{ ".sv": "timestamp" }` — o **relógio do servidor do Firebase**, não mais `Date.now()` do professor. Elimina o relógio do professor como fonte do problema.
- `VALIDADE_SALA_PUBLICA` (janela de tolerância) subiu de 15s para **20s** nos dois lados, dando uma folga extra pra pequenas diferenças de relógio.
- O relógio do *aluno* que lista as salas ainda entra na conta (não tem como evitar sem reescrever o listener via SDK, o que a API REST não expõe) — por isso a mensagem de "nenhuma sala" agora **não termina em beco sem saída**: oferece "Entrar com sala/senha" (fallback manual, pedindo a sala/senha ao professor) e "Tentar de novo" direto na mesma caixa de diálogo (`cmdConectarFirebase` em `quadro-aluno/src/extension.js`).

### Feature: contagem de alunos conectados no modo Firebase (2026-08-04)
Antes, o contador "X aluno(s)" no painel do professor só funcionava no modo rede local (`registrarCliente`, disparado por requisições no servidor HTTP local na porta 3456) — no modo Firebase os alunos nunca batem nesse servidor, então o contador ficava travado em 0.

**Implementado**: presença via um caminho novo e separado, `/presencas/{sala}/{id}` — não pode ser dentro de `/salas/{sala}` porque o professor faz **PUT do estado inteiro** ali a cada atualização, o que apagaria qualquer coisa que os alunos escrevessem no mesmo nó.
- **Aluno** (`quadro-aluno/src/extension.js`): gera um `idPresencaFirebase` aleatório ao conectar (`finalizarConexaoFirebase`) e escreve um heartbeat (`escreverPresencaFirebase`, fire-and-forget, usa `{".sv":"timestamp"}`) a cada poll (2.5s). Remove o próprio nó (`removerPresencaFirebase`, DELETE) ao desconectar manualmente ou ao desativar a extensão.
- **Professor** (`quadro-professor/src/extension.js`): `iniciarContagemPresenca` roda a cada 5s (`INTERVALO_PRESENCA_FIREBASE`) enquanto a sala Firebase estiver ativa, lê `/presencas/{sala}.json`, conta quem teve heartbeat nos últimos 12s (`VALIDADE_PRESENCA_FIREBASE`) e reaproveita o mesmo `clientesAtivos`/`atualizarConexoes()` que já alimenta o badge "X aluno(s)" no modo rede local — não precisou mexer na UI.
- **Exige atualizar as rules do Firebase** (bloco `presencas` na seção acima) — sem isso as escritas de presença falham silenciosamente e a contagem continua em 0.
- Ainda não testado em campo — validar na próxima aula.

### Fix: botões de "Encerrar"/"Desconectar" muito apagados
`.btn.perigo` (professor, botão ⏹ Encerrar) e `.btn.desconectar` (aluno, botão ⏏ Sair) só tinham estilo definido no `:hover` — em repouso ficavam idênticos a um botão comum, sem indicar que é uma ação destrutiva. Adicionado `color:#f44` e `border-color` sutil em repouso nos dois, mantendo o destaque mais forte no hover.

## Estrutura de arquivos

```
quadro-digital/
├── quadro-professor/
│   ├── src/extension.js    ← servidor + painel + página web + relay Firebase
│   ├── .vscode/launch.json ← config de debug (F5) da extensão
│   ├── package.json        ← publisher leandro-abilio
│   ├── icon.png
│   └── README.md
├── quadro-aluno/
│   ├── src/extension.js    ← polling + painel + relay Firebase
│   ├── .vscode/launch.json ← config de debug (F5) da extensão
│   ├── package.json        ← publisher leandro-abilio
│   ├── icon.png
│   └── README.md
├── .gitignore
├── .github/
│   └── publish.yml         ← GitHub Actions para publicar no Marketplace
├── CONTEXTO.md             ← este arquivo
└── README.md
```

## Publicar nova versão

```bash
cd quadro-professor
# Edita version no package.json
npx vsce package --no-dependencies
vsce publish

cd ../quadro-aluno
# Edita version no package.json
npx vsce package --no-dependencies
vsce publish
```

## Detalhes técnicos importantes

### Por que polling e não SSE/WebSocket?
SSE (EventSource) é bloqueado pelo Webview do VSCode para HTTP. Polling via `http.get` do Node.js funciona sem restrições.

### Por que Node.js e não fetch no Webview?
O Webview do VSCode bloqueia `fetch` para endereços locais por CSP. A solução foi fazer o polling no processo Node.js da extensão e passar dados via `postMessage`.

### Highlight sem CDN
O Webview bloqueia CDNs externos. Implementamos highlight em JS puro com regex, injetado via `JSON.stringify` do Node.js. Suporta: Python, JavaScript, TypeScript.
