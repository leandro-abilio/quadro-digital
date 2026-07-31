const vscode = require('vscode');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Firebase Realtime Database (relay) ──
// Alternativa que funciona em qualquer rede que libere HTTPS (porta 443) —
// não depende de porta de túnel dedicada (ex: 7844, bloqueada pelo Fortinet da escola).
// Projeto compartilhado embutido para quem escolher "Salas Públicas" sem configurar nada.
const SALAS_PUBLICAS_URL = 'https://quadro-digital-dds-default-rtdb.firebaseio.com';
const INTERVALO_HEARTBEAT_PUBLICO = 5000;
const VALIDADE_SALA_PUBLICA = 15000; // ms sem heartbeat até a sala sumir da lista (ver quadro-aluno)

function firebaseRequest(url, method, corpo) {
  return new Promise((resolve, reject) => {
    const dados = corpo !== undefined ? JSON.stringify(corpo) : undefined;
    const opcoes = {
      method,
      headers: dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {},
      timeout: 5000,
    };
    const req = https.request(url, opcoes, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao conectar no Firebase')); });
    if (dados) req.write(dados);
    req.end();
  });
}

// Testa dentro de /salas/{sala}, não na raiz — as regras recomendadas bloqueiam
// a raiz de propósito e só liberam leitura/escrita dentro de /salas/* e /salas_publicas/*.
async function testarFirebase(baseUrl, sala) {
  const r = await firebaseRequest(`${baseUrl}/salas/${encodeURIComponent(sala)}.json`, 'GET');
  if (r.status !== 200) throw new Error('Não foi possível acessar o Firebase (verifique a URL e as regras do Realtime Database).');
}

function enviarParaFirebase(baseUrl, sala, estado) {
  firebaseRequest(`${baseUrl}/salas/${encodeURIComponent(sala)}.json`, 'PUT', estado).catch(() => {});
}

function limparFirebase(baseUrl, sala) {
  return firebaseRequest(`${baseUrl}/salas/${encodeURIComponent(sala)}.json`, 'DELETE').catch(() => {});
}

// ── Listagem de salas públicas ──
function registrarSalaPublica(baseUrl, sala, nome) {
  return firebaseRequest(`${baseUrl}/salas_publicas/${encodeURIComponent(sala)}.json`, 'PUT', {
    nome, criadaEm: Date.now(), timestamp: Date.now(),
  });
}

function atualizarHeartbeatPublico(baseUrl, sala, nome) {
  firebaseRequest(`${baseUrl}/salas_publicas/${encodeURIComponent(sala)}.json`, 'PUT', {
    nome, timestamp: Date.now(),
  }).catch(() => {});
}

function removerSalaPublica(baseUrl, sala) {
  return firebaseRequest(`${baseUrl}/salas_publicas/${encodeURIComponent(sala)}.json`, 'DELETE').catch(() => {});
}

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
let modoAtual = null; // 'local' | 'firebase'
let firebaseUrlAtual = null;
let salaFirebaseAtual = null;
let salaPublicaNome = null; // nome de exibição, só quando a sala é pública
let heartbeatPublicoTimer = null;
const clientesAtivos = new Map();
const TIMEOUT_CLIENTE = 5000;

// Uma sessão está ativa tanto no modo com servidor local (rede local)
// quanto no modo Firebase, que não abre nenhum servidor local.
function sessaoAtiva() { return !!servidor || modoAtual === 'firebase'; }

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

      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        // Página web para alunos acessarem pelo navegador
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(gerarPaginaWeb(senha));

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

// Publica o estado no painel do professor e, no modo Firebase, também no relay.
function publicarEstado(estado) {
  painelView?.webview.postMessage({ tipo: 'atualizacao', ...estado });
  if (modoAtual === 'firebase' && firebaseUrlAtual && salaFirebaseAtual) {
    enviarParaFirebase(firebaseUrlAtual, salaFirebaseAtual, estado);
  }
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
  publicarEstado(estadoAtual);
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
          if (sessaoAtiva()) enviarConteudo();
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

    if (sessaoAtiva()) enviarConteudo();
  }
}

