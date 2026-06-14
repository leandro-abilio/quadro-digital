const vscode = require('vscode');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// ── Estado global ──
let servidor = null;
let ultimoEditor = null;
let linhaDestacada = null;
let modoApagao = false;
let modoFreeze = false;
let mostrarNumeros = true;
let estadoAtual = null;
let estadoFreezeAtual = null; // snapshot congelado
let painelView = null;
const clientesAtivos = new Map();
const TIMEOUT_CLIENTE = 5000;

function registrarCliente(nome) {
  clientesAtivos.set(nome, Date.now());
  atualizarConexoes();
}

function contarClientesAtivos() {
  const agora = Date.now();
  for (const [n, ts] of clientesAtivos.entries()) {
    if (agora - ts > TIMEOUT_CLIENTE) clientesAtivos.delete(n);
  }
  return clientesAtivos.size;
}

function atualizarConexoes() {
  painelView?.webview.postMessage({ tipo: 'conexoes', total: contarClientesAtivos() });
}

// ── IPs ──
function listarIPs() {
  const preferir = /wi.fi|wireless|ethernet|local area|rede|wlan|eth|en\d/i;
  const ignorar  = /loopback|pseudo/i;
  const candidatos = [];
  for (const [nome, aliases] of Object.entries(os.networkInterfaces())) {
    if (ignorar.test(nome)) continue;
    for (const alias of aliases) {
      if (alias.family !== 'IPv4' || alias.internal) continue;
      candidatos.push({ ip: alias.address, nome, preferido: preferir.test(nome) });
    }
  }
  return candidatos.sort((a, b) => (b.preferido ? 1 : 0) - (a.preferido ? 1 : 0));
}

function gerarSenha() {
  const p = ['gato','casa','azul','mesa','sol','lua','rio','mar','flor','livro','porta','janela','chuva','vento','fogo','pedra'];
  const pick = () => p[Math.floor(Math.random() * p.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

// ── Servidor HTTP ──
function iniciarServidor(porta, senha) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const url = new URL(req.url, 'http://localhost');
      const senhaReq = url.searchParams.get('senha');

      if (url.pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, versao: '2.0.0' }));
        return;
      }

      if (senhaReq !== senha) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Senha incorreta' }));
        return;
      }

      if (url.pathname === '/estado') {
        registrarCliente(url.searchParams.get('nome') || 'Aluno');
        // No modo freeze, serve o snapshot congelado
        const estado = modoFreeze ? estadoFreezeAtual : estadoAtual;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(
          estado || { conteudo: '', linguagem: 'plaintext', nomeArquivo: 'Aguardando...', timestamp: 0 }
        ));
      } else {
        res.writeHead(404); res.end();
      }
    });
    srv.on('error', (e) => { if (e.code === 'EADDRINUSE') resolve(null); });
    srv.listen(porta, '0.0.0.0', () => resolve(srv));
  });
}

function pararServidor() {
  return new Promise((resolve) => {
    clientesAtivos.clear();
    atualizarConexoes();
    if (servidor) { servidor.close(() => { servidor = null; resolve(); }); }
    else resolve();
  });
}

function enviarConteudo() {
  if (modoFreeze) return; // no freeze, não atualiza
  const editor = vscode.window.activeTextEditor || ultimoEditor;
  if (!editor) return;
  ultimoEditor = editor;
  const doc = editor.document;
  estadoAtual = {
    conteudo: modoApagao ? '' : doc.getText(),
    linguagem: doc.languageId,
    nomeArquivo: doc.fileName.split(/[\\/]/).pop(),
    apagao: modoApagao,
    mostrarNumeros,
    linhaDestacada,
    timestamp: Date.now(),
  };
  painelView?.webview.postMessage({ tipo: 'atualizacao', ...estadoAtual });
}

// ── WebviewViewProvider ──
class ProfessorViewProvider {
  constructor(context) { this.context = context; }

