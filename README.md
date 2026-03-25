# 🐍 Snakis — Deslize, Devore e Domine!

Um jogo snake moderno e voraz, jogavel no navegador, com **modo solo** e **multiplayer em tempo real** na rede local. Construido com Node.js, Express, Socket.IO e HTML5 Canvas.

> *"Quem rasteja por ultimo, rasteja melhor!"*

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Indice

- [Visao Geral](#visao-geral)
- [Funcionalidades](#funcionalidades)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Pre-requisitos](#pre-requisitos)
- [Instalacao](#instalacao)
- [Como Jogar](#como-jogar)
  - [Modo Solo](#modo-solo)
  - [Modo Multiplayer](#modo-multiplayer)
- [Controles](#controles)
- [Tipos de Comida](#tipos-de-comida)
- [Regras do Multiplayer](#regras-do-multiplayer)
- [Arquitetura do Projeto](#arquitetura-do-projeto)
- [Estrutura de Pastas](#estrutura-de-pastas)
- [Personalizacao](#personalizacao)
- [Solucao de Problemas](#solucao-de-problemas)

---

## Visao Geral

**Snakis** e o classico jogo da cobra reinventado com duas modalidades:

1. **Modo Solo** — Devore tudo no caminho, colete comidas especiais e prove que voce e a cobra mais voraz! Tudo roda localmente no seu navegador.

2. **Modo Multiplayer** — A arena e sua! Jogue com amigos conectados a mesma rede Wi-Fi/LAN. O servidor gerencia toda a logica do jogo em tempo real via WebSocket — descubra quem e a cobra suprema!

---

## Funcionalidades

### Modo Solo
- 🍎 Comidas especiais com efeitos unicos (velocidade, vida extra, escudo, etc.)
- ❤️ Sistema de vidas (3 vidas iniciais)
- 🏆 Recordes salvos localmente no navegador (top 10)
- ⚡ Efeitos temporarios (boost de velocidade, escudo protetor)
- ✨ Efeitos visuais com particulas ao coletar comida
- ⏸ Pausa com ESC ou P

### Modo Multiplayer
- 👥 Ate 6 jogadores simultaneos na mesma rede
- 🎨 Cada jogador com cor unica e nickname
- 👑 Coroa rotativa no jogador com a maior cobra (o "rei")
- 💥 Sistema de colisao especial entre cobras
- 🛡️ Comidas especiais compartilhadas (velocidade, escudo, vida extra)
- 📊 Placar em tempo real na lateral da tela
- 💬 Feed de eventos (eliminacoes, mortes, respawns)
- ⏱️ Partidas com tempo limitado
- 🏆 Ranking final com medalhas
- 🤖 Bots com niveis de dificuldade para preencher a arena

### Visual e UX
- 🌙 Tema escuro moderno com efeitos neon
- 🎆 Sistema de particulas para feedback visual
- 🐍 Cobras com gradiente, olhos e brilho
- 📱 Suporte a dispositivos mobile (touch e swipe)
- 🎨 Interface com glassmorphism e animacoes CSS

---

## Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| **Node.js** | Runtime do servidor |
| **Express** | Servidor HTTP para arquivos estaticos |
| **Socket.IO** | Comunicacao WebSocket em tempo real |
| **HTML5 Canvas** | Renderizacao do jogo |
| **CSS3** | Interface com glassmorphism e animacoes |
| **JavaScript (ES6+)** | Logica do jogo (cliente e servidor) |

---

## Pre-requisitos

- **Node.js** versao 18 ou superior
- **npm** (vem com o Node.js)
- Navegador moderno (Chrome, Firefox, Edge, Safari)

Para verificar se o Node.js esta instalado:

```bash
node --version  # Deve mostrar v18.x.x ou superior
npm --version   # Deve mostrar 8.x.x ou superior
```

Se nao tiver o Node.js instalado, baixe em: https://nodejs.org/

---

## Instalacao

### 1. Clone ou baixe o projeto

```bash
git clone https://github.com/DanielFreitasDev/snakis.git
cd snake-game
```

### 2. Instale as dependencias

```bash
npm install
```

### 3. Inicie o servidor

```bash
npm start
```

Voce vera uma mensagem como:

```
  ╔══════════════════════════════════════════════╗
  ║       🐍  SNAKIS - Servidor Rastejando!      ║
  ╠══════════════════════════════════════════════╣
  ║  Local:  http://localhost:3000              ║
  ║  Rede:   http://192.168.1.100:3000          ║
  ╠══════════════════════════════════════════════╣
  ║  Compartilhe o endereco de rede com seus     ║
  ║  amigos e descubra quem e a cobra suprema!   ║
  ╚══════════════════════════════════════════════╝
```

### 4. Abra no navegador

- **No seu computador:** acesse `http://localhost:3000`
- **Em outros dispositivos da rede:** acesse `http://<IP-DA-REDE>:3000` (o IP e mostrado ao iniciar o servidor)

### Modo desenvolvimento (auto-reload)

```bash
npm run dev
```

Usa `node --watch` para reiniciar o servidor automaticamente ao editar arquivos.

### Porta personalizada

```bash
PORTA=8080 npm start
```

---

## Como Jogar

### Modo Solo

1. Acesse o Snakis no navegador
2. Clique em **"Modo Solo"** no menu principal
3. Clique em **"Iniciar Jogo"**
4. Use as setas do teclado ou WASD para mover a cobra
5. Devore comidas para crescer e ganhar pontos
6. Comidas especiais dao poderes temporarios
7. Evite bater nas paredes e em si mesma
8. Voce tem **3 vidas** — ao perder todas, fim de jogo!
9. Seus recordes sao salvos automaticamente no navegador

### Modo Multiplayer

1. Inicie o servidor (`npm start`)
2. Acesse o Snakis no navegador
3. Clique em **"Multijogador"** no menu principal
4. Digite seu **apelido** (nickname)
5. Escolha uma opcao:
   - **Criar Nova Sala**: cria uma sala e gera um codigo (ex: `A3KX7`)
   - **Entrar com Codigo**: digite o codigo de uma sala existente
   - **Clicar em uma sala** da lista de salas disponiveis
6. Na sala de espera:
   - Compartilhe o **codigo da sala** com seus amigos
   - Adicione **bots** se quiser mais acao na arena!
   - Todos devem clicar em **"Estou Pronto!"**
   - Quando todos estiverem prontos, clique em **"Iniciar Partida"**
7. Durante a partida:
   - Devore comidas para crescer e ganhar pontos
   - Ataque outras cobras com a cabeca para roubar seus segmentos
   - A maior cobra recebe uma **coroa dourada** 👑
8. Ao final, descubra quem e a cobra mais voraz no ranking!

#### Como conectar amigos na mesma rede

1. Certifique-se de que todos estao na **mesma rede Wi-Fi/LAN**
2. No computador que roda o servidor, anote o **endereco de rede** mostrado ao iniciar (ex: `http://192.168.1.100:3000`)
3. No dispositivo do amigo, abra o navegador e acesse esse endereco
4. Pronto! A arena esta aberta!

---

## Controles

### Teclado

| Tecla | Acao |
|---|---|
| `↑` ou `W` | Mover para cima |
| `↓` ou `S` | Mover para baixo |
| `←` ou `A` | Mover para esquerda |
| `→` ou `D` | Mover para direita |
| `ESC` ou `P` | Pausar/continuar (solo) |

### Mobile / Touch

- **Botoes direcionais** na parte inferior da tela
- **Swipe** no canvas do jogo na direcao desejada

---

## Tipos de Comida

| Comida | Cor | Efeito | Pontos |
|---|---|---|---|
| 🍎 Maca | 🟢 Verde | +1 segmento | 10 |
| ⚡ Raio | 🟡 Amarelo | Velocidade aumentada por 5s | 15 |
| ⭐ Estrela | 🟡 Dourado | +3 segmentos | 30 |
| ❤️ Coracao | 🔴 Rosa | +1 vida extra | 25 |
| 🛡️ Escudo | 🔵 Ciano | Protecao contra colisao por 4s | 20 |

---

## Regras do Multiplayer

### Colisao entre Cobras

Quando a **cabeca** de uma cobra A atinge o **corpo** de outra cobra B:

1. A cobra B **perde todos os segmentos** a partir do ponto de colisao
2. A cobra A ganha **5 pontos por segmento removido**
3. Se a cobra B ficar apenas com a cabeca e for atingida novamente, ela e **eliminada**
4. Eliminar um jogador concede **50 pontos bonus**

### Colisao Cabeca-a-Cabeca

Quando duas cabecas colidem diretamente:

- A cobra **maior** vence — a menor e eliminada
- Em caso de **empate**, ambas perdem metade dos segmentos

### Escudo e Invulnerabilidade

- O **escudo** (comida ciano) protege contra colisoes com outras cobras por 4 segundos
- Se uma cobra **com escudo** for atacada, o **atacante** morre em vez do alvo (refletido!)
- Apos perder uma vida e renascer, o jogador ganha **3 segundos de invulnerabilidade** (cobra pisca)

### Condicoes de Vitoria

A partida termina quando:
- O **tempo** acaba — vence quem tem mais pontos
- Resta apenas **1 jogador vivo** — esse jogador e a cobra suprema!

---

## Arquitetura do Projeto

### Modo Solo
O jogo roda **inteiramente no navegador** do jogador. A logica de jogo (movimentacao, colisoes, comida) e processada no JavaScript do cliente. Os recordes sao salvos no `localStorage` do navegador.

### Modo Multiplayer
O servidor e **autoritativo** (*server-authoritative*): toda a logica do jogo roda no servidor Node.js. Os clientes apenas:
- Enviam **inputs** (mudancas de direcao) via WebSocket
- Recebem o **estado completo** do jogo a cada tick (20x por segundo)
- **Renderizam** o estado recebido no Canvas

Isso garante:
- ✅ Sincronizacao perfeita entre todos os jogadores
- ✅ Impossibilidade de trapaca no cliente
- ✅ Experiencia consistente para todos

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

- **Game Loop** — Separacao entre atualizacao logica (tick fixo) e renderizacao (frame variavel)
- **State** — Controle de estados do jogo (`aguardando` → `jogando` → `finalizado`)
- **Observer** — Eventos Socket.IO para comunicacao reativa entre servidor e clientes
- **Mediator** — Servidor como mediador central entre todos os jogadores
- **Object Pool** — Sistema de particulas reutiliza objetos para evitar garbage collection
- **Strategy** — Renderizador encapsula algoritmos de desenho, configuravel por modo

---

## Estrutura de Pastas

```
snakis/
├── package.json              # Dependencias e scripts npm
├── .gitignore                # Arquivos ignorados pelo Git
├── README.md                 # Este arquivo
├── servidor.js               # Servidor Express + Socket.IO
├── jogo/
│   └── SalaDeJogo.js         # Logica de uma sala multiplayer (servidor)
└── publico/                  # Arquivos estaticos servidos ao navegador
    ├── index.html            # Menu principal
    ├── solo.html             # Pagina do modo solo
    ├── multijogador.html     # Pagina do modo multiplayer
    ├── css/
    │   └── estilos.css       # Estilos globais (tema escuro, glassmorphism)
    └── js/
        ├── constantes.js     # Constantes compartilhadas (servidor + cliente)
        ├── Renderizador.js   # Motor de renderizacao Canvas (cobras, comida, coroa)
        ├── SistemaDeParticulas.js  # Efeitos visuais com particulas
        ├── JogoSolo.js       # Logica completa do modo solo
        └── ClienteMultijogador.js  # Cliente WebSocket do modo multiplayer
```

---

## Personalizacao

### Alterar configuracoes do jogo

Edite o arquivo `publico/js/constantes.js` para ajustar:

- **Tamanho do grid**: `TABULEIRO.LARGURA_SOLO`, `TABULEIRO.ALTURA_SOLO`, etc.
- **Velocidade da cobra**: `COBRA.VELOCIDADE_BASE` (maior = mais lento)
- **Vidas iniciais**: `COBRA.VIDAS_INICIAIS`
- **Quantidade de comida**: `SOLO.QUANTIDADE_COMIDA`, `MULTI.QUANTIDADE_COMIDA`
- **Duracao da partida multiplayer**: `MULTI.TEMPO_PARTIDA` (em segundos)
- **Probabilidade de comidas especiais**: Ajuste os valores de `probabilidade` em `TIPOS_COMIDA`

### Alterar cores das cobras

As cores estao definidas em `CONSTANTES.CORES_COBRAS`. Cada cor tem uma versao `principal` (mais clara) e `secundaria` (mais escura, usada no gradiente).

### Alterar porta do servidor

```bash
PORTA=8080 npm start
```

---

## Solucao de Problemas

### "Conexao com o servidor perdida"

- Verifique se o servidor ainda esta rodando
- Certifique-se de estar na mesma rede que o servidor
- Verifique se o firewall nao esta bloqueando a porta 3000

### "Sala nao encontrada"

- O codigo da sala e case-insensitive, mas deve ter exatamente 5 caracteres
- A sala pode ter sido removida se todos os jogadores sairam
- Clique em "Atualizar lista" para ver salas disponiveis

### O jogo esta lento

- Feche outras abas do navegador
- Reduza o tamanho do grid em `constantes.js`
- Em redes lentas, o multiplayer pode ter lag — priorize conexao Wi-Fi estavel

### A pagina nao carrega

- Verifique se o servidor esta rodando (`npm start`)
- Tente acessar `http://localhost:3000` no mesmo computador
- Se acessando de outro dispositivo, use o IP de rede mostrado no console

### O jogo nao inicia no multiplayer

- Todos os jogadores devem clicar em "Estou Pronto!"
- E necessario um minimo de 2 jogadores (ou jogadores + bots)
- Apos todos prontos, qualquer um pode clicar em "Iniciar Partida"

---

Desenvolvido com Node.js, Express, Socket.IO e HTML5 Canvas. 🐍
