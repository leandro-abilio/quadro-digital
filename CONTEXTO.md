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

- quadro-professor: **2.2.1**
- quadro-aluno: **2.1.2**

## Arquitetura técnica

### Professor (quadro-professor)
- Extensão VSCode com `WebviewViewProvider` — painel lateral nativo
- Servidor HTTP Node.js na porta 3456 (módulo `http` nativo, sem Express)
- Polling: alunos fazem GET `/estado` a cada 1.5s
- Transmissão em tempo real via `onDidChangeTextDocument` com debounce de 500ms
- Também serve página HTML em `/` para alunos acessarem pelo navegador

### Aluno (quadro-aluno)
- Extensão VSCode com `WebviewViewProvider` — painel lateral nativo
- Polling via `http.get` do Node.js (não via fetch no Webview — bloqueado pelo VSCode)
- Reconexão automática indefinida
- Suporte a rede local (HTTP) e ngrok (HTTPS)

### Página web (modo navegador)
- Servida em `/` pelo servidor do professor
- Autenticação por senha digitada na própria página
- Polling via `fetch` do navegador a cada 1.5s
- Syntax highlighting em JavaScript puro (sem CDN)

## Funcionalidades implementadas

### Professor
- ▶ Iniciar transmissão (escolhe modo: rede local ou ngrok/cloudflare)
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
- Conectar por rede local (IP) ou ngrok (URL)
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

# ngrok
code --command quadroAluno.conectarDireto --args "[\"abc.ngrok-free.dev\",\"senha\",\"ngrok\"]"
```

## Situação da rede na escola

- Rede: `10.110.4.x`
- Professor: `10.110.4.45`
- Fortinet com isolamento de cliente — bloqueia:
  - Comunicação direta entre máquinas (porta 3456)
  - HTTPS externo no Node.js (ngrok via extensão do aluno)
  - HTTPS externo no navegador (ngrok via browser também bloqueado)
- Ticket aberto com TI — prazo de resposta ~6 meses
- **Cloudflare Tunnel testado — NÃO foi bloqueado pelo Fortinet** ← próximo a explorar

## Próximo passo: Cloudflare Tunnel

O Cloudflare Tunnel (`cloudflared`) é uma alternativa ao ngrok que:
- Não requer abertura de portas
- Usa HTTPS via infraestrutura do Cloudflare (raramente bloqueada)
- Tem plano gratuito
- Pode ser configurado com domínio próprio

A ideia é integrar o `cloudflared` na extensão do professor:
1. Professor roda `cloudflared tunnel --url http://localhost:3456` no terminal
2. Extensão lê a URL gerada via API ou stdout
3. Alunos acessam pelo navegador

## Estrutura de arquivos

```
quadro-digital/
├── quadro-professor/
│   ├── src/extension.js    ← ~1200 linhas — servidor + painel + página web
│   ├── package.json        ← versão 2.2.1, publisher leandro-abilio
│   ├── icon.png
│   └── README.md
├── quadro-aluno/
│   ├── src/extension.js    ← ~550 linhas — polling + painel
│   ├── package.json        ← versão 2.1.2, publisher leandro-abilio
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

### ngrok na extensão do professor
Não usamos `spawn` — a Microsoft Store bloqueia execução por outros processos. Professor roda `ngrok http 3456` manualmente. Extensão lê a URL via API local: `http://127.0.0.1:4040/api/tunnels`.

### Cloudflare Tunnel (a implementar)
- Executável: `cloudflared`
- Comando: `cloudflared tunnel --url http://localhost:3456`
- A URL aparece no stdout: `https://xxx.trycloudflare.com`
- Mesma abordagem do ngrok — professor roda manualmente, extensão lê a URL