// ── Comandos ──
async function cmdIniciar(context) {
  if (vscode.window.activeTextEditor) ultimoEditor = vscode.window.activeTextEditor;

  if (sessaoAtiva()) {
    vscode.window.showInformationMessage('Transmissão já está ativa!');
    return;
  }

  // ── Escolhe o modo de conexão ──
  const modo = await vscode.window.showQuickPick([
    {
      label: '$(flame) Firebase (nuvem)',
      description: 'Funciona em qualquer rede que libere HTTPS (porta 443) — inclusive com o Fortinet da escola',
      detail: 'Use seu próprio projeto Firebase ou o compartilhado (Salas Públicas), sem configuração',
      value: 'firebase',
    },
    {
      label: '$(broadcast) Rede local',
      description: 'Professor e alunos na mesma rede Wi-Fi/Ethernet',
      detail: 'Mais rápido — requer que a rede permita comunicação entre máquinas',
      value: 'local',
    },
  ], { placeHolder: 'Como os alunos vão se conectar?', ignoreFocusOut: true });
  if (!modo) return;

  if (modo.value === 'firebase') {
    await cmdIniciarFirebase(context);
    return;
  }

  const senha = await vscode.window.showInputBox({
    prompt: 'Senha para a sessão',
    value: gerarSenha(),
    ignoreFocusOut: true,
  });
  if (!senha) return;

  const porta = 3456;
  servidor = await iniciarServidor(porta, senha);
  if (!servidor) {
    vscode.window.showErrorMessage(`Porta ${porta} já está em uso.`);
    return;
  }

  // ── Modo rede local ──
  let enderecoConexao, linkExibido;
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
    if (!escolha) { pararServidor(); return; }
    ip = escolha.label;
  }
  enderecoConexao = { ip, porta };
  linkExibido = `IP: ${ip}  Porta: ${porta}  Senha: ${senha}`;

  painelView?.webview.postMessage({
    tipo: 'sessao',
    ip: enderecoConexao.ip,
    porta: enderecoConexao.porta,
    senha,
    link: linkExibido,
  });

  vscode.commands.executeCommand('setContext', 'quadroProfessor.ativo', true);
  enviarConteudo();
  registrarListenersEdicao(context);
}

