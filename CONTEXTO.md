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

- quadro-professor: **2.4.1** — debounce de publicação 500ms→1.5s (economia de banda), ainda não publicada
- quadro-aluno: **2.3.2** — poll 1.5s→2.5s (economia de banda), ainda não publicada

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
- Uma sala pública "viva" manda heartbeat a cada 5s (`INTERVALO_HEARTBEAT_PUBLICO`) atualizando o campo `timestamp` em `/salas_publicas/{sala}`. O aluno, ao listar, filtra e só mostra salas com heartbeat dos últimos 15s (`VALIDADE_SALA_PUBLICA`) — assim uma sessão encerrada abruptamente (crash, sem passar pelo `cmdEncerrar`) some da lista sozinha em poucos segundos, sem precisar de limpeza manual.
- Ao encerrar normalmente, o professor também dá DELETE em `/salas_publicas/{sala}` (`removerSalaPublica`), além do DELETE de sempre em `/salas/{sala}`.

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
    }
  }
}
```
Diferença importante: `salas` só permite ler *uma* sala por vez (quem não sabe o nome não entra — é o segredo). `salas_publicas` tem `.read: true` no nó inteiro, porque o aluno precisa listar *todas* as salas públicas de uma vez para montar o lobby.

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
