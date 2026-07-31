# Quadro Digital — Professor

Transmita seu código ao vivo para os alunos diretamente no VSCode deles ou pelo navegador.

## Como usar

1. Clique no ícone 📺 na barra lateral esquerda do VSCode
2. Clique em **▶ Iniciar transmissão**
3. Escolha o modo de conexão:
   - **Firebase (nuvem)** — funciona em qualquer rede que libere HTTPS, inclusive com Fortinet ou outras restrições
   - **Rede local** — para redes sem restrições, sem depender de internet
4. Defina uma senha (ou nome, se a sala for pública) para a sessão
5. Clique em **📋 Copiar dados para o chat** e cole para os alunos

## Modo Firebase (nuvem)

Funciona mesmo com Fortinet ou redes que bloqueiam comunicação entre máquinas — usa HTTPS puro (porta 443), sem depender de túnel dedicado.

**Duas formas de usar:**
- **Salas Públicas** — sem nenhuma configuração, usa um projeto Firebase já embutido na extensão
- **Meu Firebase** — use seu próprio projeto Firebase (Realtime Database) gratuito

**Pública ou privada:**
- **Privada** — só entra quem tiver a sala/senha (como no modo rede local)
- **Pública** — dá um nome pra sala (ex: "Turma 9 - Matemática") e ela aparece numa lista para os alunos escolherem, sem precisar digitar nada

## Modo rede local

Alunos instalam a extensão **Quadro Digital — Aluno** e conectam digitando o IP e senha.

Requisito: porta 3456 liberada entre professor e alunos na rede.

## Controles do painel

| Controle | Função |
|---|---|
| 👁 **Apagão** | Oculta o código dos alunos |
| 🧊 **Freeze** | Congela a tela dos alunos — você troca de arquivo à vontade |
| ✂️ **Trecho** | Transmite só as linhas selecionadas |
| 🔢 | Liga/desliga numeração de linhas |
| ⏱ **Temporizador** | Define tempo (MM:SS) e controla com ▶ ⏸ ↺ |
| ⏹ | Encerra a sessão |

## Atalho de teclado

`Ctrl+Shift+Q` — transmite o trecho selecionado no editor

## Automação via Veyon

```
code --command quadroAluno.conectarDireto --args "[\"IP\",\"SENHA\"]"
```