  resolveWebviewView(webviewView) {
    painelView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = gerarHTML();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.tipo) {
        case 'pronto':
          if (servidor) enviarConteudo();
          break;
        case 'iniciar':
          await cmdIniciar(this.context);
          break;
        case 'encerrar':
          await cmdEncerrar();
          break;
        case 'apagao':
          modoApagao = !modoApagao;
          enviarConteudo();
          webviewView.webview.postMessage({ tipo: 'apagao', ativo: modoApagao });
          break;
        case 'freeze':
          modoFreeze = !modoFreeze;
          if (modoFreeze) {
            // Tira snapshot do estado atual ao congelar
            estadoFreezeAtual = estadoAtual ? { ...estadoAtual } : null;
          }
          webviewView.webview.postMessage({ tipo: 'freeze', ativo: modoFreeze });
          vscode.window.setStatusBarMessage(
            modoFreeze ? '$(pinned) Tela congelada' : '$(broadcast) Transmitindo ao vivo',
            3000
          );
          break;
        case 'trecho':
          transmitirTrecho();
          break;
        case 'numeros':
          mostrarNumeros = !mostrarNumeros;
          webviewView.webview.postMessage({ tipo: 'numeros', ativo: mostrarNumeros });
          enviarConteudo();
          break;
        case 'copiar-link':
          await vscode.env.clipboard.writeText(msg.link);
          vscode.window.showInformationMessage('Dados copiados! Cole no chat para os alunos.');
          break;
      }
    });

    if (servidor) enviarConteudo();
  }
}

// ── Comandos ──
async function cmdIniciar(context) {
  if (vscode.window.activeTextEditor) ultimoEditor = vscode.window.activeTextEditor;

  if (servidor) {
    vscode.window.showInformationMessage('Transmissão já está ativa!');
    return;
  }

  const senha = await vscode.window.showInputBox({
    prompt: 'Senha para a sessão',
    value: gerarSenha(),
    ignoreFocusOut: true,
  });
  if (!senha) return;

  const ips = listarIPs();
  let ip;
  if (ips.length === 0) {
    ip = 'localhost';
  } else if (ips.length === 1) {
    ip = ips[0].ip;
  } else {
    const escolha = await vscode.window.showQuickPick(
      ips.map(i => ({
        label: i.ip,
        description: i.nome,
        detail: i.preferido ? '⭐ Recomendado (rede física)' : '',
      })),
      { placeHolder: 'Escolha o IP que os alunos vão usar para conectar', ignoreFocusOut: true }
    );
    if (!escolha) return;
    ip = escolha.label;
  }

  const porta = 3456;
  servidor = await iniciarServidor(porta, senha);
  if (!servidor) {
    vscode.window.showErrorMessage(`Porta ${porta} já está em uso.`);
    return;
  }

  painelView?.webview.postMessage({
    tipo: 'sessao', ip, porta, senha,
    link: `IP: ${ip}  Porta: ${porta}  Senha: ${senha}`,
  });

  vscode.commands.executeCommand('setContext', 'quadroProfessor.ativo', true);
  enviarConteudo();

  // Debounce para transmissão em tempo real — espera 500ms após parar de digitar
  let debounceTimer = null;
  const enviarComDebounce = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { if (servidor) enviarConteudo(); }, 500);
  };

  const onSave   = vscode.workspace.onDidSaveTextDocument(() => { if (servidor) enviarConteudo(); });
  const onDigitar = vscode.workspace.onDidChangeTextDocument((e) => {
    // Ignora mudanças em documentos que não são de código (ex: output, terminal)
    if (e.document.uri.scheme !== 'file') return;
    // Atualiza ultimoEditor se o documento alterado bater com algum editor aberto
    const editorDoDoc = vscode.window.visibleTextEditors.find(ed => ed.document === e.document);
    if (editorDoDoc) ultimoEditor = editorDoDoc;
    if (servidor) enviarComDebounce();
  });
  const onTrocar = vscode.window.onDidChangeActiveTextEditor((ed) => {
    if (ed) ultimoEditor = ed;
    linhaDestacada = null;
    if (servidor) enviarConteudo();
  });
  const onCursor = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor) ultimoEditor = e.textEditor;
    if (!servidor || modoApagao || modoFreeze) return;
    const linha = e.selections[0].active.line;
    if (linha !== linhaDestacada) {
      linhaDestacada = linha;
      if (estadoAtual) estadoAtual.linhaDestacada = linha;
      painelView?.webview.postMessage({ tipo: 'destacar', linha });
    }
  });

  context.subscriptions.push(onSave, onDigitar, onTrocar, onCursor);
}

