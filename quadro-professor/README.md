# Quadro Digital — Professor

Transmita seu código ao vivo para os alunos diretamente no VSCode deles ou pelo navegador.

## Como usar

1. Clique no ícone 📺 na barra lateral esquerda do VSCode
2. Clique em **▶ Iniciar transmissão**
3. Escolha o modo de conexão:
   - **Rede local** — para redes sem restrições
   - **ngrok** — para redes com Fortinet ou outras restrições
4. Defina uma senha para a sessão
5. Clique em **📋 Copiar dados para o chat** e cole para os alunos

## Modo rede local

Alunos instalam a extensão **Quadro Digital — Aluno** e conectam digitando o IP e senha.

Requisito: porta 3456 liberada entre professor e alunos na rede.

## Modo ngrok

Funciona mesmo com Fortinet ou redes que bloqueiam comunicação entre máquinas.

**Antes de iniciar:**
1. Instale o ngrok (disponível na Microsoft Store)
2. Configure o authtoken: `ngrok config add-authtoken SEU_TOKEN`
3. Abra o terminal e rode: `ngrok http 3456`
4. Deixe o terminal aberto e inicie a transmissão pelo painel

Os alunos recebem uma URL e abrem no **navegador** — sem instalar nada.

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
