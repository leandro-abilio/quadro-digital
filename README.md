# 📺 Quadro Digital

Extensões VSCode para transmitir código ao vivo em sala de aula.

## Extensões

| Extensão | Para quem | Marketplace |
|---|---|---|
| **quadro-professor** | Professor | [Quadro Digital — Professor](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-professor) |
| **quadro-aluno** | Alunos | [Quadro Digital — Aluno](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-aluno) |

## Como funciona

```
Professor edita código no VSCode
         ↓
Modo Firebase (nuvem)  → grava o estado no Firebase Realtime Database (HTTPS/443)
Modo rede local        → servidor HTTP na porta 3456 (extensão do professor)
         ↓
Alunos conectam pela extensão Quadro Aluno (rede local, Firebase próprio ou Salas Públicas)
```

## Modos de conexão

### Firebase (nuvem) — recomendado para redes restritas (Fortinet etc.)
Usa a API REST do Firebase Realtime Database como intermediário — puramente HTTPS na porta 443, sem depender de túnel dedicado nem de comunicação direta entre máquinas.

- **Salas Públicas** — sem nenhuma configuração, usa um projeto Firebase já embutido na extensão. O professor dá um nome à sala e ela aparece numa lista para os alunos escolherem.
- **Meu Firebase** — professor configura o próprio projeto Firebase gratuito (Realtime Database), com salas privadas (sala/senha) ou públicas dentro desse projeto.

### Rede local
Professor e alunos na mesma rede sem restrições. Alunos usam a extensão **Quadro Aluno** no VSCode, conectando por IP e senha.

## Estrutura do repositório

```
quadro-digital/
├── quadro-professor/       ← Extensão do professor
│   ├── src/
│   │   └── extension.js   ← Servidor HTTP + painel lateral + página web + relay Firebase
│   ├── .vscode/launch.json
│   ├── package.json
│   ├── icon.png
│   └── README.md
├── quadro-aluno/           ← Extensão do aluno
│   ├── src/
│   │   └── extension.js   ← Polling + painel lateral + relay Firebase
│   ├── .vscode/launch.json
│   ├── package.json
│   ├── icon.png
│   └── README.md
├── CONTEXTO.md             ← Contexto técnico detalhado do projeto
└── .gitignore
```

## Funcionalidades

### Professor
- 📺 Painel lateral com controles
- 🧊 **Freeze** — congela a tela dos alunos para trocar de arquivo
- 👁 **Apagão** — oculta o código para os alunos pensarem
- ✂️ **Trecho** — transmite só o trecho selecionado
- ⏱ **Temporizador** — cronômetro com alerta visual
- 🔥 **Modo Firebase** — Salas Públicas (lobby, sem configuração) ou projeto próprio
- Escolha de IP de rede (ignora VPN/Radmin/VMware) no modo rede local
- Transmissão em tempo real (debounce 500ms ao digitar)

### Aluno (extensão VSCode)
- 📡 Reconexão automática se a rede cair
- A− / A+ para ajustar fonte localmente
- Destaque da linha onde o professor está
- Syntax highlighting para Python, JavaScript e TypeScript
- Navega pela lista de Salas Públicas ou entra com sala/senha manual

## Automação via Veyon

Para conectar todos os alunos automaticamente (rede local):

```
code --command quadroAluno.conectarDireto --args "[\"192.168.1.42\",\"sua-senha\"]"
```

Para modo Firebase (sala/senha conhecida de antemão — não automatiza a escolha de uma sala pública por nome):
```
code --command quadroAluno.conectarDireto --args "[\"https://meu-projeto-default-rtdb.firebaseio.com\",\"sua-sala\",\"firebase\"]"
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

## Publicar uma nova versão no Marketplace

Já publicado como [Quadro Digital — Professor](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-professor) e [Quadro Digital — Aluno](https://marketplace.visualstudio.com/items?itemName=leandro-abilio.quadro-aluno). Para lançar uma atualização, suba a versão no `package.json` de cada extensão e publique:

```bash
npm install -g @vscode/vsce

cd quadro-professor && vsce publish
cd ../quadro-aluno && vsce publish
```

## Requisitos de rede

| Modo | Requisito |
|---|---|
| Firebase (nuvem) | HTTPS de saída liberado (porta 443) — funciona mesmo com Fortinet |
| Rede local | Porta 3456 liberada entre professor e alunos |

## Autor

Leandro Abilio Silva — [@leandro-abilio](https://marketplace.visualstudio.com/publishers/leandro-abilio)