async function cmdEncerrar() {
  await pararServidor();
  modoApagao = false;
  modoFreeze = false;
  mostrarNumeros = true;
  linhaDestacada = null;
  estadoAtual = null;
  estadoFreezeAtual = null;
  painelView?.webview.postMessage({ tipo: 'encerrado' });
  vscode.commands.executeCommand('setContext', 'quadroProfessor.ativo', false);
  vscode.window.showInformationMessage('Transmissão encerrada.');
}

function transmitirTrecho() {
  const editor = vscode.window.activeTextEditor || ultimoEditor;
  if (!editor || !servidor) return;
  const sel = editor.selection;
  const conteudo = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
  const nome = editor.document.fileName.split(/[\\/]/).pop();
  const novoEstado = {
    conteudo, linguagem: editor.document.languageId,
    nomeArquivo: sel.isEmpty ? nome : `${nome} (L${sel.start.line+1}–L${sel.end.line+1})`,
    apagao: false, mostrarNumeros, linhaDestacada: null,
    timestamp: Date.now(),
  };
  estadoAtual = novoEstado;
  if (modoFreeze) estadoFreezeAtual = { ...novoEstado };
  painelView?.webview.postMessage({ tipo: 'atualizacao', ...novoEstado });
}

function activate(context) {
  const provider = new ProfessorViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('quadroProfessor.painel', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('quadroProfessor.iniciar', () => cmdIniciar(context)),
    vscode.commands.registerCommand('quadroProfessor.encerrar', cmdEncerrar),
    vscode.commands.registerCommand('quadroProfessor.trecho', transmitirTrecho),
  );
  vscode.commands.executeCommand('setContext', 'quadroProfessor.ativo', false);
}

function deactivate() { pararServidor(); }
module.exports = { activate, deactivate };

function getTokens() {
  const t = {
    python: {
      keyword: /\b(def|class|if|elif|else|for|while|in|not|and|or|return|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|None|True|False|global|nonlocal|del|assert|is)\b/g,
      builtin: /\b(print|len|range|int|str|float|list|dict|set|tuple|type|input|open|enumerate|zip|map|filter|sorted|reversed|min|max|sum|abs|round)\b/g,
      string:  /(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
      comment: /(#[^\n]*)/g,
      number:  /\b(\d+\.?\d*)\b/g,
      decorator: /(@\w+)/g,
    },
    javascript: {
      keyword: /\b(const|let|var|function|class|if|else|for|while|do|switch|case|break|continue|return|import|export|default|from|new|this|typeof|instanceof|in|of|async|await|try|catch|finally|throw|null|undefined|true|false)\b/g,
      builtin: /\b(console|Math|JSON|Array|Object|String|Number|Boolean|Promise|setTimeout|setInterval|fetch|document|window)\b/g,
      comment: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
      number:  /\b(\d+\.?\d*)\b/g,
    },
  };
  const out = {};
  for (const [lang, rules] of Object.entries(t)) {
    out[lang] = {};
    for (const [k, v] of Object.entries(rules)) out[lang][k] = v.source;
  }
  out.js = out.javascript; out.ts = out.javascript; out.py = out.python;
  return out;
}

function gerarHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:var(--vscode-sideBar-background);
  color:var(--vscode-sideBar-foreground);
  font-family:var(--vscode-font-family,sans-serif);
  font-size:13px; height:100vh; display:flex; flex-direction:column; overflow:hidden;
}

/* ── Tela inicial ── */
#tela-inicial {
  flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:16px; padding:24px; text-align:center;
}
#tela-inicial .emoji { font-size:48px; }
#tela-inicial p { font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.6; }
.btn-primario {
  background:var(--vscode-button-background); color:var(--vscode-button-foreground);
  border:none; border-radius:4px; padding:8px 20px; font-size:13px; cursor:pointer; width:100%;
  transition:opacity 0.15s;
}
.btn-primario:hover { opacity:0.85; }

