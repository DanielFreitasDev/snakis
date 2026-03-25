/**
 * @fileoverview Classe SalaDeJogo - Gerencia toda a logica de uma partida
 * multiplayer do Snake no lado do servidor.
 *
 * Responsabilidades:
 * - Gerenciar jogadores (adicionar, remover, estado de prontidao)
 * - Executar o loop principal do jogo no servidor (server-authoritative)
 * - Controlar movimentacao das cobras com sistema de fila de direcoes
 * - Verificar colisoes (paredes, propria cobra, outras cobras, comida)
 * - Gerenciar comidas especiais e seus efeitos temporarios
 * - Determinar o "rei" (cobra com mais segmentos) para exibir a coroa
 * - Emitir estado atualizado para todos os clientes via Socket.IO
 *
 * Padrao utilizado: State Pattern - o atributo `estado` controla as
 * transicoes entre 'aguardando', 'jogando' e 'finalizado', determinando
 * quais operacoes sao validas em cada momento.
 */

const CONSTANTES = require('../publico/js/constantes');
const BotIA = require('./BotIA');

class SalaDeJogo {
  /**
   * Cria uma nova sala de jogo multiplayer.
   * @param {string} codigo - Codigo unico de identificacao da sala.
   * @param {import('socket.io').Server} io - Instancia do Socket.IO.
   */
  constructor(codigo, io) {
    /** @type {string} Codigo unico da sala */
    this.codigo = codigo;

    /** @type {import('socket.io').Server} Referencia ao Socket.IO */
    this.io = io;

    /** @type {Map<string, object>} Mapa de jogadores (socketId -> dados) */
    this.jogadores = new Map();

    /** @type {Array<object>} Lista de comidas presentes no mapa */
    this.comidas = [];

    /** @type {string} Estado atual: 'aguardando' | 'jogando' | 'finalizado' */
    this.estado = 'aguardando';

    /** @type {NodeJS.Timeout|null} Referencia ao setInterval do game loop */
    this.intervaloJogo = null;

    /** @type {number} Maximo de jogadores permitidos */
    this.maxJogadores = CONSTANTES.MULTI.MAX_JOGADORES;

    /** @type {number} Indice para atribuir cores sequenciais */
    this.indiceCorAtual = 0;

    /** @type {number} Contador sequencial para IDs de bots */
    this.contadorBots = 0;

    /** @type {string} Nivel de dificuldade dos bots: 'facil' | 'normal' | 'dificil' */
    this.dificuldadeBots = 'normal';

    /** @type {number} Duracao configurada da partida em segundos */
    this.tempoPartida = CONSTANTES.MULTI.TEMPO_PARTIDA;

    /** @type {number} Tempo restante da partida em segundos */
    this.tempoRestante = this.tempoPartida;

    /** @type {number} Contador de ticks desde o inicio da partida */
    this.tickAtual = 0;

    /** @type {number} Largura do grid em celulas */
    this.largura = CONSTANTES.TABULEIRO.LARGURA_MULTI;

    /** @type {number} Altura do grid em celulas */
    this.altura = CONSTANTES.TABULEIRO.ALTURA_MULTI;

    /** @type {Array<object>} Fila de eventos para enviar aos clientes */
    this.eventosRecentes = [];

    /* --- Encolhimento da arena --- */

    /** @type {number} Borda atual da arena (celulas de margem em cada lado) */
    this.bordaArena = 0;

    /** @type {number} Borda final apos todos os encolhimentos */
    this.bordaFinal = 5;

    /** @type {number} Total de encolhimentos para a duracao configurada */
    this.totalEncolhimentos = 0;

    /** @type {number} Encolhimentos ja realizados */
    this.encolhimentosFeitos = 0;

    /** @type {number} Ticks restantes de pausa durante encolhimento */
    this.pausaEncolhimento = 0;

    /** @type {boolean} Se a arena esta atualmente encolhendo */
    this.encolhendo = false;
  }

  /* =========================================================================
   * GERENCIAMENTO DE JOGADORES
   * ======================================================================= */

  /**
   * Adiciona um novo jogador a sala.
   * Cada jogador recebe uma cor unica sequencial e seus dados iniciais.
   * @param {string} socketId - ID do socket do jogador.
   * @param {string} apelido - Nickname escolhido pelo jogador.
   */
  adicionarJogador(socketId, apelido) {
    const cor = CONSTANTES.CORES_COBRAS[this.indiceCorAtual % CONSTANTES.CORES_COBRAS.length];
    this.indiceCorAtual++;

    this.jogadores.set(socketId, {
      id: socketId,
      apelido: apelido.substring(0, 15), // Limitar tamanho do apelido
      cor,
      ehBot: false,
      pronto: false,
      cobra: [],
      direcao: 'direita',
      proximaDirecao: 'direita',
      filaDeDirecoes: [],
      pontuacao: 0,
      vidas: CONSTANTES.COBRA.VIDAS_INICIAIS,
      efeitos: {
        velocidade: { ativo: false, tempoRestante: 0 },
        escudo: { ativo: false, tempoRestante: 0 },
      },
      vivo: true,
      invulneravel: false,
      tempoInvulneravel: 0,
      contadorMovimento: 0,
      velocidadeAtual: CONSTANTES.COBRA.VELOCIDADE_BASE,
      crescimento: 0,     // Segmentos pendentes para crescer
      eliminacoes: 0,     // Quantidade de jogadores eliminados
    });
  }

