/**
 * @fileoverview Constantes compartilhadas entre servidor e cliente do jogo Snake.
 *
 * Este modulo define todas as configuracoes do jogo: dimensoes do tabuleiro,
 * tipos de comida, cores das cobras, direcoes, parametros do modo solo e
 * multiplayer. Utiliza o padrao Universal Module Definition (UMD) para
 * funcionar tanto no Node.js (servidor) quanto no navegador (cliente).
 */

const CONSTANTES = {

  /* =========================================================================
   * CONFIGURACOES DO TABULEIRO
   * Define as dimensoes do grid para cada modo de jogo e o tamanho visual
   * de cada celula em pixels.
   * ======================================================================= */
  TABULEIRO: {
    LARGURA_SOLO: 30,       // Colunas do grid no modo solo
    ALTURA_SOLO: 30,        // Linhas do grid no modo solo
    LARGURA_MULTI: 40,      // Colunas do grid no multiplayer
    ALTURA_MULTI: 30,       // Linhas do grid no multiplayer
    TAMANHO_CELULA: 20,     // Tamanho em pixels de cada celula do grid
  },

  /* =========================================================================
   * CONFIGURACOES DA COBRA
   * Parametros iniciais para cada cobra ao comecar uma partida.
   * ======================================================================= */
  COBRA: {
    TAMANHO_INICIAL: 4,     // Quantidade de segmentos ao nascer
    VIDAS_INICIAIS: 3,      // Vidas no inicio de cada partida
  },

  /* =========================================================================
   * TIPOS DE COMIDA
   * Cada tipo possui propriedades unicas: cor, pontuacao, efeito e
   * probabilidade de aparecer no mapa. A probabilidade eh usada para
   * sortear qual tipo de comida sera gerado.
   * ======================================================================= */
  TIPOS_COMIDA: {
    /** Comida padrao: aumenta a cobra em 1 segmento */
    NORMAL: {
      tipo: 'normal',
      cor: '#44ff44',
      brilho: '#22cc22',
      pontos: 10,
      segmentos: 1,
      probabilidade: 0.45,
      descricao: 'Maçã',
      emoji: '🍎',
    },
    /** Boost de velocidade temporario */
    VELOCIDADE: {
      tipo: 'velocidade',
      cor: '#ffee00',
      brilho: '#ccbb00',
      pontos: 15,
      segmentos: 0,
      duracao: 5000,
      probabilidade: 0.20,
      descricao: 'Raio',
      emoji: '⚡',
    },
    /** Comida premium: aumenta a cobra em 3 segmentos */
    DOURADA: {
      tipo: 'dourada',
      cor: '#ffd700',
      brilho: '#cca800',
      pontos: 30,
      segmentos: 3,
      probabilidade: 0.15,
      descricao: 'Estrela',
      emoji: '⭐',
    },
    /** Concede uma vida extra ao jogador */
    VIDA: {
      tipo: 'vida',
      cor: '#ff4488',
      brilho: '#cc2266',
      pontos: 25,
      segmentos: 0,
      probabilidade: 0.10,
      descricao: 'Coração',
      emoji: '❤️',
    },
    /** Escudo temporario: protege contra colisoes */
    ESCUDO: {
      tipo: 'escudo',
      cor: '#00ffff',
      brilho: '#00bbbb',
      pontos: 20,
      segmentos: 0,
      duracao: 4000,
      probabilidade: 0.10,
      descricao: 'Escudo',
      emoji: '🛡️',
    },
    /**
     * Caveira (so no multiplayer): por alguns segundos, qualquer cobra
     * que encostar em quem comeu morre na hora. Probabilidade 0 aqui para
     * nao aparecer no solo; no multiplayer a chance padrao vem de MULTI.CHANCE_CAVEIRA.
     */
    CAVEIRA: {
      tipo: 'caveira',
      cor: '#b04dff',
      brilho: '#6a1fb0',
      pontos: 20,
      segmentos: 0,
      duracao: 6000,
      probabilidade: 0,
      descricao: 'Caveira',
      emoji: '💀',
    },
  },

  /* =========================================================================
   * CORES DAS COBRAS (MULTIPLAYER)
   * Cada jogador recebe uma cor diferente ao entrar na sala.
   * ======================================================================= */
  CORES_COBRAS: [
    { principal: '#00ff88', secundaria: '#00cc66', nome: 'Verde' },
    { principal: '#ff4488', secundaria: '#cc2266', nome: 'Rosa' },
    { principal: '#4499ff', secundaria: '#2277cc', nome: 'Azul' },
    { principal: '#ffaa00', secundaria: '#cc8800', nome: 'Laranja' },
    { principal: '#bb55ff', secundaria: '#8833cc', nome: 'Roxo' },
    { principal: '#ff6644', secundaria: '#cc4422', nome: 'Vermelho' },
  ],

  /* =========================================================================
   * DIRECOES DE MOVIMENTO
   * Vetores de deslocamento no grid para cada direcao.
   * ======================================================================= */
  DIRECOES: {
    cima:      { x:  0, y: -1 },
    baixo:     { x:  0, y:  1 },
    esquerda:  { x: -1, y:  0 },
    direita:   { x:  1, y:  0 },
  },

  /** Mapa de direcoes opostas para impedir giro de 180 graus */
  DIRECAO_OPOSTA: {
    cima: 'baixo',
    baixo: 'cima',
    esquerda: 'direita',
    direita: 'esquerda',
  },

  /* =========================================================================
   * CONFIGURACOES DO MULTIPLAYER
   * ======================================================================= */
  MULTI: {
    MAX_JOGADORES: 6,
    MIN_JOGADORES_PARA_INICIAR: 2,
    QUANTIDADE_COMIDA: 10,
    TICKS_POR_SEGUNDO: 30,      // Tambem eh o teto de velocidade (1 celula por tick)
    TEMPO_INVULNERAVEL: 3000,   // ms de invulnerabilidade apos respawn
    TEMPO_PARTIDA: 180,         // segundos (3 minutos por partida)
    TEMPO_RECONEXAO: 60,        // segundos que um jogador caido pode voltar a partida
    CHANCE_CAVEIRA: 0.06,       // Chance padrao da caveira (max. 1 no mapa); a sala pode mudar
    MAXIMO_CHANCES: 100,        // Teto das "chances" de aparecer configuraveis por comida

    /*
     * Velocidade das cobras em celulas por segundo. A cada encolhimento
     * da arena a velocidade base eh multiplicada, e o raio multiplica
     * por cima da velocidade atual. Nenhuma cobra passa de 1 celula por
     * tick (TICKS_POR_SEGUNDO), para nao "pular" celulas nas colisoes.
     */
    VELOCIDADE_INICIAL: 5,          // celulas/s no inicio da partida
    ACELERACAO_POR_ENCOLHIMENTO: 1.4, // x1.4 a cada encolhimento da arena
    VELOCIDADE_MAXIMA_BASE: 16,     // teto da velocidade sem raio
    MULTIPLICADOR_RAIO: 2.5,        // raio = velocidade atual x 2.5
  },

  /* =========================================================================
   * CONFIGURACOES DO MODO SOLO
   * ======================================================================= */
  SOLO: {
    QUANTIDADE_COMIDA: 3,       // Comidas simultaneas no mapa
    TICKS_POR_SEGUNDO: 60,      // Taxa de atualizacao do jogo solo (fina para progressao)
    VELOCIDADE_INICIAL: 16,     // Ticks entre movimentos no nivel 1 (~3.75 mov/s)
    VELOCIDADE_MINIMA: 8,       // Ticks entre movimentos no nivel maximo (~7.5 mov/s)
    PONTOS_POR_NIVEL: 120,      // Pontos necessarios para subir de nivel
  },

  /* =========================================================================
   * PONTUACAO POR ACOES ESPECIAIS (MULTIPLAYER)
   * ======================================================================= */
  PONTUACAO: {
    REMOVER_SEGMENTO: 5,        // Pontos ao remover segmento de outro jogador
    ELIMINAR_JOGADOR: 50,       // Pontos ao eliminar outro jogador (padrao; a sala pode mudar)
    MAXIMO_CONFIGURAVEL: 1000,  // Teto dos pontos configuraveis na sala (comidas e eliminacao)
  },
};

/* ---------------------------------------------------------------------------
 * Exportacao universal (UMD)
 * No Node.js: module.exports = CONSTANTES
 * No navegador: a variavel CONSTANTES fica disponivel globalmente
 * ------------------------------------------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTES;
}