/* ── Tela sessão ── */
#tela-sessao { flex:1; display:none; flex-direction:column; overflow:hidden; }

.sessao-header {
  padding:10px 12px; flex-shrink:0;
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,rgba(255,255,255,0.1));
  display:flex; flex-direction:column; gap:8px;
}
.badge-live { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--vscode-descriptionForeground); }
.dot-live { width:8px; height:8px; border-radius:50%; background:#2ea043; animation:pulsar 2s infinite; flex-shrink:0; }
.dot-freeze { width:8px; height:8px; border-radius:50%; background:#e8a838; flex-shrink:0; display:none; }
@keyframes pulsar { 0%,100%{opacity:1} 50%{opacity:.4} }
.info-row { display:flex; align-items:center; gap:6px; }
.info-label { font-size:11px; color:var(--vscode-descriptionForeground); min-width:44px; }
.info-valor {
  font-family:var(--vscode-editor-font-family,monospace); font-size:11px;
  background:var(--vscode-input-background); padding:2px 6px; border-radius:3px;
  flex:1; user-select:all; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

/* ── Temporizador ── */
.timer-section {
  padding:8px 12px; flex-shrink:0;
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,rgba(255,255,255,0.1));
  display:flex; flex-direction:column; gap:6px;
}
.timer-label { font-size:10px; color:var(--vscode-descriptionForeground); text-transform:uppercase; letter-spacing:0.05em; }
.timer-display {
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:28px; font-weight:700; text-align:center; letter-spacing:0.05em;
  color:var(--vscode-foreground);
  transition:color 0.3s;
}
.timer-display.urgente { color:#da3633; animation:piscar 1s infinite; }
@keyframes piscar { 0%,100%{opacity:1} 50%{opacity:.4} }
.timer-controls { display:flex; gap:4px; align-items:center; }
.timer-input {
  background:var(--vscode-input-background); color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent); border-radius:3px;
  padding:2px 6px; font-size:11px; width:60px; text-align:center;
}
.timer-input:focus { outline:1px solid var(--vscode-focusBorder); }

/* ── Controles ── */
.controles {
  padding:8px 12px; flex-shrink:0;
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,rgba(255,255,255,0.1));
  display:flex; flex-wrap:wrap; gap:4px;
}
.btn {
  background:transparent; border:1px solid transparent;
  color:var(--vscode-icon-foreground); border-radius:3px;
  padding:3px 7px; font-size:11px; cursor:pointer;
  display:flex; align-items:center; gap:3px; white-space:nowrap; transition:background 0.15s;
}
.btn:hover { background:var(--vscode-toolbar-hoverBackground); border-color:var(--vscode-panel-border); }
.btn.ativo { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }
.btn.freeze-ativo { background:#e8a838; color:#000; border-color:transparent; }
.btn.perigo:hover { background:var(--vscode-inputValidation-errorBackground,#3e1010); border-color:#f44; }

/* ── Info linha ── */
.info-linha {
  padding:3px 12px; font-size:11px; flex-shrink:0;
  background:var(--vscode-editorInfo-background,#1e3a5f);
  color:var(--vscode-editorInfo-foreground,#9cdcfe);
  display:none; align-items:center; gap:6px;
}
.info-linha.visivel { display:flex; }

/* ── Código ── */
#bloco-codigo { flex:1; overflow:auto; padding:8px 0; }
.linha-wrapper { display:flex; min-height:1.5em; transition:background 0.1s; }
.linha-wrapper:hover { background:var(--vscode-list-hoverBackground); }
.linha-wrapper.destacada {
  background:var(--vscode-editor-lineHighlightBackground,rgba(74,158,255,0.12)) !important;
  border-left:2px solid var(--vscode-focusBorder,#4a9eff);
}
.num-linha {
  min-width:32px; text-align:right; padding:0 8px 0 4px;
  color:var(--vscode-editorLineNumber-foreground,#6e7681);
  font-family:var(--vscode-editor-font-family,monospace);
  user-select:none; flex-shrink:0; font-size:12px; line-height:1.5em;
}
.num-linha.oculto { display:none; }
.conteudo-linha {
  flex:1; padding:0 8px 0 2px;
  font-family:var(--vscode-editor-font-family,'Cascadia Code',monospace);
  font-size:12px; line-height:1.5em; white-space:pre; overflow:visible;
}
.kw{color:#569cd6} .blt{color:#4ec9b0} .str{color:#ce9178}
.cmt{color:#6a9955;font-style:italic} .num{color:#b5cea8} .dec{color:#dcdcaa}

/* ── Overlay apagão ── */
#overlay-apagao {
  display:none; position:absolute; inset:0;
  background:var(--vscode-sideBar-background);
  align-items:center; justify-content:center; flex-direction:column; gap:8px; z-index:5;
}
#overlay-apagao.ativo { display:flex; }
#overlay-apagao p { font-size:12px; color:var(--vscode-descriptionForeground); }

/* ── Overlay freeze ── */
#overlay-freeze {
  display:none; position:absolute; inset:0;
  background:rgba(232,168,56,0.08);
  border:2px solid #e8a838;
  align-items:flex-start; justify-content:flex-end;
  padding:8px; z-index:4; pointer-events:none;
}
#overlay-freeze.ativo { display:flex; }
.freeze-badge {
  background:#e8a838; color:#000; font-size:10px; font-weight:700;
  padding:2px 8px; border-radius:3px; letter-spacing:0.05em;
}

.codigo-area { flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; }
</style>
</head>
<body>

<!-- Tela inicial -->
<div id="tela-inicial">
  <div class="emoji">📺</div>
  <p>Inicie uma transmissão para compartilhar seu código com os alunos em tempo real.</p>
  <button class="btn-primario" onclick="enviar('iniciar')">▶ Iniciar transmissão</button>
</div>

<!-- Tela sessão -->
<div id="tela-sessao">

  <!-- Header da sessão -->
  <div class="sessao-header">
    <div class="badge-live">
      <span class="dot-live" id="dot-live"></span>
      <span class="dot-freeze" id="dot-freeze"></span>
      <span id="txt-estado">Ao vivo</span>
      <span style="margin-left:auto;font-size:11px" id="txt-conexoes">0 aluno(s)</span>
    </div>
    <div class="info-row">
      <span class="info-label">Senha</span>
      <span class="info-valor" id="val-senha">—</span>
    </div>
    <div class="info-row">
      <span class="info-label">IP</span>
      <span class="info-valor" id="val-ip">—</span>
    </div>
    <button class="btn" style="width:100%;justify-content:center" onclick="copiarLink()">
      📋 Copiar dados para o chat
    </button>
  </div>

  <!-- Temporizador -->
  <div class="timer-section">
    <div class="timer-label">⏱ Temporizador</div>
    <div class="timer-display" id="timer-display">00:00</div>
    <div class="timer-controls">
      <input class="timer-input" id="timer-input" type="text" value="05:00" placeholder="MM:SS"
        title="Tempo inicial (MM:SS)">
      <button class="btn" onclick="timerAcao('iniciar')" id="btn-timer-play" title="Iniciar">▶</button>
      <button class="btn" onclick="timerAcao('pausar')" id="btn-timer-pause" title="Pausar" style="display:none">⏸</button>
      <button class="btn" onclick="timerAcao('resetar')" title="Resetar">↺</button>
    </div>
  </div>

  <!-- Controles -->
  <div class="controles">
    <button class="btn" id="btn-apagao" onclick="enviar('apagao')" title="Ocultar código">👁 Apagão</button>
    <button class="btn" id="btn-freeze" onclick="enviar('freeze')" title="Congelar tela dos alunos">🧊 Freeze</button>
    <button class="btn" onclick="enviar('trecho')" title="Transmitir trecho selecionado">✂️ Trecho</button>
    <button class="btn ativo" id="btn-numeros" onclick="enviar('numeros')" title="Números de linha">🔢</button>
    <button class="btn perigo" onclick="enviar('encerrar')" style="margin-left:auto" title="Encerrar sessão">⏹</button>
  </div>

  <!-- Info linha destacada -->
  <div class="info-linha" id="info-linha">
    <span>📍</span><strong id="texto-linha-dest">—</strong>
  </div>

  <!-- Código -->
  <div class="codigo-area">
    <div id="bloco-codigo"><div id="linhas"></div></div>
    <div id="overlay-apagao">
      <div style="font-size:36px">🙈</div>
      <p>Código oculto para os alunos</p>
    </div>
    <div id="overlay-freeze">
      <span class="freeze-badge">🧊 CONGELADO</span>
    </div>
  </div>
</div>

<script>
const vscodeApi = acquireVsCodeApi();
const TOKENS = ${JSON.stringify(getTokens())};
let linhasEls = [], numerosVisiveis = true;
let dadosSessao = {};

// ── Temporizador ──
let timerIntervalo = null;
let timerSegundos = 0;
let timerRodando = false;

function parseTempo(str) {
  const partes = str.split(':').map(Number);
  if (partes.length === 2) return partes[0] * 60 + partes[1];
  return partes[0] || 0;
}

function formatarTempo(s) {
  const m = Math.floor(s / 60), seg = s % 60;
  return String(m).padStart(2,'0') + ':' + String(seg).padStart(2,'0');
}

function timerAcao(acao) {
  const display = document.getElementById('timer-display');
  const btnPlay  = document.getElementById('btn-timer-play');
  const btnPause = document.getElementById('btn-timer-pause');

  if (acao === 'iniciar') {
    if (!timerRodando) {
      if (timerSegundos === 0) {
        timerSegundos = parseTempo(document.getElementById('timer-input').value);
      }
      timerRodando = true;
      btnPlay.style.display = 'none';
      btnPause.style.display = '';
      timerIntervalo = setInterval(() => {
        if (timerSegundos <= 0) {
          clearInterval(timerIntervalo);
          timerRodando = false;
          display.classList.add('urgente');
          btnPlay.style.display = '';
          btnPause.style.display = 'none';
          return;
        }
        timerSegundos--;
        display.textContent = formatarTempo(timerSegundos);
        if (timerSegundos <= 10) display.classList.add('urgente');
      }, 1000);
    }
  } else if (acao === 'pausar') {
    clearInterval(timerIntervalo);
    timerRodando = false;
    btnPlay.style.display = '';
    btnPause.style.display = 'none';
  } else if (acao === 'resetar') {
    clearInterval(timerIntervalo);
    timerRodando = false;
    timerSegundos = parseTempo(document.getElementById('timer-input').value);
    display.textContent = formatarTempo(timerSegundos);
    display.classList.remove('urgente');
    btnPlay.style.display = '';
    btnPause.style.display = 'none';
  }
}

// ── Highlight ──
function highlight(codigo, lang) {
  const regras = TOKENS[lang] || TOKENS.javascript;
  const CLASSES = { keyword:'kw', builtin:'blt', string:'str', comment:'cmt', number:'num', decorator:'dec' };
  const ordem = ['string','comment','decorator','keyword','builtin','number'];
  const regioes = [];
  ordem.forEach(tipo => {
    if (!regras[tipo]) return;
    const re = new RegExp(regras[tipo], 'g'); let m;
    while ((m = re.exec(codigo)) !== null) {
      const s = m.index, e = m.index + m[0].length;
      if (!regioes.some(r => s < r.e && e > r.s)) regioes.push({ s, e, cls: CLASSES[tipo], text: m[0] });
    }
  });
  regioes.sort((a,b) => a.s - b.s);
  const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let res = '', pos = 0;
  regioes.forEach(r => { res += esc(codigo.slice(pos, r.s)); res += '<span class="' + r.cls + '">' + esc(r.text) + '</span>'; pos = r.e; });
  return res + esc(codigo.slice(pos));
}

function enviar(tipo) { vscodeApi.postMessage({ tipo }); }

function copiarLink() {
  const texto = '📺 Quadro Digital\\nIP: ' + dadosSessao.ip + ':' + dadosSessao.porta + '\\nSenha: ' + dadosSessao.senha;
  vscodeApi.postMessage({ tipo: 'copiar-link', link: texto });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  switch(msg.tipo) {
    case 'sessao':
      dadosSessao = msg;
      document.getElementById('tela-inicial').style.display = 'none';
      document.getElementById('tela-sessao').style.display = 'flex';
      document.getElementById('val-senha').textContent = msg.senha;
      document.getElementById('val-ip').textContent = msg.ip + ':' + msg.porta;
      break;
    case 'encerrado':
      document.getElementById('tela-sessao').style.display = 'none';
      document.getElementById('tela-inicial').style.display = 'flex';
      document.getElementById('linhas').innerHTML = '';
      linhasEls = []; dadosSessao = {};
      timerAcao('resetar');
      break;
    case 'atualizacao': aplicarAtualizacao(msg); break;
    case 'destacar': destacarLinha(msg.linha); break;
    case 'apagao':
      document.getElementById('overlay-apagao').classList.toggle('ativo', msg.ativo);
      const bA = document.getElementById('btn-apagao');
      bA.classList.toggle('ativo', msg.ativo);
      bA.textContent = msg.ativo ? '👁 Mostrar' : '👁 Apagão';
      break;
    case 'freeze':
      document.getElementById('overlay-freeze').classList.toggle('ativo', msg.ativo);
      const bF = document.getElementById('btn-freeze');
      bF.classList.toggle('freeze-ativo', msg.ativo);
      bF.textContent = msg.ativo ? '🧊 Descongelar' : '🧊 Freeze';
      document.getElementById('dot-live').style.display = msg.ativo ? 'none' : '';
      document.getElementById('dot-freeze').style.display = msg.ativo ? '' : 'none';
      document.getElementById('txt-estado').textContent = msg.ativo ? 'Congelado' : 'Ao vivo';
      break;
    case 'numeros':
      numerosVisiveis = msg.ativo;
      document.querySelectorAll('.num-linha').forEach(el => el.classList.toggle('oculto', !numerosVisiveis));
      document.getElementById('btn-numeros').classList.toggle('ativo', numerosVisiveis);
      break;
    case 'conexoes':
      document.getElementById('txt-conexoes').textContent = msg.total + ' aluno(s)';
      break;
  }
});

function aplicarAtualizacao(dados) {
  if (dados.apagao !== undefined)
    document.getElementById('overlay-apagao').classList.toggle('ativo', dados.apagao);
  const linhas = (dados.conteudo || '').split('\\n');
  const codigoHL = highlight(dados.conteudo || '', dados.linguagem || 'plaintext');
  const linhasHL = codigoHL.split('\\n');
  const container = document.getElementById('linhas');
  container.innerHTML = ''; linhasEls = [];
  linhas.forEach((_, i) => {
    const w = document.createElement('div'); w.className = 'linha-wrapper';
    const n = document.createElement('span');
    n.className = 'num-linha' + (numerosVisiveis ? '' : ' oculto');
    n.textContent = i + 1;
    const c = document.createElement('span'); c.className = 'conteudo-linha';
    c.innerHTML = linhasHL[i] ?? '';
    w.appendChild(n); w.appendChild(c); container.appendChild(w); linhasEls.push(w);
  });
  if (dados.linhaDestacada !== null && dados.linhaDestacada !== undefined)
    destacarLinha(dados.linhaDestacada);
}

function destacarLinha(linha) {
  linhasEls.forEach(el => el.classList.remove('destacada'));
  const el = linhasEls[linha];
  if (!el) return;
  el.classList.add('destacada');
  const texto = el.querySelector('.conteudo-linha').textContent.trim();
  const infoEl = document.getElementById('info-linha');
  if (texto) {
    infoEl.classList.add('visivel');
    document.getElementById('texto-linha-dest').textContent = 'L'+(linha+1)+'  '+texto.slice(0,50)+(texto.length>50?'…':'');
  } else { infoEl.classList.remove('visivel'); }
  el.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

vscodeApi.postMessage({ tipo: 'pronto' });
</script>
</body>
</html>`;
}
