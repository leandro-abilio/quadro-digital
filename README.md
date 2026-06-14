# 📺 Quadro Digital

Extensões VSCode para transmitir código ao vivo em sala de aula.

## Extensões

| Extensão | Para quem | Marketplace |
|---|---|---|
| **quadro-professor** | Professor | [Quadro Digital — Professor](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-professor) |
| **quadro-aluno** | Alunos | [Quadro Digital — Aluno](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-aluno) |

## Como funciona

```
Professor digita código  →  salva ou digita (500ms debounce)
       ↓
Servidor HTTP na porta 3456
       ↓
Alunos fazem polling a cada 1.5s via extensão
       ↓
Código aparece em tempo real no painel do aluno
```

## Estrutura do repositório

```
quadro-digital/
├── quadro-professor/       ← Extensão do professor
│   ├── src/
│   │   └── extension.js   ← Servidor HTTP + painel lateral
│   ├── package.json
│   ├── icon.png
│   └── README.md
├── quadro-aluno/           ← Extensão do aluno
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
- 🔢 Numeração de linhas
- Destaque automático da linha do cursor
- Escolha de IP de rede (ignora VPN/Radmin)

### Aluno
- 📡 Reconexão automática se a rede cair
- A− / A+ para ajustar fonte localmente
- Destaque da linha onde o professor está
- Syntax highlighting para Python, JavaScript e TypeScript
- `Ctrl+C` para copiar qualquer trecho

## Automação via Veyon

Para conectar todos os alunos automaticamente pelo Veyon Master:

```
code --command quadroAluno.conectarDireto --args "[\"192.168.18.22\",\"sua-senha\"]"
```

Substitua o IP e a senha pelos dados da sessão atual.

## Desenvolvimento local

```bash
# Clonar
git clone https://github.com/leandro-abilio/quadro-digital.git
cd quadro-digital

# Testar a extensão do professor
cd quadro-professor
npm install
# Pressione F5 no VSCode para abrir a janela de teste

# Testar a extensão do aluno
cd ../quadro-aluno
npm install
# Pressione F5 no VSCode para abrir a janela de teste
```

## Publicar no Marketplace

```bash
npm install -g @vscode/vsce

# Professor
cd quadro-professor
vsce publish

# Aluno
cd ../quadro-aluno
vsce publish
```

## Requisitos

- VSCode 1.85+
- Professor e alunos na **mesma rede local**
- Porta **3456** liberada entre as máquinas

## Autor

Leandro Abilio Silva — [@leandro-abilio](https://marketplace.visualstudio.com/publishers/leandro-abilio)
