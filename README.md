# 🐍 Snake Game — Multiplayer em Rede Local

Um jogo Snake moderno e bonito, jogável no navegador, com **modo solo** e **multiplayer em tempo real** na rede local. Construído com Node.js, Express, Socket.IO e HTML5 Canvas.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Índice

- [Visão Geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Como Jogar](#como-jogar)
  - [Modo Solo](#modo-solo)
  - [Modo Multiplayer](#modo-multiplayer)
- [Controles](#controles)
- [Tipos de Comida](#tipos-de-comida)
- [Regras do Multiplayer](#regras-do-multiplayer)
- [Arquitetura do Projeto](#arquitetura-do-projeto)
- [Estrutura de Pastas](#estrutura-de-pastas)
- [Personalização](#personalização)
- [Solução de Problemas](#solução-de-problemas)

---

## Visão Geral

Este é um jogo Snake completo com duas modalidades:

1. **Modo Solo** — Jogue sozinho, colete comidas especiais, acumule pontos e tente bater seus recordes. Tudo roda localmente no seu navegador.

2. **Modo Multiplayer** — Jogue com amigos conectados à mesma rede Wi-Fi/LAN. O servidor gerencia toda a lógica do jogo em tempo real via WebSocket, garantindo que todos os jogadores vejam os movimentos uns dos outros instantaneamente.

---

## Funcionalidades

### Modo Solo
- 🍎 Comidas especiais com efeitos únicos (velocidade, vida extra, escudo, etc.)
- ❤️ Sistema de vidas (3 vidas iniciais)
- 🏆 Recordes salvos localmente no navegador (top 10)
- ⚡ Efeitos temporários (boost de velocidade, escudo protetor)
- ✨ Efeitos visuais com partículas ao coletar comida
- ⏸ Pausa com ESC ou P

### Modo Multiplayer
- 👥 Até 6 jogadores simultâneos na mesma rede
- 🎨 Cada jogador com cor única e nickname
- 👑 Coroa rotativa no jogador com a maior cobra (o "rei")
- 💥 Sistema de colisão especial entre cobras
- 🛡️ Comidas especiais compartilhadas (velocidade, escudo, vida extra)
- 📊 Placar em tempo real na lateral da tela
- 💬 Feed de eventos (eliminações, mortes, respawns)
- ⏱️ Partidas com tempo limitado (3 minutos)
- 🏆 Ranking final com medalhas

### Visual e UX
- 🌙 Tema escuro moderno com efeitos neon
- 🎆 Sistema de partículas para feedback visual
- 🐍 Cobras com gradiente, olhos e brilho
- 📱 Suporte a dispositivos mobile (touch e swipe)
- 🎨 Interface com glassmorphism e animações CSS

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| **Node.js** | Runtime do servidor |
| **Express** | Servidor HTTP para arquivos estáticos |
| **Socket.IO** | Comunicação WebSocket em tempo real |
| **HTML5 Canvas** | Renderização do jogo |
| **CSS3** | Interface com glassmorphism e animações |
| **JavaScript (ES6+)** | Lógica do jogo (cliente e servidor) |

---

## Pré-requisitos

- **Node.js** versão 18 ou superior
- **npm** (vem com o Node.js)
- Navegador moderno (Chrome, Firefox, Edge, Safari)

Para verificar se o Node.js está instalado:

```bash
node --version  # Deve mostrar v18.x.x ou superior
npm --version   # Deve mostrar 8.x.x ou superior
```

Se não tiver o Node.js instalado, baixe em: https://nodejs.org/

---

## Instalação

### 1. Clone ou baixe o projeto

```bash
# Se estiver usando Git:
git clone https://github.com/DanielFreitasDev/snake-game.git
cd snake-game

# Ou extraia o arquivo zip e entre na pasta:
cd snake-game
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Inicie o servidor

```bash
npm start
```

Você verá uma mensagem como:

```
  ╔══════════════════════════════════════════════╗
  ║        🐍  SNAKE GAME - Servidor Ativo       ║
  ╠══════════════════════════════════════════════╣
  ║  Local:  http://localhost:3000              ║
  ║  Rede:   http://192.168.1.100:3000          ║
  ╠══════════════════════════════════════════════╣
  ║  Compartilhe o endereco de rede com seus     ║
  ║  amigos para jogar no modo multiplayer!      ║
  ╚══════════════════════════════════════════════╝
```

### 4. Abra no navegador

- **No seu computador:** acesse `http://localhost:3000`
- **Em outros dispositivos da rede:** acesse `http://<IP-DA-REDE>:3000` (o IP é mostrado ao iniciar o servidor)

### Modo desenvolvimento (auto-reload)

```bash
npm run dev
```

Usa `node --watch` para reiniciar o servidor automaticamente ao editar arquivos do servidor.

### Porta personalizada

```bash
PORTA=8080 npm start
```

---

## Como Jogar

### Modo Solo

1. Acesse o jogo no navegador
2. Clique em **"Modo Solo"** no menu principal
3. Clique em **"Iniciar Jogo"**
4. Use as setas do teclado ou WASD para mover a cobra
5. Colete comidas para crescer e ganhar pontos
6. Comidas especiais dão poderes temporários
7. Evite bater nas paredes e em si mesma
8. Você tem **3 vidas** — ao perder todas, o jogo acaba
9. Seus recordes são salvos automaticamente no navegador

### Modo Multiplayer

1. Inicie o servidor (`npm start`)
2. Acesse o jogo no navegador
3. Clique em **"Multijogador"** no menu principal
4. Digite seu **apelido** (nickname)
5. Escolha uma opção:
   - **Criar Nova Sala**: cria uma sala e gera um código (ex: `A3KX7`)
   - **Entrar com Código**: digite o código de uma sala existente
   - **Clicar em uma sala** da lista de salas disponíveis
6. Na sala de espera:
   - Compartilhe o **código da sala** com seus amigos
   - Todos devem clicar em **"Estou Pronto!"**
   - Quando todos estiverem prontos, clique em **"Iniciar Partida"**
7. Durante a partida:
   - Colete comidas para crescer e ganhar pontos
   - Ataque outras cobras com a cabeça para remover seus segmentos
   - A maior cobra recebe uma **coroa dourada** 👑
   - A partida dura **3 minutos**
8. Ao final, um ranking com medalhas é exibido

#### Como conectar amigos na mesma rede

1. Certifique-se de que ambos estão na **mesma rede Wi-Fi/LAN**
2. No computador que roda o servidor, anote o **endereço de rede** mostrado ao iniciar (ex: `http://192.168.1.100:3000`)
3. No dispositivo do amigo, abra o navegador e acesse esse endereço
4. Pronto! Ambos estarão conectados ao mesmo servidor

---

## Controles

### Teclado

| Tecla | Ação |
|---|---|
| `↑` ou `W` | Mover para cima |
| `↓` ou `S` | Mover para baixo |
| `←` ou `A` | Mover para esquerda |
| `→` ou `D` | Mover para direita |
| `ESC` ou `P` | Pausar/continuar (solo) |

### Mobile / Touch

- **Botões direcionais** na parte inferior da tela
- **Swipe** no canvas do jogo na direção desejada

---

## Tipos de Comida

| Comida | Cor | Efeito | Pontos |
|---|---|---|---|
| 🍎 Maçã | 🟢 Verde | +1 segmento | 10 |
| ⚡ Raio | 🟡 Amarelo | Velocidade aumentada por 5s | 15 |
| ⭐ Estrela | 🟡 Dourado | +3 segmentos | 30 |
| ❤️ Coração | 🔴 Rosa | +1 vida extra | 25 |
| 🛡️ Escudo | 🔵 Ciano | Proteção contra colisão por 4s | 20 |

---

## Regras do Multiplayer

### Colisão entre Cobras

Quando a **cabeça** de uma cobra A atinge o **corpo** de outra cobra B:

1. A cobra B **perde todos os segmentos** a partir do ponto de colisão
2. A cobra A ganha **5 pontos por segmento removido**
3. Se a cobra B ficar apenas com a cabeça e for atingida novamente, ela é **eliminada**
4. Eliminar um jogador concede **50 pontos bônus**

### Colisão Cabeça-a-Cabeça

Quando duas cabeças colidem diretamente:

- A cobra **maior** vence — a menor é eliminada
- Em caso de **empate**, ambas perdem metade dos segmentos

### Escudo e Invulnerabilidade

- O **escudo** (comida ciano) protege contra colisões com outras cobras por 4 segundos
- Se uma cobra **com escudo** for atacada, o **atacante** morre em vez do alvo (refletido!)
- Após perder uma vida e renascer, o jogador ganha **3 segundos de invulnerabilidade** (cobra pisca)

### Condições de Vitória

A partida termina quando:
- O **tempo** de 3 minutos acaba — vence quem tem mais pontos
- Resta apenas **1 jogador vivo** — esse jogador vence

---

## Arquitetura do Projeto

### Modo Solo
O jogo roda **inteiramente no navegador** do jogador. A lógica de jogo (movimentação, colisões, comida) é processada no JavaScript do cliente. Os recordes são salvos no `localStorage` do navegador.

### Modo Multiplayer
O servidor é **autoritativo** (*server-authoritative*): toda a lógica do jogo roda no servidor Node.js. Os clientes apenas:
- Enviam **inputs** (mudanças de direção) via WebSocket
- Recebem o **estado completo** do jogo a cada tick (20x por segundo)
- **Renderizam** o estado recebido no Canvas

Isso garante:
- ✅ Sincronização perfeita entre todos os jogadores
- ✅ Impossibilidade de trapaça no cliente
- ✅ Experiência consistente para todos

### Fluxo de Dados (Multiplayer)

```
                    ┌──────────┐
              ┌────▶│ Cliente 1 │◀────┐
              │     └──────────┘     │
              │                      │
  Inputs:     │     ┌──────────┐     │  Estado do jogo:
  (direcao) ──┼────▶│ Servidor │─────┤  (cobras, comidas,
              │     └──────────┘     │   pontuacoes...)
              │          │           │
              │     ┌──────────┐     │
              └────▶│ Cliente 2 │◀────┘
                    └──────────┘
```

### Design Patterns Utilizados

- **Game Loop** — Separação entre atualização lógica (tick fixo) e renderização (frame variável)
- **State** — Controle de estados do jogo (`aguardando` → `jogando` → `finalizado`)
- **Observer** — Eventos Socket.IO para comunicação reativa entre servidor e clientes
- **Mediator** — Servidor como mediador central entre todos os jogadores
- **Object Pool** — Sistema de partículas reutiliza objetos para evitar garbage collection
- **Strategy** — Renderizador encapsula algoritmos de desenho, configurável por modo

---

## Estrutura de Pastas

```
snake-game/
├── package.json              # Dependências e scripts npm
├── .gitignore                # Arquivos ignorados pelo Git
├── README.md                 # Este arquivo
├── servidor.js               # Servidor Express + Socket.IO
├── jogo/
│   └── SalaDeJogo.js         # Lógica de uma sala multiplayer (servidor)
└── publico/                  # Arquivos estáticos servidos ao navegador
    ├── index.html            # Menu principal
    ├── solo.html             # Página do modo solo
    ├── multijogador.html     # Página do modo multiplayer
    ├── css/
    │   └── estilos.css       # Estilos globais (tema escuro, glassmorphism)
    └── js/
        ├── constantes.js     # Constantes compartilhadas (servidor + cliente)
        ├── Renderizador.js   # Motor de renderização Canvas (cobras, comida, coroa)
        ├── SistemaDeParticulas.js  # Efeitos visuais com partículas
        ├── JogoSolo.js       # Lógica completa do modo solo
        └── ClienteMultijogador.js  # Cliente WebSocket do modo multiplayer
```

---

## Personalização

### Alterar configurações do jogo

Edite o arquivo `publico/js/constantes.js` para ajustar:

- **Tamanho do grid**: `TABULEIRO.LARGURA_SOLO`, `TABULEIRO.ALTURA_SOLO`, etc.
- **Velocidade da cobra**: `COBRA.VELOCIDADE_BASE` (maior = mais lento)
- **Vidas iniciais**: `COBRA.VIDAS_INICIAIS`
- **Quantidade de comida**: `SOLO.QUANTIDADE_COMIDA`, `MULTI.QUANTIDADE_COMIDA`
- **Duração da partida multiplayer**: `MULTI.TEMPO_PARTIDA` (em segundos)
- **Probabilidade de comidas especiais**: Ajuste os valores de `probabilidade` em `TIPOS_COMIDA`

### Alterar cores das cobras

As cores estão definidas em `CONSTANTES.CORES_COBRAS`. Cada cor tem uma versão `principal` (mais clara) e `secundaria` (mais escura, usada no gradiente).

### Alterar porta do servidor

```bash
PORTA=8080 npm start
```

---

## Solução de Problemas

### "Conexão com o servidor perdida"

- Verifique se o servidor ainda está rodando
- Certifique-se de estar na mesma rede que o servidor
- Verifique se o firewall não está bloqueando a porta 3000

### "Sala não encontrada"

- O código da sala é case-insensitive, mas deve ter exatamente 5 caracteres
- A sala pode ter sido removida se todos os jogadores saíram
- Clique em "Atualizar lista" para ver salas disponíveis

### O jogo está lento

- Feche outras abas do navegador
- Reduza o tamanho do grid em `constantes.js`
- Em redes lentas, o multiplayer pode ter lag — priorize conexão Wi-Fi estável

### A página não carrega

- Verifique se o servidor está rodando (`npm start`)
- Tente acessar `http://localhost:3000` no mesmo computador
- Se acessando de outro dispositivo, use o IP de rede mostrado no console

### O jogo não inicia no multiplayer

- Todos os jogadores devem clicar em "Estou Pronto!"
- É necessário um mínimo de 2 jogadores
- Após todos prontos, qualquer um pode clicar em "Iniciar Partida"

---

Desenvolvido com Node.js, Express, Socket.IO e HTML5 Canvas.