  /**
   * Remove um jogador da sala e verifica se o jogo deve ser finalizado.
   * @param {string} socketId - ID do socket do jogador a remover.
   */
  removerJogador(socketId) {
    this.jogadores.delete(socketId);

    // Se a partida esta em andamento, verificar se deve finalizar
    if (this.estado === 'jogando') {
      const vivos = this._contarJogadoresVivos();
      if (vivos <= 1) {
        this.finalizarJogo();
      }
    }
  }

  /**
   * Retorna a quantidade total de jogadores na sala.
   * @returns {number}
   */
  obterQuantidadeJogadores() {
    return this.jogadores.size;
  }

  /**
   * Alterna o estado de prontidao de um jogador.
   * @param {string} socketId - ID do socket do jogador.
   */
  marcarPronto(socketId) {
    const jogador = this.jogadores.get(socketId);
    if (jogador) {
      jogador.pronto = !jogador.pronto;
    }
  }

  /**
   * Adiciona um bot a sala com nome aleatorio e divertido.
   * Bots entram automaticamente como "prontos".
   * @returns {{sucesso: boolean, erro?: string}}
   */
  adicionarBot() {
    if (this.jogadores.size >= this.maxJogadores) {
      return { sucesso: false, erro: 'A sala esta cheia.' };
    }

    const cor = CONSTANTES.CORES_COBRAS[this.indiceCorAtual % CONSTANTES.CORES_COBRAS.length];
    this.indiceCorAtual++;
    this.contadorBots++;

    const nomesUsados = [...this.jogadores.values()].map(j => j.apelido);
    const apelido = BotIA.sortearNome(nomesUsados);
    const botId = `bot-${this.contadorBots}-${Date.now()}`;

    this.jogadores.set(botId, {
      id: botId,
      apelido,
      cor,
      ehBot: true,
      pronto: true,
      cobra: [],
      direcao: 'direita',
      proximaDirecao: 'direita',
      filaDeDirecoes: [],
      pontuacao: 0,
      vidas: CONSTANTES.COBRA.VIDAS_INICIAIS,
      efeitos: {
        velocidade: { ativo: false, tempoRestante: 0 },
        escudo: { ativo: false, tempoRestante: 0 },
      },
      vivo: true,
      invulneravel: false,
      tempoInvulneravel: 0,
      contadorMovimento: 0,
      velocidadeAtual: CONSTANTES.COBRA.VELOCIDADE_BASE,
      crescimento: 0,
      eliminacoes: 0,
    });

    return { sucesso: true, botId };
  }

  /**
   * Remove um bot da sala (o ultimo adicionado).
   * @returns {{sucesso: boolean, erro?: string}}
   */
  removerBot() {
    // Encontrar o ultimo bot adicionado
    let ultimoBotId = null;
    for (const [id, jogador] of this.jogadores) {
      if (jogador.ehBot) ultimoBotId = id;
    }

    if (!ultimoBotId) {
      return { sucesso: false, erro: 'Nenhum bot para remover.' };
    }

    this.jogadores.delete(ultimoBotId);
    return { sucesso: true };
  }

  /**
   * Altera o nivel de dificuldade dos bots da sala.
   * @param {string} nivel - 'facil' | 'normal' | 'dificil'.
   */
  alterarDificuldadeBots(nivel) {
    const validos = ['facil', 'normal', 'dificil'];
    if (validos.includes(nivel)) {
      this.dificuldadeBots = nivel;
    }
  }

  /**
   * Altera a duracao da partida.
   * @param {number} segundos - Duracao em segundos (60 a 600).
   */
  alterarTempoPartida(segundos) {
    const tempo = Number(segundos);
    if (tempo >= 60 && tempo <= 600) {
      this.tempoPartida = tempo;
    }
  }

  /**
   * Retorna a quantidade de jogadores humanos na sala.
   * @returns {number}
   */
  obterQuantidadeHumanos() {
    let contagem = 0;
    for (const jogador of this.jogadores.values()) {
      if (!jogador.ehBot) contagem++;
    }
    return contagem;
  }

  /**
   * Verifica se as condicoes para iniciar a partida sao atendidas.
   * Requer minimo de jogadores e todos marcados como prontos.
   * @returns {boolean} True se a partida pode comecar.
   */
  podeIniciar() {
    if (this.jogadores.size < CONSTANTES.MULTI.MIN_JOGADORES_PARA_INICIAR) {
      return false;
    }
    for (const jogador of this.jogadores.values()) {
      if (!jogador.pronto) return false;
    }
    return true;
  }

  /* =========================================================================
   * INICIO E FIM DE PARTIDA
   * ======================================================================= */

  /**
   * Inicializa todos os dados e inicia o loop principal do jogo.
   * Posiciona os jogadores, gera a comida inicial e configura o setInterval.
   */
  iniciarJogo() {
    this.estado = 'jogando';
    this.tickAtual = 0;
    this.tempoRestante = this.tempoPartida;
    this.eventosRecentes = [];

    // Calcular encolhimentos de arena baseado no tempo
    const minutos = Math.floor(this.tempoPartida / 60);
    this.totalEncolhimentos = Math.max(0, minutos - 1);
    this.bordaArena = 0;
    this.encolhimentosFeitos = 0;
    this.pausaEncolhimento = 0;
    this.encolhendo = false;

    // Distribuir jogadores em posicoes espalhadas pelo mapa
    const posicoes = this._calcularPosicoesIniciais();
    let indice = 0;

    for (const jogador of this.jogadores.values()) {
      const pos = posicoes[indice % posicoes.length];
      this._inicializarCobra(jogador, pos);
      indice++;
    }

    // Gerar comida inicial
    this.comidas = [];
    for (let i = 0; i < CONSTANTES.MULTI.QUANTIDADE_COMIDA; i++) {
      this._gerarComida();
    }

    // Iniciar loop do jogo com taxa fixa de atualizacao
    const intervaloMs = 1000 / CONSTANTES.MULTI.TICKS_POR_SEGUNDO;
    this.intervaloJogo = setInterval(() => this._loopDoJogo(), intervaloMs);
  }

