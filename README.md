# 📺 Quadro Digital

Extensões VSCode para transmitir código ao vivo em sala de aula.

## Extensões

| Extensão | Para quem | Versão | Marketplace |
|---|---|---|---|
| **quadro-professor** | Professor | 2.2.0 | [Quadro Digital — Professor](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-professor) |
| **quadro-aluno** | Alunos | 2.1.2 | [Quadro Digital — Aluno](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-aluno) |

## Como funciona

```
Professor edita código no VSCode
         ↓
Servidor HTTP na porta 3456 (extensão do professor)
         ↓
Modo rede local → Alunos conectam pela extensão Quadro Aluno
Modo ngrok      → Alunos abrem no navegador (funciona com Fortinet)
```

## Modos de conexão

### Rede local
Professor e alunos na mesma rede sem restrições. Alunos usam a extensão **Quadro Aluno** no VSCode.

### ngrok (Fortinet / redes restritas)
1. Professor roda `ngrok http 3456` no terminal
2. Inicia transmissão → escolhe **ngrok**
3. Compartilha a URL e senha no chat
4. Alunos abrem a URL no **navegador** — sem instalar nada

## Estrutura do repositório

```
quadro-digital/
├── quadro-professor/       ← Extensão do professor
│   ├── src/
│   │   └── extension.js   ← Servidor HTTP + painel lateral + página web
│   ├── package.json
│   ├── icon.png
│   └── README.md
├── quadro-aluno/           ← Extensão do aluno (rede local)
│   ├── src/
│   │   └── extension.js   ← Polling + painel lateral
│   ├── package.json
│   ├── icon.png
│   └── README.md
└── .gitignore
```

## Funcionalidades

### Professor
- 📺 Painel lateral com controles
- 🧊 **Freeze** — congela a tela dos alunos para trocar de arquivo
- 👁 **Apagão** — oculta o código para os alunos pensarem
- ✂️ **Trecho** — transmite só o trecho selecionado
- ⏱ **Temporizador** — cronômetro com alerta visual
- 🌐 **Modo ngrok** — serve página web para alunos acessarem pelo navegador
- Escolha de IP de rede (ignora VPN/Radmin/VMware)
- Transmissão em tempo real (debounce 500ms ao digitar)

### Aluno (extensão VSCode)
- 📡 Reconexão automática se a rede cair
- A− / A+ para ajustar fonte localmente
- Destaque da linha onde o professor está
- Syntax highlighting para Python, JavaScript e TypeScript

### Aluno (navegador — modo ngrok)
- Sem instalação — abre qualquer navegador
- Tela de senha para autenticação
- A− / A+ para ajustar fonte
- Destaque de linha do professor
- Funciona em celular, tablet ou PC

## Automação via Veyon

Para conectar todos os alunos automaticamente (rede local):

```
code --command quadroAluno.conectarDireto --args "[\"192.168.1.42\",\"sua-senha\"]"
```

Para modo ngrok:
```
code --command quadroAluno.conectarDireto --args "[\"abc123.ngrok-free.dev\",\"sua-senha\",\"ngrok\"]"
```

## Desenvolvimento local

```bash
git clone https://github.com/leandro-abilio/quadro-digital.git
cd quadro-digital

# Extensão do professor
cd quadro-professor
npm install
# F5 no VSCode para abrir janela de teste

# Extensão do aluno
cd ../quadro-aluno
npm install
# F5 no VSCode para abrir janela de teste
```

## Publicar no Marketplace

```bash
npm install -g @vscode/vsce

cd quadro-professor && vsce publish
cd ../quadro-aluno && vsce publish
```

## Requisitos de rede

| Modo | Requisito |
|---|---|
| Rede local | Porta 3456 liberada entre professor e alunos |
| ngrok | Professor com acesso à internet • Alunos com navegador |

## Autor

Leandro Abilio Silva — [@leandro-abilio](https://marketplace.visualstudio.com/publishers/leandro-abilio)
