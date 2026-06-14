const vscode = require('vscode');
const http = require('http');

let pollingTimer = null;
let ultimoTimestamp = 0;
let conectado = false;
let ipAtual = '', senhaAtual = '';
const porta = 3456;
let alunoView = null;
let tentativasReconexao = 0;
const MAX_TENTATIVAS = 999; // reconecta indefinidamente

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${ipAtual}:${porta}${path}`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function testarConexao() {
  return httpGet('/ping').then(r => r.status === 200).catch(() => false);
}

function pararPolling() {
  if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
}

function iniciarPolling() {
  pararPolling();
  tentativasReconexao = 0;
  buscarEstado();
  pollingTimer = setInterval(buscarEstado, 1500);
}

async function buscarEstado() {
  try {
    const r = await httpGet(`/estado?senha=${encodeURIComponent(senhaAtual)}&nome=Aluno`);

    if (r.status === 401) {
      pararPolling();
      alunoView?.webview.postMessage({ tipo: 'erro', msg: 'Senha incorreta.' });
      vscode.commands.executeCommand('setContext', 'quadroAluno.conectado', false);
      return;
    }

    if (r.status !== 200) throw new Error('status ' + r.status);

    const dados = r.body;

    if (!conectado) {
      conectado = true;
      tentativasReconexao = 0;
      alunoView?.webview.postMessage({ tipo: 'conectado' });
      vscode.commands.executeCommand('setContext', 'quadroAluno.conectado', true);
    }

    if (dados.timestamp !== ultimoTimestamp) {
      ultimoTimestamp = dados.timestamp;
      alunoView?.webview.postMessage({ tipo: 'atualizacao', ...dados });
    }

  } catch {
    if (conectado) {
      conectado = false;
      tentativasReconexao = 0;
      alunoView?.webview.postMessage({ tipo: 'reconectando' });
    } else {
      tentativasReconexao++;
      // Avisa progresso da reconexão a cada 5 tentativas
      if (tentativasReconexao % 5 === 0) {
        alunoView?.webview.postMessage({
          tipo: 'reconectando',
          tentativa: tentativasReconexao,
        });
      }
    }
  }
}

class AlunoViewProvider {
  resolveWebviewView(webviewView) {
    alunoView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = gerarHTML();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.tipo) {
        case 'pronto':
          if (pollingTimer) buscarEstado();
          break;
        case 'conectar':
          await cmdConectar();
          break;
        case 'desconectar':
          cmdDesconectar();
          break;
      }
    });
  }
}

async function cmdConectar() {
  const ip = await vscode.window.showInputBox({
    prompt: 'IP do professor',
    placeHolder: 'ex: 192.168.1.42',
    ignoreFocusOut: true,
  });
  if (!ip) return;

  const senha = await vscode.window.showInputBox({
    prompt: 'Senha da sessão',
    ignoreFocusOut: true,
  });
  if (!senha) return;

  ipAtual = ip.trim();
  senhaAtual = senha.trim();
  ultimoTimestamp = 0;
  conectado = false;

  alunoView?.webview.postMessage({ tipo: 'tentando', ip: ipAtual });

  const ok = await testarConexao();
  if (!ok) {
    alunoView?.webview.postMessage({
      tipo: 'erro',
      msg: `Não foi possível conectar em ${ipAtual}:${porta}.\nVerifique o IP e se o professor iniciou a sessão.`,
    });
    return;
  }

  iniciarPolling();
}

function cmdDesconectar() {
  pararPolling();
  conectado = false;
  ultimoTimestamp = 0;
  alunoView?.webview.postMessage({ tipo: 'desconectado-manual' });
  vscode.commands.executeCommand('setContext', 'quadroAluno.conectado', false);
}

// ── Conexão silenciosa para automação via Veyon ──
// Uso no Veyon: code --command quadroAluno.conectarDireto --args "[\"IP\",\"SENHA\"]"
async function cmdConectarDireto(ip, senha) {
  if (!ip || !senha) {
    vscode.window.showErrorMessage('Quadro Aluno: IP e senha são obrigatórios para conexão direta.');
    return;
  }

  ipAtual = String(ip).trim();
  senhaAtual = String(senha).trim();
  ultimoTimestamp = 0;
  conectado = false;

  // Abre o painel lateral automaticamente
  vscode.commands.executeCommand('quadroAluno.painel.focus');

  // Aguarda o painel abrir antes de tentar conectar
  setTimeout(async () => {
    alunoView?.webview.postMessage({ tipo: 'tentando', ip: ipAtual });

    const ok = await testarConexao();
    if (!ok) {
      alunoView?.webview.postMessage({
        tipo: 'erro',
        msg: 'Não foi possível conectar em ' + ipAtual + ':' + porta + '.\nVerifique se o professor iniciou a sessão.',
      });
      return;
    }

    iniciarPolling();
  }, 800);
}

function activate(context) {
  const provider = new AlunoViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('quadroAluno.painel', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('quadroAluno.conectar', cmdConectar),
    vscode.commands.registerCommand('quadroAluno.desconectar', cmdDesconectar),
    vscode.commands.registerCommand('quadroAluno.conectarDireto', cmdConectarDireto),
  );
  vscode.commands.executeCommand('setContext', 'quadroAluno.conectado', false);
}

function deactivate() { pararPolling(); }
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

/* ── Telas de estado ── */
.tela {
  flex:1; display:none; flex-direction:column;
  align-items:center; justify-content:center; gap:16px; padding:24px; text-align:center;
}
.tela.ativa { display:flex; }
.tela .emoji { font-size:48px; }
.tela p { font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.6; white-space:pre-line; }
.btn-primario {
  background:var(--vscode-button-background); color:var(--vscode-button-foreground);
  border:none; border-radius:4px; padding:8px 20px; font-size:13px; cursor:pointer; width:100%;
  transition:opacity 0.15s;
}
.btn-primario:hover { opacity:0.85; }
.spinner {
  width:24px; height:24px; border:2px solid var(--vscode-panel-border);
  border-top-color:var(--vscode-focusBorder); border-radius:50%;
  animation:spin 0.8s linear infinite;
}
@keyframes spin { to { transform:rotate(360deg); } }

/* ── Tela ao vivo ── */
#tela-aovivo { flex:1; display:none; flex-direction:column; overflow:hidden; }

.aovivo-header {
  padding:6px 12px; flex-shrink:0; display:flex; align-items:center; gap:6px;
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,rgba(255,255,255,0.1));
}
.dot { width:7px; height:7px; border-radius:50%; background:#f44; transition:background 0.3s; flex-shrink:0; }
.dot.ativo { background:#2ea043; animation:pulsar 2s infinite; }
.dot.reconectando { background:#e8a838; animation:piscar 1s infinite; }
@keyframes pulsar { 0%,100%{opacity:1} 50%{opacity:.4} }
@keyframes piscar { 0%,100%{opacity:1} 50%{opacity:.3} }

.nome-arquivo {
  flex:1; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  margin-left:4px;
}
.badge-lang {
  font-size:10px; padding:1px 6px; border-radius:8px;
  background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);
}

/* ── Toolbar do aluno ── */
.aluno-toolbar {
  padding:4px 8px; flex-shrink:0; display:flex; align-items:center; gap:4px;
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,rgba(255,255,255,0.1));
}
.btn {
  background:transparent; border:1px solid transparent;
  color:var(--vscode-icon-foreground); border-radius:3px;
  padding:2px 6px; font-size:11px; cursor:pointer; white-space:nowrap;
  transition:background 0.15s;
}
.btn:hover { background:var(--vscode-toolbar-hoverBackground); border-color:var(--vscode-panel-border); }
.btn.desconectar:hover { background:var(--vscode-inputValidation-errorBackground,#3e1010); border-color:#f44; }
#label-fonte-aluno {
  font-size:11px; color:var(--vscode-descriptionForeground);
  min-width:28px; text-align:center;
}

/* ── Info linha ── */
.info-linha {
  padding:3px 12px; font-size:11px; flex-shrink:0;
  background:var(--vscode-editorInfo-background,#1e3a5f);
  color:var(--vscode-editorInfo-foreground,#9cdcfe);
  display:none; align-items:center; gap:6px;
}
.info-linha.visivel { display:flex; }

/* ── Código ── */
#bloco-codigo { flex:1; overflow:auto; padding:6px 0; }
.linha-wrapper { display:flex; min-height:1.5em; }
.linha-wrapper.destacada {
  background:var(--vscode-editor-lineHighlightBackground,rgba(74,158,255,0.12)) !important;
  border-left:2px solid var(--vscode-focusBorder,#4a9eff);
}
.num-linha {
  min-width:30px; text-align:right; padding:0 6px 0 4px;
  color:var(--vscode-editorLineNumber-foreground,#6e7681);
  font-family:var(--vscode-editor-font-family,monospace);
  user-select:none; flex-shrink:0; line-height:1.5em;
}
.num-linha.oculto { display:none; }
.conteudo-linha {
  flex:1; padding:0 6px 0 2px;
  font-family:var(--vscode-editor-font-family,'Cascadia Code',monospace);
  line-height:1.5em; white-space:pre; overflow:visible;
}
.kw{color:#569cd6} .blt{color:#4ec9b0} .str{color:#ce9178}
.cmt{color:#6a9955;font-style:italic} .num{color:#b5cea8} .dec{color:#dcdcaa}

#overlay-apagao {
  display:none; position:absolute; inset:0;
  background:var(--vscode-sideBar-background);
  align-items:center; justify-content:center; flex-direction:column; gap:8px; z-index:5;
}
#overlay-apagao.ativo { display:flex; }
#overlay-apagao p { font-size:12px; color:var(--vscode-descriptionForeground); }
.codigo-area { flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; }

#toast {
  position:fixed; bottom:8px; right:8px;
  background:var(--vscode-notificationCenterHeader-background,#252526);
  color:var(--vscode-notificationCenterHeader-foreground,#ccc);
  border:1px solid var(--vscode-panel-border);
  padding:4px 10px; border-radius:3px; font-size:11px;
  opacity:0; transition:opacity 0.2s; pointer-events:none;
}
#toast.visivel { opacity:1; }
</style>
</head>
<body>

<!-- Tela inicial -->
<div id="tela-inicial" class="tela ativa">
  <div class="emoji">📺</div>
  <p>Conecte-se ao professor para ver o código em tempo real.</p>
  <button class="btn-primario" onclick="enviar('conectar')">🔌 Conectar ao professor</button>
</div>

<!-- Tela tentando -->
<div id="tela-tentando" class="tela">
  <div class="spinner"></div>
  <p id="txt-tentando">Conectando...</p>
</div>

<!-- Tela erro -->
<div id="tela-erro" class="tela">
  <div class="emoji">❌</div>
  <p id="txt-erro">Erro de conexão</p>
  <button class="btn-primario" onclick="ir('tela-inicial')">↩ Tentar novamente</button>
</div>

<!-- Tela reconectando (sobreposta ao código) -->
<div id="tela-aovivo">
  <div class="aovivo-header">
    <span class="dot" id="dot-status"></span>
    <span class="nome-arquivo" id="nome-arquivo">—</span>
    <span class="badge-lang" id="badge-lang">—</span>
  </div>

  <!-- Toolbar local do aluno -->
  <div class="aluno-toolbar">
    <span style="font-size:10px;color:var(--vscode-descriptionForeground)">Fonte:</span>
    <button class="btn" onclick="alterarFonte(-2)">A−</button>
    <span id="label-fonte-aluno">12px</span>
    <button class="btn" onclick="alterarFonte(2)">A+</button>
    <button class="btn desconectar" style="margin-left:auto" onclick="enviar('desconectar')" title="Desconectar">⏏ Sair</button>
  </div>

  <div class="info-linha" id="info-linha">
    <span>📍 Professor:</span>
    <strong id="texto-linha-dest" style="font-size:11px">—</strong>
  </div>

  <div class="codigo-area">
    <div id="bloco-codigo"><div id="linhas"></div></div>
    <div id="overlay-apagao">
      <div style="font-size:36px">🙈</div>
      <p>Código oculto pelo professor</p>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
const vscodeApi = acquireVsCodeApi();
const TOKENS = ${JSON.stringify(getTokens())};
let linhasEls = [], numerosVisiveis = true;
let fontAluno = 12; // fonte local do aluno, independente do professor

function enviar(tipo) { vscodeApi.postMessage({ tipo }); }

function ir(tela) {
  ['tela-inicial','tela-tentando','tela-erro'].forEach(id => {
    document.getElementById(id).classList.toggle('ativa', id === tela);
  });
  document.getElementById('tela-aovivo').style.display = 'none';
  if (tela === 'tela-aovivo') {
    document.getElementById('tela-aovivo').style.display = 'flex';
    ['tela-inicial','tela-tentando','tela-erro'].forEach(id =>
      document.getElementById(id).classList.remove('ativa')
    );
  }
}

function alterarFonte(delta) {
  fontAluno = Math.max(10, Math.min(32, fontAluno + delta));
  document.getElementById('label-fonte-aluno').textContent = fontAluno + 'px';
  document.querySelectorAll('.conteudo-linha, .num-linha').forEach(el => {
    el.style.fontSize = fontAluno + 'px';
    el.style.lineHeight = (fontAluno * 1.5) + 'px';
  });
}

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

window.addEventListener('message', (e) => {
  const msg = e.data;
  switch(msg.tipo) {
    case 'tentando':
      ir('tela-tentando');
      document.getElementById('txt-tentando').textContent = 'Conectando a ' + msg.ip + '...';
      break;
    case 'conectado':
      ir('tela-aovivo');
      document.getElementById('dot-status').className = 'dot ativo';
      break;
    case 'reconectando':
      document.getElementById('dot-status').className = 'dot reconectando';
      // Mantém o código visível, só muda o dot
      break;
    case 'desconectado-manual':
      ir('tela-inicial');
      document.getElementById('linhas').innerHTML = '';
      linhasEls = [];
      break;
    case 'erro':
      ir('tela-erro');
      document.getElementById('txt-erro').textContent = msg.msg;
      break;
    case 'atualizacao':
      document.getElementById('dot-status').className = 'dot ativo';
      aplicarAtualizacao(msg);
      break;
    case 'apagao':
      document.getElementById('overlay-apagao').classList.toggle('ativo', msg.ativo);
      break;
  }
});

function aplicarAtualizacao(dados) {
  document.getElementById('nome-arquivo').textContent = dados.nomeArquivo || '—';
  document.getElementById('badge-lang').textContent = dados.linguagem || '—';
  document.getElementById('overlay-apagao').classList.toggle('ativo', !!dados.apagao);
  if (dados.mostrarNumeros !== undefined) numerosVisiveis = dados.mostrarNumeros;

  const linhas = (dados.conteudo || '').split('\\n');
  const codigoHL = highlight(dados.conteudo || '', dados.linguagem || 'plaintext');
  const linhasHL = codigoHL.split('\\n');
  const container = document.getElementById('linhas');
  container.innerHTML = ''; linhasEls = [];

  linhas.forEach((_, i) => {
    const w = document.createElement('div'); w.className = 'linha-wrapper';
    const n = document.createElement('span');
    n.className = 'num-linha' + (numerosVisiveis ? '' : ' oculto');
    n.style.fontSize = fontAluno + 'px';
    n.style.lineHeight = (fontAluno * 1.5) + 'px';
    n.textContent = i + 1;
    const c = document.createElement('span'); c.className = 'conteudo-linha';
    c.style.fontSize = fontAluno + 'px';
    c.style.lineHeight = (fontAluno * 1.5) + 'px';
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
    document.getElementById('texto-linha-dest').textContent =
      'L'+(linha+1)+'  '+texto.slice(0,50)+(texto.length>50?'…':'');
  } else { infoEl.classList.remove('visivel'); }
  el.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

document.addEventListener('copy', () => {
  const t = document.getElementById('toast');
  t.textContent = '✓ Copiado!'; t.classList.add('visivel');
  setTimeout(() => t.classList.remove('visivel'), 1600);
});

vscodeApi.postMessage({ tipo: 'pronto' });
</script>
</body>
</html>`;
}