  /**
   * Finaliza a partida, para o loop e emite o resultado final.
   */
  finalizarJogo() {
    this.estado = 'finalizado';

    if (this.intervaloJogo) {
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
    }

    // Montar ranking final
    const ranking = [...this.jogadores.values()]
      .sort((a, b) => b.pontuacao - a.pontuacao)
      .map((j, posicao) => ({
        posicao: posicao + 1,
        apelido: j.apelido,
        pontuacao: j.pontuacao,
        eliminacoes: j.eliminacoes,
        cor: j.cor,
        ehBot: j.ehBot,
      }));

    this.io.to(this.codigo).emit('partida-finalizada', { ranking });
  }

  /**
   * Para o loop do jogo e limpa recursos. Chamado ao destruir a sala.
   */
  parar() {
    if (this.intervaloJogo) {
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
    }
  }

  /* =========================================================================
   * CONTROLE DE DIRECAO
   * ======================================================================= */

  /**
   * Adiciona uma direcao na fila de movimentos do jogador.
   * Utiliza uma fila para processar multiplas teclas entre ticks,
   * evitando que o jogador perca inputs rapidos.
   * @param {string} socketId - ID do socket do jogador.
   * @param {string} direcao - Nova direcao ('cima'|'baixo'|'esquerda'|'direita').
   */
  mudarDirecao(socketId, direcao) {
    const jogador = this.jogadores.get(socketId);
    if (!jogador || !jogador.vivo) return;

    // Limitar tamanho da fila para evitar acumulo
    if (jogador.filaDeDirecoes.length >= 3) return;

    // Pegar a ultima direcao na fila (ou a direcao atual) para validar
    const ultimaDirecao = jogador.filaDeDirecoes.length > 0
      ? jogador.filaDeDirecoes[jogador.filaDeDirecoes.length - 1]
      : jogador.direcao;

    // Nao permitir reverter 180 graus
    if (direcao === CONSTANTES.DIRECAO_OPOSTA[ultimaDirecao]) return;

    // Nao permitir direcao duplicada consecutiva
    if (direcao === ultimaDirecao) return;

    jogador.filaDeDirecoes.push(direcao);
  }

  /* =========================================================================
   * LOOP PRINCIPAL DO JOGO (SERVER-AUTHORITATIVE)
   * ======================================================================= */

  /**
   * Executa um tick do jogo. Este eh o coracao do servidor de jogo.
   * Cada tick: processa inputs, move cobras, verifica colisoes,
   * atualiza efeitos, mantem comida, e emite o estado atualizado.
   * @private
   */
  _loopDoJogo() {
    this.tickAtual++;
    this.eventosRecentes = [];

    // 0. Se pausado para encolhimento da arena, apenas decrementar
    if (this.pausaEncolhimento > 0) {
      this.pausaEncolhimento--;
      if (this.pausaEncolhimento === 0) {
        this._aplicarEncolhimento();
      }
      this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
      return;
    }

    // 1. Atualizar temporizadores de efeitos e invulnerabilidade
    this._atualizarTemporizadores();

    // 2. Atualizar decisoes dos bots
    this._atualizarBots();

    // 3. Mover todas as cobras
    this._moverCobras();

    // 4. Verificar colisoes com comida
    this._verificarColisaoComida();

    // 5. Verificar colisoes com paredes e propria cobra
    this._verificarColisaoParedes();
    this._verificarAutoColisao();

    // 6. Verificar colisoes entre cobras (regra especial)
    this._verificarColisaoEntreCobras();

    // 7. Reabastecer comida se necessario
    while (this.comidas.length < CONSTANTES.MULTI.QUANTIDADE_COMIDA) {
      this._gerarComida();
    }

    // 8. Atualizar tempo restante (1 segundo = TICKS_POR_SEGUNDO ticks)
    if (this.tickAtual % CONSTANTES.MULTI.TICKS_POR_SEGUNDO === 0) {
      this.tempoRestante--;

      // Verificar se eh hora de encolher a arena
      if (this.tempoRestante > 0 && this.tempoRestante % 60 === 0 &&
          this.tempoRestante < this.tempoPartida &&
          this.totalEncolhimentos > 0 &&
          this.encolhimentosFeitos < this.totalEncolhimentos) {
        this._iniciarEncolhimento();
        this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
        return;
      }

      if (this.tempoRestante <= 0) {
        this.finalizarJogo();
        return;
      }
    }

    // 9. Verificar se resta apenas 1 jogador vivo
    const vivos = this._contarJogadoresVivos();
    if (vivos <= 1 && this.jogadores.size > 1) {
      // Dar um pequeno delay para a ultima acao ser visivel
      setTimeout(() => this.finalizarJogo(), 500);
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
      // Enviar ultimo estado
      this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
      return;
    }

    // 10. Broadcast do estado atualizado para todos os clientes
    this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
  }

  /* =========================================================================
   * MOVIMENTACAO DAS COBRAS
   * ======================================================================= */