// ── Modo Firebase (relay via Realtime Database) ──
async function cmdIniciarFirebase(context) {
  // ── Escolhe entre o projeto próprio do professor ou o compartilhado (Salas Públicas) ──
  const projeto = await vscode.window.showQuickPick([
    {
      label: '$(globe) Salas Públicas (compartilhado)',
      description: 'Sem configuração — usa um projeto Firebase já embutido na extensão',
      value: 'compartilhado',
    },
    {
      label: '$(key) Meu Firebase',
      description: 'Use seu próprio projeto Firebase (Realtime Database)',
      value: 'proprio',
    },
  ], { placeHolder: 'Qual Firebase usar?', ignoreFocusOut: true });
  if (!projeto) return;

  let firebaseUrl;
  if (projeto.value === 'compartilhado') {
    firebaseUrl = SALAS_PUBLICAS_URL;
  } else {
    firebaseUrl = context.globalState.get('quadroProfessor.firebaseUrl', '');
    firebaseUrl = await vscode.window.showInputBox({
      prompt: 'URL do Realtime Database (ex: https://meu-projeto-default-rtdb.firebaseio.com)',
      value: firebaseUrl,
      ignoreFocusOut: true,
      validateInput: (v) => /^https:\/\/[^ ]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(v.trim())
        ? null : 'Informe a URL do Realtime Database (termina em .firebaseio.com ou .firebasedatabase.app)',
    });
    if (!firebaseUrl) return;
    firebaseUrl = firebaseUrl.trim().replace(/\/$/, '');
    await context.globalState.update('quadroProfessor.firebaseUrl', firebaseUrl);
  }

  // ── Pública (aparece na lista de Salas Públicas) ou privada (sala/senha) ──
  const visibilidade = await vscode.window.showQuickPick([
    {
      label: '$(lock) Privada',
      description: 'Só entra quem tiver a sala/senha — não aparece em nenhuma lista',
      value: 'privada',
    },
    {
      label: '$(broadcast) Pública',
      description: 'Aparece com um nome na lista de "Salas Públicas" para qualquer aluno',
      value: 'publica',
    },
  ], { placeHolder: 'Essa sala é pública ou privada?', ignoreFocusOut: true });
  if (!visibilidade) return;

  let nomePublico = null;
  if (visibilidade.value === 'publica') {
    nomePublico = await vscode.window.showInputBox({
      prompt: 'Nome de exibição da sala (ex: "Turma 9 - Matemática")',
      ignoreFocusOut: true,
      validateInput: (v) => v.trim() ? null : 'Informe um nome para a sala',
    });
    if (!nomePublico) return;
    nomePublico = nomePublico.trim();
  }

  const sala = gerarSenha();

  painelView?.webview.postMessage({ tipo: 'carregando', msg: 'Testando conexão com o Firebase...' });
  try {
    await testarFirebase(firebaseUrl, sala);
  } catch (err) {
    painelView?.webview.postMessage({ tipo: 'carregando-fim' });
    vscode.window.showErrorMessage('Falha ao acessar Firebase: ' + err.message);
    return;
  }
  painelView?.webview.postMessage({ tipo: 'carregando-fim' });

  modoAtual = 'firebase';
  firebaseUrlAtual = firebaseUrl;
  salaFirebaseAtual = sala;
  salaPublicaNome = nomePublico;

  if (nomePublico) {
    await registrarSalaPublica(firebaseUrl, sala, nomePublico);
    heartbeatPublicoTimer = setInterval(
      () => atualizarHeartbeatPublico(firebaseUrl, sala, nomePublico),
      INTERVALO_HEARTBEAT_PUBLICO
    );
  }

  painelView?.webview.postMessage({
    tipo: 'sessao',
    ip: firebaseUrl,
    porta: null,
    servico: 'firebase',
    url: firebaseUrl,
    senha: sala,
    publica: !!nomePublico,
    nomePublico,
    link: nomePublico
      ? `Sala pública: ${nomePublico}`
      : `Firebase: ${firebaseUrl}  Sala/Senha: ${sala}`,
  });

  vscode.commands.executeCommand('setContext', 'quadroProfessor.ativo', true);
  enviarConteudo();
  registrarListenersEdicao(context);
}

// Debounce + listeners de edição do editor — compartilhado entre todos os modos.
function registrarListenersEdicao(context) {
  let debounceTimer = null;
  const enviarComDebounce = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { if (sessaoAtiva()) enviarConteudo(); }, 500);
  };

  const onSave   = vscode.workspace.onDidSaveTextDocument(() => { if (sessaoAtiva()) enviarConteudo(); });
  const onDigitar = vscode.workspace.onDidChangeTextDocument((e) => {
    // Ignora mudanças em documentos que não são de código (ex: output, terminal)
    if (e.document.uri.scheme !== 'file') return;
    // Atualiza ultimoEditor se o documento alterado bater com algum editor aberto
    const editorDoDoc = vscode.window.visibleTextEditors.find(ed => ed.document === e.document);
    if (editorDoDoc) ultimoEditor = editorDoDoc;
    if (sessaoAtiva()) enviarComDebounce();
  });
  const onTrocar = vscode.window.onDidChangeActiveTextEditor((ed) => {
    if (ed) ultimoEditor = ed;
    linhaDestacada = null;
    if (sessaoAtiva()) enviarConteudo();
  });
  const onCursor = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (e.textEditor) ultimoEditor = e.textEditor;
    if (!sessaoAtiva() || modoApagao || modoFreeze) return;
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
  if (heartbeatPublicoTimer) { clearInterval(heartbeatPublicoTimer); heartbeatPublicoTimer = null; }
  if (modoAtual === 'firebase' && firebaseUrlAtual && salaFirebaseAtual) {
    await limparFirebase(firebaseUrlAtual, salaFirebaseAtual);
    if (salaPublicaNome) await removerSalaPublica(firebaseUrlAtual, salaFirebaseAtual);
  }
  modoAtual = null;
  firebaseUrlAtual = null;
  salaFirebaseAtual = null;
  salaPublicaNome = null;
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
  if (!editor || !sessaoAtiva()) return;
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
  publicarEstado(novoEstado);
}

