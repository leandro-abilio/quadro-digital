# Quadro Digital — Aluno

Veja o código do professor em tempo real no seu VSCode.

> **Nota:** Se sua escola usa Fortinet ou redes restritas, use o **navegador** em vez desta extensão — o professor vai compartilhar uma URL para você abrir diretamente.

## Como usar

1. Clique no ícone 👁 na barra lateral esquerda do VSCode
2. Clique em **🔌 Conectar ao professor**
3. Escolha o modo:
   - **Rede local** — digite o IP do professor
   - **ngrok** — cole a URL ngrok (ex: `abc123.ngrok-free.dev`)
4. Digite a senha da sessão
5. O painel abre com o código do professor em tempo real

## Funcionalidades

- Código atualizado automaticamente quando o professor digita ou salva
- Linha do cursor do professor destacada
- **Reconexão automática** — se a rede cair, reconecta sozinho
- Controle de fonte local (A− / A+) — ajuste sem afetar os outros
- Syntax highlighting para Python, JavaScript e TypeScript
- `Ctrl+A` para selecionar tudo, `Ctrl+C` para copiar

## Requisitos

- Extensão **Quadro Digital — Professor** instalada e sessão iniciada
- Mesma rede local que o professor (modo rede local)
- Ou URL ngrok compartilhada pelo professor (modo ngrok)