  /**
   * Move cada cobra viva de acordo com sua velocidade e direcao.
   * O sistema de velocidade usa um contador de ticks: a cobra so
   * se move quando o contador atinge o valor de velocidadeAtual.
   * @private
   */
  _moverCobras() {
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo) continue;

      // Sistema de velocidade por contagem de ticks
      jogador.contadorMovimento++;
      if (jogador.contadorMovimento < jogador.velocidadeAtual) continue;
      jogador.contadorMovimento = 0;

      // Processar proximo input da fila de direcoes
      if (jogador.filaDeDirecoes.length > 0) {
        const novaDirecao = jogador.filaDeDirecoes.shift();
        // Validacao extra contra giro de 180 graus
        if (novaDirecao !== CONSTANTES.DIRECAO_OPOSTA[jogador.direcao]) {
          jogador.direcao = novaDirecao;
        }
      }

      // Calcular nova posicao da cabeca baseado na direcao
      const vetor = CONSTANTES.DIRECOES[jogador.direcao];
      const cabecaAtual = jogador.cobra[0];
      const novaCabeca = {
        x: cabecaAtual.x + vetor.x,
        y: cabecaAtual.y + vetor.y,
      };

      // Inserir nova cabeca no inicio do array (a cobra "avanca")
      jogador.cobra.unshift(novaCabeca);