// ── Página web para alunos acessarem pelo navegador ──
function gerarPaginaWeb(senha) {
  const tokens = getTokens();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📺 Quadro Digital</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }

  :root {
    --bg: #0d1117; --bg2: #161b22; --borda: #30363d;
    --texto: #e6edf3; --muted: #8b949e;
    --azul: #58a6ff; --verde: #2ea043; --laranja: #e8a838;
  }

  body {
    background:var(--bg); color:var(--texto);
    font-family:'Segoe UI',system-ui,sans-serif;
    height:100vh; display:flex; flex-direction:column; overflow:hidden;
  }

  /* ── Header ── */
  header {
    background:var(--bg2); border-bottom:1px solid var(--borda);
    padding:8px 16px; display:flex; align-items:center; gap:10px; flex-shrink:0;
  }
  .header-titulo { font-size:13px; font-weight:600; flex:1; }
  .badge-status {
    display:flex; align-items:center; gap:6px; font-size:11px; color:var(--muted);
    padding:3px 10px; border:1px solid var(--borda); border-radius:12px;
  }
  .dot { width:7px; height:7px; border-radius:50%; background:#f44; transition:background 0.3s; }
  .dot.ativo { background:var(--verde); animation:pulsar 2s infinite; }
  .dot.reconectando { background:var(--laranja); animation:piscar 1s infinite; }
  @keyframes pulsar { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes piscar { 0%,100%{opacity:1} 50%{opacity:.3} }
  .badge-lang {
    font-size:11px; padding:2px 8px; border-radius:10px;
    background:#21262d; color:var(--azul);
  }

  /* ── Toolbar do aluno ── */
  .toolbar {
    background:var(--bg2); border-bottom:1px solid var(--borda);
    padding:4px 12px; display:flex; align-items:center; gap:6px; flex-shrink:0;
  }
  .btn {
    background:transparent; border:1px solid transparent; color:var(--muted);
    border-radius:4px; padding:3px 8px; font-size:12px; cursor:pointer;
    transition:background 0.15s;
  }
  .btn:hover { background:#21262d; border-color:var(--borda); color:var(--texto); }
  #label-fonte { font-size:11px; color:var(--muted); min-width:30px; text-align:center; }

  /* ── Info linha ── */
  .info-linha {
    background:#1e3a5f; border-bottom:1px solid var(--borda);
    padding:3px 16px; font-size:11px; color:#9cdcfe;
    display:none; align-items:center; gap:8px; flex-shrink:0;
  }
  .info-linha.visivel { display:flex; }

  /* ── Código ── */
  main { flex:1; overflow:auto; padding:12px 0; position:relative; }

  .linha-wrapper { display:flex; min-height:1.6em; }
  .linha-wrapper:hover { background:rgba(255,255,255,0.03); }
  .linha-wrapper.destacada {
    background:rgba(88,166,255,0.1) !important;
    border-left:3px solid var(--azul);
  }
  .num-linha {
    min-width:48px; text-align:right; padding:0 14px 0 8px;
    color:#484f58; font-family:'Cascadia Code','Consolas',monospace;
    user-select:none; flex-shrink:0; font-size:13px; line-height:1.6em;
  }
  .num-linha.oculto { display:none; }
  .conteudo-linha {
    flex:1; padding:0 16px 0 4px;
    font-family:'Cascadia Code','Consolas','Courier New',monospace;
    font-size:13px; line-height:1.6em; white-space:pre; overflow:visible;
  }
  .kw{color:#79c0ff} .blt{color:#56d364} .str{color:#a5d6ff}
  .cmt{color:#8b949e;font-style:italic} .num{color:#f2cc60} .dec{color:#d2a8ff}

  /* ── Overlay apagão ── */
  #overlay-apagao {
    display:none; position:absolute; inset:0;
    background:var(--bg); align-items:center; justify-content:center;
    flex-direction:column; gap:12px; z-index:5;
  }
  #overlay-apagao.ativo { display:flex; }
  #overlay-apagao p { font-size:14px; color:var(--muted); }

  /* ── Toast ── */
  #toast {
    position:fixed; bottom:20px; right:16px;
    background:#21262d; color:var(--texto);
    border:1px solid var(--borda); padding:6px 14px;
    border-radius:6px; font-size:12px;
    opacity:0; transition:opacity 0.2s, transform 0.2s; transform:translateY(6px);
    pointer-events:none;
  }
  #toast.visivel { opacity:1; transform:translateY(0); }

  /* ── Footer ── */
  footer {
    background:var(--bg2); border-top:1px solid var(--borda);
    padding:3px 16px; font-size:11px; color:var(--muted);
    display:flex; justify-content:space-between; flex-shrink:0;
  }

  /* ── Tela de senha ── */
  #tela-senha {
    flex:1; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:16px; padding:32px;
    text-align:center;
  }
  #tela-senha .emoji { font-size:48px; }
  #tela-senha p { font-size:13px; color:var(--muted); }
  .input-senha {
    background:#21262d; color:var(--texto);
    border:1px solid var(--borda); border-radius:6px;
    padding:8px 14px; font-size:14px; width:220px; text-align:center;
    outline:none;
  }
  .input-senha:focus { border-color:var(--azul); }
  .btn-entrar {
    background:var(--verde); color:#fff; border:none;
    border-radius:6px; padding:8px 24px; font-size:14px;
    cursor:pointer; font-weight:600; transition:opacity 0.15s;
  }
  .btn-entrar:hover { opacity:0.85; }
  .erro-senha { font-size:12px; color:#f85149; display:none; }
</style>
</head>
<body>

<!-- Tela de senha -->
<div id="tela-senha">
  <div class="emoji">📺</div>
  <p>Digite a senha da sessão para ver o código do professor</p>
  <input class="input-senha" id="input-senha" type="text"
    placeholder="ex: gato-casa-azul"
    onkeydown="if(event.key==='Enter') entrar()">
  <button class="btn-entrar" onclick="entrar()">Entrar</button>
  <span class="erro-senha" id="erro-senha">Senha incorreta. Tente novamente.</span>
</div>

<!-- Interface principal (oculta até autenticar) -->
<div id="interface" style="display:none;flex:1;flex-direction:column;overflow:hidden">
  <header>
    <span>📺</span>
    <span class="header-titulo" id="nome-arquivo">Conectando...</span>
    <span class="badge-lang" id="badge-lang">—</span>
    <div class="badge-status">
      <span class="dot" id="dot-status"></span>
      <span id="txt-status">Conectando</span>
    </div>
  </header>

  <div class="toolbar">
    <span style="font-size:11px;color:var(--muted)">Fonte:</span>
    <button class="btn" onclick="alterarFonte(-1)">A−</button>
    <span id="label-fonte">13px</span>
    <button class="btn" onclick="alterarFonte(1)">A+</button>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)" id="txt-atualizacoes">—</span>
  </div>

  <div class="info-linha" id="info-linha">
    <span>📍 Professor está em:</span>
    <strong id="texto-linha-dest">—</strong>
  </div>

  <main>
    <div id="linhas"></div>
    <div id="overlay-apagao">
      <div style="font-size:48px">🙈</div>
      <p>Código oculto pelo professor</p>
    </div>
  </main>

  <footer>
    <span>Ctrl+A seleciona tudo • Ctrl+C copia</span>
    <span id="rodape-info">Quadro Digital</span>
  </footer>
</div>

<div id="toast"></div>

<script>
// Tokens de highlight injetados pelo servidor
const TOKENS = ${JSON.stringify(tokens)};
const SENHA_CORRETA = '${senha}';

let senhaAtual = '';
let pollingTimer = null;
let ultimoTimestamp = 0;
let linhasEls = [];
let fontAtual = 13;
let numerosVisiveis = true;
let totalAtualizacoes = 0;

// ── Autenticação ──
function entrar() {
  const digitada = document.getElementById('input-senha').value.trim();
  if (digitada !== SENHA_CORRETA) {
    document.getElementById('erro-senha').style.display = 'block';
    return;
  }
  senhaAtual = digitada;
  document.getElementById('tela-senha').style.display = 'none';
  document.getElementById('interface').style.display = 'flex';
  iniciarPolling();
}

// ── Polling ──
function iniciarPolling() {
  buscarEstado();
  pollingTimer = setInterval(buscarEstado, 1500);
}

async function buscarEstado() {
  try {
    const res = await fetch('/estado?senha=' + encodeURIComponent(senhaAtual), {
      cache: 'no-store',
    });

    if (res.status === 401) {
      clearInterval(pollingTimer);
      document.getElementById('txt-status').textContent = 'Senha inválida';
      return;
    }

    const dados = await res.json();

    document.getElementById('dot-status').className = 'dot ativo';
    document.getElementById('txt-status').textContent = 'Ao vivo';

    if (dados.timestamp !== ultimoTimestamp) {
      ultimoTimestamp = dados.timestamp;
      aplicarAtualizacao(dados);
    }
  } catch {
    document.getElementById('dot-status').className = 'dot reconectando';
    document.getElementById('txt-status').textContent = 'Reconectando...';
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

// ── Renderiza código ──
function aplicarAtualizacao(dados) {
  document.getElementById('nome-arquivo').textContent = dados.nomeArquivo || '—';
  document.getElementById('badge-lang').textContent = dados.linguagem || '—';
  document.getElementById('overlay-apagao').classList.toggle('ativo', !!dados.apagao);

  const linhas = (dados.conteudo || '').split('\\n');
  const codigoHL = highlight(dados.conteudo || '', dados.linguagem || 'plaintext');
  const linhasHL = codigoHL.split('\\n');
  const container = document.getElementById('linhas');
  container.innerHTML = ''; linhasEls = [];

  linhas.forEach((_, i) => {
    const w = document.createElement('div'); w.className = 'linha-wrapper';
    const n = document.createElement('span');
    n.className = 'num-linha' + (numerosVisiveis ? '' : ' oculto');
    n.style.fontSize = fontAtual + 'px';
    n.style.lineHeight = (fontAtual * 1.6) + 'px';
    n.textContent = i + 1;
    const c = document.createElement('span'); c.className = 'conteudo-linha';
    c.style.fontSize = fontAtual + 'px';
    c.style.lineHeight = (fontAtual * 1.6) + 'px';
    c.innerHTML = linhasHL[i] ?? '';
    w.appendChild(n); w.appendChild(c); container.appendChild(w); linhasEls.push(w);
  });

  totalAtualizacoes++;
  document.getElementById('txt-atualizacoes').textContent = totalAtualizacoes + ' atualização(ões)';
  document.getElementById('rodape-info').textContent = dados.nomeArquivo || '';

  if (dados.linhaDestacada !== null && dados.linhaDestacada !== undefined)
    destacarLinha(dados.linhaDestacada);
}

// ── Destaca linha ──
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
      'L' + (linha+1) + '  ' + texto.slice(0, 60) + (texto.length > 60 ? '…' : '');
  } else { infoEl.classList.remove('visivel'); }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── Fonte local ──
function alterarFonte(delta) {
  fontAtual = Math.max(10, Math.min(32, fontAtual + delta));
  document.getElementById('label-fonte').textContent = fontAtual + 'px';
  document.querySelectorAll('.conteudo-linha, .num-linha').forEach(el => {
    el.style.fontSize = fontAtual + 'px';
    el.style.lineHeight = (fontAtual * 1.6) + 'px';
  });
}

// ── Toast ao copiar ──
document.addEventListener('copy', () => {
  const t = document.getElementById('toast');
  t.textContent = '✓ Copiado!'; t.classList.add('visivel');
  setTimeout(() => t.classList.remove('visivel'), 1600);
});

// Foca no campo de senha ao carregar
document.getElementById('input-senha').focus();
</script>
</body>
</html>`;
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

<!-- Tela carregando (Firebase) -->
<div id="tela-carregando" style="display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center">
  <div style="width:28px;height:28px;border:2px solid var(--vscode-panel-border);border-top-color:var(--vscode-focusBorder);border-radius:50%;animation:spin 0.8s linear infinite"></div>
  <p id="txt-carregando" style="font-size:12px;color:var(--vscode-descriptionForeground)">Iniciando...</p>
</div>
@keyframes spin { to { transform:rotate(360deg); } }

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
      <span class="info-label">Endereço</span>
      <span class="info-valor" id="val-ip">—</span>
      <span id="badge-servico" style="display:none;font-size:10px;padding:2px 6px;border-radius:3px;background:#1a6334;color:#3fb68b;white-space:nowrap"></span>
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
  const texto = dadosSessao.servico === 'firebase'
    ? (dadosSessao.publica
        ? '📺 Quadro Digital\\nSala pública: ' + dadosSessao.nomePublico + '\\n(procure por ela em "Salas Públicas" na extensão do aluno)'
        : '📺 Quadro Digital\\nFirebase: ' + dadosSessao.ip + '\\nSala/Senha: ' + dadosSessao.senha)
    : '📺 Quadro Digital\\nIP: ' + dadosSessao.ip + ':' + dadosSessao.porta + '\\nSenha: ' + dadosSessao.senha;
  vscodeApi.postMessage({ tipo: 'copiar-link', link: texto });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  switch(msg.tipo) {
    case 'carregando':
      document.getElementById('tela-inicial').style.display = 'none';
      document.getElementById('tela-carregando').style.display = 'flex';
      document.getElementById('txt-carregando').textContent = msg.msg;
      break;
    case 'carregando-fim':
      document.getElementById('tela-carregando').style.display = 'none';
      document.getElementById('tela-inicial').style.display = 'flex';
      break;
    case 'sessao':
      dadosSessao = msg;
      document.getElementById('tela-inicial').style.display = 'none';
      document.getElementById('tela-carregando').style.display = 'none';
      document.getElementById('tela-sessao').style.display = 'flex';
      document.getElementById('val-senha').textContent = msg.senha;
      // Exibe URL do Firebase ou IP:porta
      const endLabel = msg.servico === 'firebase'
        ? (msg.url || msg.ip)
        : msg.ip + ':' + msg.porta;
      document.getElementById('val-ip').textContent = endLabel;
      // Badge do serviço (Firebase)
      const badge = document.getElementById('badge-servico');
      if (msg.servico === 'firebase') {
        badge.textContent = msg.publica ? ('🔥 pública: ' + msg.nomePublico) : '🔥 firebase (privada)';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
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
