# Quadro Digital — Aluno

Veja o código do professor em tempo real no seu VSCode.

> **Nota:** Se sua escola usa Fortinet ou redes restritas, use o modo **Firebase (nuvem)** — funciona por HTTPS puro, sem precisar de nenhuma configuração de rede.

## Como usar

1. Clique no ícone 👁 na barra lateral esquerda do VSCode
2. Clique em **🔌 Conectar ao professor**
3. Escolha o modo:
   - **Firebase (nuvem)** — navegue pela lista de "Salas Públicas" ativas, ou entre com sala/senha de uma sala privada
   - **Rede local** — digite o IP do professor
4. Se for sala privada (rede local ou Firebase), digite a senha da sessão
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
- Modo Firebase: nenhum requisito de rede além de HTTPS de saída liberado
- Modo rede local: mesma rede que o professor, porta 3456 liberada