      // Se a cobra precisa crescer, nao remove a cauda
      if (jogador.crescimento > 0) {
        jogador.crescimento--;
      } else {
        jogador.cobra.pop();
      }
    }
  }

  /* =========================================================================
   * VERIFICACAO DE COLISOES
   * ======================================================================= */

  /**
   * Verifica se alguma cobra comeu uma comida.
   * Aplica o efeito da comida e gera uma nova para substituir.
   * @private
   */
  _verificarColisaoComida() {
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;

      const cabeca = jogador.cobra[0];

      for (let i = this.comidas.length - 1; i >= 0; i--) {
        const comida = this.comidas[i];

        if (cabeca.x === comida.posicao.x && cabeca.y === comida.posicao.y) {
          // Aplicar efeitos da comida
          this._aplicarEfeitoComida(jogador, comida);

          // Remover comida consumida
          this.comidas.splice(i, 1);

          // Registrar evento para efeitos visuais no cliente
          this.eventosRecentes.push({
            tipo: 'comida_coletada',
            posicao: { ...comida.posicao },
            tipoComida: comida.tipo,
            jogadorId: jogador.id,
          });

          break; // Uma cobra so come uma comida por tick
        }
      }
    }
  }

  /**
   * Aplica o efeito de uma comida ao jogador que a coletou.
   * Cada tipo de comida tem um efeito especifico definido nas constantes.
   * @param {object} jogador - Dados do jogador.
   * @param {object} comida - Dados da comida coletada.
   * @private
   */
  _aplicarEfeitoComida(jogador, comida) {
    const tipos = CONSTANTES.TIPOS_COMIDA;

    // Somar pontos
    jogador.pontuacao += comida.pontos;

    switch (comida.tipo) {
      case 'normal':
        // Crescer a cobra
        jogador.crescimento += tipos.NORMAL.segmentos;
        break;

      case 'velocidade':
        // Ativar boost de velocidade
        jogador.efeitos.velocidade.ativo = true;
        jogador.efeitos.velocidade.tempoRestante += tipos.VELOCIDADE.duracao;
        jogador.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_RAPIDA;
        break;

      case 'dourada':
        // Crescer bastante
        jogador.crescimento += tipos.DOURADA.segmentos;
        break;

      case 'vida':
        // Ganhar vida extra
        jogador.vidas++;
        break;

      case 'escudo':
        // Ativar escudo protetor
        jogador.efeitos.escudo.ativo = true;
        jogador.efeitos.escudo.tempoRestante += tipos.ESCUDO.duracao;
        break;
    }
  }

  /**
   * Verifica colisoes das cobras com as paredes do mapa.
   * Se a cobra bater na parede, perde uma vida ou morre.
   * @private
   */
  _verificarColisaoParedes() {
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;

      const cabeca = jogador.cobra[0];

      if (cabeca.x < this.bordaArena || cabeca.x >= this.largura - this.bordaArena ||
          cabeca.y < this.bordaArena || cabeca.y >= this.altura - this.bordaArena) {
        this._processarMorte(jogador, 'parede');
      }
    }
  }

  /**
   * Verifica se alguma cobra colidiu com seu proprio corpo.
   * @private
   */
  _verificarAutoColisao() {
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo || jogador.cobra.length <= 1) continue;

      const cabeca = jogador.cobra[0];

      // Verificar colisao com cada segmento do corpo (exceto a cabeca)
      for (let i = 1; i < jogador.cobra.length; i++) {
        const segmento = jogador.cobra[i];
        if (cabeca.x === segmento.x && cabeca.y === segmento.y) {
          this._processarMorte(jogador, 'auto_colisao');
          break;
        }
      }
    }
  }

  /**
   * Verifica colisoes entre diferentes cobras (regra especial).
   *
   * REGRA DE COLISAO ENTRE COBRAS:
   * - Quando a cabeca de uma cobra A atinge o corpo de uma cobra B:
   *   - Se B tem escudo ativo: nenhum efeito
   *   - Se A esta invulneravel: nenhum efeito
   *   - B perde 1 segmento no ponto de colisao
   *   - A ganha pontos por remover o segmento
   *   - Se B fica apenas com a cabeca e eh atingida novamente: B morre
   *
   * - Quando duas cabecas colidem (head-on):
   *   - A cobra menor morre
   *   - Se tamanhos iguais: ambas perdem um segmento
   *
   * @private
   */
  _verificarColisaoEntreCobras() {
    const jogadoresVivos = [...this.jogadores.values()].filter(j => j.vivo && j.cobra.length > 0);

    for (let i = 0; i < jogadoresVivos.length; i++) {
      const atacante = jogadoresVivos[i];
      if (!atacante.vivo) continue;

      const cabecaA = atacante.cobra[0];

      for (let j = 0; j < jogadoresVivos.length; j++) {
        if (i === j) continue;

        const alvo = jogadoresVivos[j];
        if (!alvo.vivo) continue;

        const cabecaB = alvo.cobra[0];

        // Caso 1: Colisao cabeca-cabeca (head-on collision)
        if (cabecaA.x === cabecaB.x && cabecaA.y === cabecaB.y) {
          this._resolverColisaoCabecaCabeca(atacante, alvo);
          continue;
        }

        // Caso 2: Cabeca de A atinge corpo de B
        for (let s = 1; s < alvo.cobra.length; s++) {
          const segmento = alvo.cobra[s];

          if (cabecaA.x === segmento.x && cabecaA.y === segmento.y) {
            // Se o atacante esta invulneravel, ignorar
            if (atacante.invulneravel) break;

            // Se o alvo tem escudo, o atacante eh que sofre
            if (alvo.efeitos.escudo.ativo) {
              this._processarMorte(atacante, 'escudo_refletido');
              break;
            }

            // Regra principal: remover segmentos do alvo a partir do ponto de colisao
            if (alvo.cobra.length <= 1) {
              // Alvo so tem cabeca, entao eh eliminado
              atacante.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
              atacante.eliminacoes++;
              this._processarMorte(alvo, 'colisao_cobra');

              this.eventosRecentes.push({
                tipo: 'eliminacao',
                eliminadorId: atacante.id,
                eliminadoId: alvo.id,
                eliminadorApelido: atacante.apelido,
                eliminadoApelido: alvo.apelido,
              });
            } else {
              // Remover todos os segmentos a partir do ponto de colisao
              const segmentosRemovidos = alvo.cobra.length - s;
              alvo.cobra.splice(s);

              // Pontuacao pelo dano causado
              atacante.pontuacao += CONSTANTES.PONTUACAO.REMOVER_SEGMENTO * segmentosRemovidos;

              this.eventosRecentes.push({
                tipo: 'segmento_removido',
                jogadorId: alvo.id,
                posicao: { ...segmento },
                quantidade: segmentosRemovidos,
              });
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Resolve colisao direta entre duas cabecas de cobra.
   * Se um jogador tem escudo, o outro morre (escudo reflete). Ambos com escudo: sem efeito.
   * Sem escudo: a cobra menor morre; em caso de empate, ambas perdem segmentos.
   * @param {object} jogadorA - Primeiro jogador.
   * @param {object} jogadorB - Segundo jogador.
   * @private
   */
  _resolverColisaoCabecaCabeca(jogadorA, jogadorB) {
    const escudoA = jogadorA.efeitos.escudo.ativo;
    const escudoB = jogadorB.efeitos.escudo.ativo;

    // Se ambos tem escudo, nenhum efeito
    if (escudoA && escudoB) return;

    // Se apenas um tem escudo, o outro morre (escudo reflete)
    if (escudoA) {
      jogadorA.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
      jogadorA.eliminacoes++;
      this._processarMorte(jogadorB, 'escudo_refletido');
      return;
    }
    if (escudoB) {
      jogadorB.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
      jogadorB.eliminacoes++;
      this._processarMorte(jogadorA, 'escudo_refletido');
      return;
    }

    const tamanhoA = jogadorA.cobra.length;
    const tamanhoB = jogadorB.cobra.length;

    if (tamanhoA > tamanhoB) {
      // A eh maior, B morre
      jogadorA.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
      jogadorA.eliminacoes++;
      this._processarMorte(jogadorB, 'colisao_cabeca');
    } else if (tamanhoB > tamanhoA) {
      // B eh maior, A morre
      jogadorB.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
      jogadorB.eliminacoes++;
      this._processarMorte(jogadorA, 'colisao_cabeca');
    } else {
      // Tamanhos iguais: ambas perdem metade dos segmentos
      const perda = Math.max(1, Math.floor(tamanhoA / 2));
      jogadorA.cobra.splice(-perda);
      jogadorB.cobra.splice(-perda);

      // Se alguma ficou sem corpo, morre
      if (jogadorA.cobra.length === 0) this._processarMorte(jogadorA, 'colisao_cabeca');
      if (jogadorB.cobra.length === 0) this._processarMorte(jogadorB, 'colisao_cabeca');
    }
  }

  /**
   * Processa a morte ou perda de vida de um jogador.
   * Se o jogador ainda tem vidas, ele renasce (respawn).
   * Caso contrario, eh eliminado definitivamente.
   * @param {object} jogador - Dados do jogador.
   * @param {string} causa - Motivo da morte para log/eventos.
   * @private
   */
  _processarMorte(jogador, causa) {
    if (jogador.invulneravel) return;

    jogador.vidas--;

    if (jogador.vidas > 0) {
      // Respawn: reposicionar a cobra em local seguro
      this._respawnarJogador(jogador);

      this.eventosRecentes.push({
        tipo: 'respawn',
        jogadorId: jogador.id,
        vidasRestantes: jogador.vidas,
      });
    } else {
      // Morte definitiva
      jogador.vivo = false;
      jogador.cobra = [];

      this.eventosRecentes.push({
        tipo: 'morte',
        jogadorId: jogador.id,
        apelido: jogador.apelido,
        causa,
      });

      // Dropar comida no local da morte
      this._droparComidaMorte(jogador);
    }
  }

  /**
   * Reposiciona um jogador em uma posicao aleatoria segura apos perder uma vida.
   * Concede invulnerabilidade temporaria para evitar mortes em cadeia.
   * @param {object} jogador - Dados do jogador a reposicionar.
   * @private
   */
  _respawnarJogador(jogador) {
    const posicao = this._encontrarPosicaoSegura();
    const direcoes = ['cima', 'baixo', 'esquerda', 'direita'];
    const direcaoAleatoria = direcoes[Math.floor(Math.random() * direcoes.length)];

    jogador.direcao = direcaoAleatoria;
    jogador.filaDeDirecoes = [];
    jogador.contadorMovimento = 0;
    jogador.crescimento = 0;
    jogador.invulneravel = true;
    jogador.tempoInvulneravel = CONSTANTES.MULTI.TEMPO_INVULNERAVEL;
    jogador.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
    jogador.efeitos = {
      velocidade: { ativo: false, tempoRestante: 0 },
      escudo: { ativo: false, tempoRestante: 0 },
    };

    // Criar cobra com tamanho inicial
    const vetor = CONSTANTES.DIRECOES[direcaoAleatoria];
    jogador.cobra = [];
    for (let i = 0; i < CONSTANTES.COBRA.TAMANHO_INICIAL; i++) {
      jogador.cobra.push({
        x: posicao.x - vetor.x * i,
        y: posicao.y - vetor.y * i,
      });
    }
  }

  /**
   * Dropa algumas comidas normais na posicao onde o jogador morreu,
   * adicionando mais dinamismo ao jogo.
   * @param {object} jogador - Jogador que morreu (com cobra anterior).
   * @private
   */
  _droparComidaMorte(jogador) {
    // Limitar a quantidade de comida dropada
    const maxDrop = 3;
    let dropados = 0;
    // Usar as ultimas posicoes conhecidas (se houver)
    // Como a cobra ja foi limpa, nao podemos usar suas posicoes.
    // Dropar na area central como alternativa.
  }

  /* =========================================================================
   * GERACAO DE COMIDA
   * ======================================================================= */

  /**
   * Gera uma nova comida aleatoria em uma posicao livre do mapa.
   * O tipo da comida eh sorteado com base nas probabilidades definidas
   * nas constantes (sistema de roleta ponderada).
   * @private
   */
  _gerarComida() {
    const posicao = this._encontrarPosicaoLivre();
    if (!posicao) return; // Mapa completamente cheio (improvavel)

    // Sortear tipo de comida usando probabilidades ponderadas
    const tipoSorteado = this._sortearTipoComida();
    const dadosTipo = CONSTANTES.TIPOS_COMIDA[tipoSorteado];

    this.comidas.push({
      tipo: dadosTipo.tipo,
      posicao,
      pontos: dadosTipo.pontos,
      cor: dadosTipo.cor,
      brilho: dadosTipo.brilho,
      descricao: dadosTipo.descricao,
      criadoEm: this.tickAtual,
    });
  }

  /**
   * Sorteia um tipo de comida usando roleta ponderada (weighted random).
   * Comidas mais comuns tem maior probabilidade de aparecer.
   * @returns {string} Chave do tipo de comida em CONSTANTES.TIPOS_COMIDA.
   * @private
   */
  _sortearTipoComida() {
    const sorteio = Math.random();
    let acumulado = 0;

    for (const [chave, tipo] of Object.entries(CONSTANTES.TIPOS_COMIDA)) {
      acumulado += tipo.probabilidade;
      if (sorteio <= acumulado) return chave;
    }

    // Fallback: retornar comida normal
    return 'NORMAL';
  }

  /**
   * Encontra uma posicao aleatoria que nao esteja ocupada por
   * cobras ou outras comidas.
   * @returns {{x: number, y: number}|null} Posicao livre ou null.
   * @private
   */
  _encontrarPosicaoLivre() {
    const maxTentativas = 100;

    for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
      const x = this.bordaArena + Math.floor(Math.random() * (this.largura - this.bordaArena * 2));
      const y = this.bordaArena + Math.floor(Math.random() * (this.altura - this.bordaArena * 2));

      if (this._posicaoOcupada(x, y)) continue;

      return { x, y };
    }

    return null;
  }

  /**
   * Encontra uma posicao segura para respawn, longe de outras cobras.
   * @returns {{x: number, y: number}} Posicao segura.
   * @private
   */
  _encontrarPosicaoSegura() {
    const margemDesejada = 5;
    const areaLargura = this.largura - this.bordaArena * 2;
    const areaAltura = this.altura - this.bordaArena * 2;
    const margem = Math.min(margemDesejada, Math.floor(Math.min(areaLargura, areaAltura) / 4));
    const maxTentativas = 50;

    for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
      const x = this.bordaArena + margem + Math.floor(Math.random() * (areaLargura - margem * 2));
      const y = this.bordaArena + margem + Math.floor(Math.random() * (areaAltura - margem * 2));

      // Verificar se esta longe de outras cobras
      let seguro = true;
      for (const jogador of this.jogadores.values()) {
        if (!jogador.vivo || jogador.cobra.length === 0) continue;
        const cabeca = jogador.cobra[0];
        const distancia = Math.abs(cabeca.x - x) + Math.abs(cabeca.y - y);
        if (distancia < 8) {
          seguro = false;
          break;
        }
      }

      if (seguro && !this._posicaoOcupada(x, y)) {
        return { x, y };
      }
    }

    // Fallback: posicao central
    return {
      x: Math.floor(this.largura / 2),
      y: Math.floor(this.altura / 2),
    };
  }

  /**
   * Verifica se uma posicao do grid esta ocupada por cobra ou comida.
   * @param {number} x - Coordenada X.
   * @param {number} y - Coordenada Y.
   * @returns {boolean} True se a posicao esta ocupada.
   * @private
   */
  _posicaoOcupada(x, y) {
    // Verificar cobras
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo) continue;
      for (const seg of jogador.cobra) {
        if (seg.x === x && seg.y === y) return true;
      }
    }

    // Verificar comidas
    for (const comida of this.comidas) {
      if (comida.posicao.x === x && comida.posicao.y === y) return true;
    }

    return false;
  }

  /* =========================================================================
   * INTELIGENCIA ARTIFICIAL DOS BOTS
   * ======================================================================= */

  /**
   * Atualiza as decisoes de direcao de todos os bots vivos.
   * Chamado a cada tick, antes de mover as cobras.
   * @private
   */
  _atualizarBots() {
    const todosJogadores = [...this.jogadores.values()];

    for (const jogador of todosJogadores) {
      if (!jogador.ehBot || !jogador.vivo) continue;

      // So decidir quando a fila esta vazia
      if (jogador.filaDeDirecoes.length > 0) continue;

      const novaDirecao = BotIA.decidirDirecao(
        jogador, todosJogadores, this.comidas, this.largura, this.altura,
        this.dificuldadeBots, this.bordaArena
      );

      if (novaDirecao !== jogador.direcao) {
        jogador.filaDeDirecoes.push(novaDirecao);
      }
    }
  }

  /* =========================================================================
   * TEMPORIZADORES E EFEITOS
   * ======================================================================= */

  /**
   * Atualiza os temporizadores de todos os efeitos ativos e invulnerabilidade.
   * Quando um efeito expira, restaura os valores base do jogador.
   * @private
   */
  _atualizarTemporizadores() {
    const msPerTick = 1000 / CONSTANTES.MULTI.TICKS_POR_SEGUNDO;

    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo) continue;

      // Invulnerabilidade pos-respawn
      if (jogador.invulneravel) {
        jogador.tempoInvulneravel -= msPerTick;
        if (jogador.tempoInvulneravel <= 0) {
          jogador.invulneravel = false;
          jogador.tempoInvulneravel = 0;
        }
      }

      // Efeito: boost de velocidade
      if (jogador.efeitos.velocidade.ativo) {
        jogador.efeitos.velocidade.tempoRestante -= msPerTick;
        if (jogador.efeitos.velocidade.tempoRestante <= 0) {
          jogador.efeitos.velocidade.ativo = false;
          jogador.efeitos.velocidade.tempoRestante = 0;
          jogador.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
        }
      }

      // Efeito: escudo protetor
      if (jogador.efeitos.escudo.ativo) {
        jogador.efeitos.escudo.tempoRestante -= msPerTick;
        if (jogador.efeitos.escudo.tempoRestante <= 0) {
          jogador.efeitos.escudo.ativo = false;
          jogador.efeitos.escudo.tempoRestante = 0;
        }
      }
    }
  }

  /* =========================================================================
   * GETTERS DE ESTADO (PARA EMITIR AOS CLIENTES)
   * ======================================================================= */

  /**
   * Retorna informacoes da sala para o lobby (antes do jogo comecar).
   * @returns {object} Dados da sala para exibicao no lobby.
   */
  obterInfoSala() {
    const listaJogadores = [];
    for (const jogador of this.jogadores.values()) {
      listaJogadores.push({
        id: jogador.id,
        apelido: jogador.apelido,
        cor: jogador.cor,
        pronto: jogador.pronto,
        ehBot: jogador.ehBot,
      });
    }

    return {
      codigo: this.codigo,
      estado: this.estado,
      jogadores: listaJogadores,
      maxJogadores: this.maxJogadores,
      dificuldadeBots: this.dificuldadeBots,
      tempoPartida: this.tempoPartida,
    };
  }

  /**
   * Retorna o estado completo do jogo para enviar aos clientes.
   * Inclui posicoes de todas as cobras, comidas, pontuacoes e eventos.
   * @returns {object} Estado serializado do jogo.
   * @private
   */
  _obterEstadoJogo() {
    const jogadoresEstado = [];
    let maiorTamanho = 0;
    let idRei = null;

    // Primeiro, encontrar a maior cobra para determinar o "rei"
    for (const jogador of this.jogadores.values()) {
      if (jogador.vivo && jogador.cobra.length > maiorTamanho) {
        maiorTamanho = jogador.cobra.length;
        idRei = jogador.id;
      }
    }

    // Montar dados de cada jogador para envio
    for (const jogador of this.jogadores.values()) {
      jogadoresEstado.push({
        id: jogador.id,
        apelido: jogador.apelido,
        cor: jogador.cor,
        cobra: jogador.cobra,
        direcao: jogador.direcao,
        pontuacao: jogador.pontuacao,
        vidas: jogador.vidas,
        vivo: jogador.vivo,
        invulneravel: jogador.invulneravel,
        efeitos: {
          velocidade: jogador.efeitos.velocidade.ativo,
          escudo: jogador.efeitos.escudo.ativo,
        },
        ehRei: jogador.id === idRei,
        eliminacoes: jogador.eliminacoes,
        ehBot: jogador.ehBot,
      });
    }

    return {
      jogadores: jogadoresEstado,
      comidas: this.comidas.map(c => ({
        tipo: c.tipo,
        posicao: c.posicao,
        cor: c.cor,
        brilho: c.brilho,
        descricao: c.descricao,
      })),
      tempoRestante: this.tempoRestante,
      eventos: this.eventosRecentes,
      tick: this.tickAtual,
      bordaArena: this.bordaArena,
      encolhendo: this.encolhendo,
    };
  }

  /* =========================================================================
   * ENCOLHIMENTO DA ARENA
   * ======================================================================= */

  /**
   * Inicia o processo de encolhimento: pausa o jogo por 3 segundos.
   * @private
   */
  _iniciarEncolhimento() {
    this.encolhendo = true;
    this.pausaEncolhimento = 3 * CONSTANTES.MULTI.TICKS_POR_SEGUNDO;
    this.eventosRecentes.push({ tipo: 'arena_encolhendo' });
  }

  /**
   * Aplica o encolhimento apos a pausa: atualiza bordas, reposiciona entidades.
   * @private
   */
  _aplicarEncolhimento() {
    this.encolhimentosFeitos++;
    this.bordaArena = Math.round(
      this.bordaFinal * (this.encolhimentosFeitos / this.totalEncolhimentos)
    );
    this.encolhendo = false;

    // Remover comidas fora dos novos limites
    this.comidas = this.comidas.filter(c =>
      c.posicao.x >= this.bordaArena && c.posicao.x < this.largura - this.bordaArena &&
      c.posicao.y >= this.bordaArena && c.posicao.y < this.altura - this.bordaArena
    );

    // Tratar cobras fora dos novos limites
    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;

      const cabeca = jogador.cobra[0];
      const fora = cabeca.x < this.bordaArena || cabeca.x >= this.largura - this.bordaArena ||
                   cabeca.y < this.bordaArena || cabeca.y >= this.altura - this.bordaArena;

      if (fora) {
        // Cabeca fora da area: reposicionar jogador
        this._respawnarJogador(jogador);
      } else {
        // Truncar segmentos do corpo que ficaram fora
        jogador.cobra = jogador.cobra.filter(seg =>
          seg.x >= this.bordaArena && seg.x < this.largura - this.bordaArena &&
          seg.y >= this.bordaArena && seg.y < this.altura - this.bordaArena
        );
      }

      // Invulnerabilidade temporaria apos encolhimento
      jogador.invulneravel = true;
      jogador.tempoInvulneravel = 2000;
    }

    this.eventosRecentes.push({
      tipo: 'arena_encolheu',
      bordaArena: this.bordaArena,
    });
  }

  /* =========================================================================
   * UTILITARIOS INTERNOS
   * ======================================================================= */

  /**
   * Inicializa a cobra de um jogador em uma posicao especifica.
   * @param {object} jogador - Dados do jogador.
   * @param {object} pos - Posicao e direcao iniciais.
   * @private
   */
  _inicializarCobra(jogador, pos) {
    jogador.vivo = true;
    jogador.pontuacao = 0;
    jogador.vidas = CONSTANTES.COBRA.VIDAS_INICIAIS;
    jogador.direcao = pos.direcao;
    jogador.filaDeDirecoes = [];
    jogador.contadorMovimento = 0;
    jogador.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
    jogador.crescimento = 0;
    jogador.eliminacoes = 0;
    jogador.invulneravel = true;
    jogador.tempoInvulneravel = CONSTANTES.MULTI.TEMPO_INVULNERAVEL;
    jogador.efeitos = {
      velocidade: { ativo: false, tempoRestante: 0 },
      escudo: { ativo: false, tempoRestante: 0 },
    };

    // Criar segmentos da cobra na posicao indicada
    const vetor = CONSTANTES.DIRECOES[pos.direcao];
    jogador.cobra = [];
    for (let i = 0; i < CONSTANTES.COBRA.TAMANHO_INICIAL; i++) {
      jogador.cobra.push({
        x: pos.x - vetor.x * i,
        y: pos.y - vetor.y * i,
      });
    }
  }

  /**
   * Calcula posicoes iniciais distribuidas pelo mapa para ate 6 jogadores.
   * Cada posicao inclui uma direcao inicial que aponta para o centro.
   * @returns {Array<{x: number, y: number, direcao: string}>}
   * @private
   */
  _calcularPosicoesIniciais() {
    const m = 5; // Margem das bordas
    return [
      { x: m,                        y: m,                       direcao: 'direita' },
      { x: this.largura - m,         y: this.altura - m,         direcao: 'esquerda' },
      { x: this.largura - m,         y: m,                       direcao: 'baixo' },
      { x: m,                        y: this.altura - m,         direcao: 'cima' },
      { x: Math.floor(this.largura / 2), y: m,                  direcao: 'baixo' },
      { x: Math.floor(this.largura / 2), y: this.altura - m,    direcao: 'cima' },
    ];
  }

  /**
   * Conta quantos jogadores estao vivos na partida.
   * @returns {number} Quantidade de jogadores vivos.
   * @private
   */
  _contarJogadoresVivos() {
    let contagem = 0;
    for (const jogador of this.jogadores.values()) {
      if (jogador.vivo) contagem++;
    }
    return contagem;
  }
}

module.exports = SalaDeJogo;
