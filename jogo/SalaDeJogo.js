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

    /** @type {Array<object>} Eventos gerados fora do tick (ex: jogador saiu) */
    this.eventosPendentes = [];

    /** @type {number} Ticks restantes da contagem regressiva pre-partida */
    this.ticksContagem = 0;

    /* --- Encolhimento da arena --- */

    /** @type {number} Borda atual da arena (celulas de margem em cada lado) */
    this.bordaArena = 0;

    /** @type {number} Borda final apos todos os encolhimentos */
    this.bordaFinal = 8;

    /** @type {number} Total de encolhimentos para a duracao configurada */
    this.totalEncolhimentos = 0;

    /** @type {number} Encolhimentos ja realizados */
    this.encolhimentosFeitos = 0;

    /** @type {number} Ticks restantes de pausa durante encolhimento */
    this.pausaEncolhimento = 0;

    /** @type {boolean} Se a arena esta atualmente encolhendo */
    this.encolhendo = false;

    /** @type {number} Velocidade base atual das cobras (celulas/s); sobe a cada encolhimento */
    this.velocidadeBase = CONSTANTES.MULTI.VELOCIDADE_INICIAL;

    /** @type {string|null} ID do dono da sala (quem criou); pode expulsar e encerrar */
    this.donoId = null;

    /* --- Callbacks configurados pelo servidor --- */

    /** @type {Function|null} Chamado com o ranking final ao terminar a partida */
    this.aoFinalizarPartida = null;

    /** @type {Function|null} Chamado quando um jogador eh removido em definitivo */
    this.aoRemoverJogador = null;

    /** @type {Function|null} Chamado quando a sala fica sem humanos e deve ser destruida */
    this.aoEsvaziar = null;
  }

  /* =========================================================================
   * GERENCIAMENTO DE JOGADORES
   * ======================================================================= */

  /**
   * Escolhe a primeira cor que ainda nao esta em uso na sala.
   * Evita repetir a cor de um jogador presente quando outros ja sairam.
   * @returns {object} Cor { principal, secundaria, nome }.
   * @private
   */
  _proximaCorLivre() {
    const coresUsadas = new Set();
    for (const jogador of this.jogadores.values()) {
      coresUsadas.add(jogador.cor.principal);
    }
    for (const cor of CONSTANTES.CORES_COBRAS) {
      if (!coresUsadas.has(cor.principal)) return cor;
    }
    return CONSTANTES.CORES_COBRAS[this.jogadores.size % CONSTANTES.CORES_COBRAS.length];
  }

  /**
   * Normaliza um apelido vindo do cliente: garante string, remove
   * caracteres de controle e limita o tamanho.
   * @param {*} apelido - Valor bruto recebido do cliente.
   * @returns {string} Apelido seguro e nao-vazio.
   * @private
   */
  _sanitizarApelido(apelido) {
    const texto = String(apelido == null ? '' : apelido)
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .substring(0, 15);
    return texto || 'Jogador';
  }

  /**
   * Adiciona um novo jogador a sala.
   * Cada jogador recebe uma cor unica e seus dados iniciais.
   * @param {string} socketId - ID do socket do jogador.
   * @param {string} apelido - Nickname escolhido pelo jogador.
   * @param {string|null} [token] - Token de sessao para reconexao (opcional).
   */
  adicionarJogador(socketId, apelido, token) {
    const cor = this._proximaCorLivre();

    this.jogadores.set(socketId, {
      id: socketId,
      apelido: this._sanitizarApelido(apelido),
      cor,
      ehBot: false,
      pronto: false,
      token: typeof token === 'string' ? token : null,
      desconectado: false,
      ticksParaRemocao: 0,
      estavaVivo: true,
      cobra: [],
      direcao: 'direita',
      proximaDirecao: 'direita',
      filaDeDirecoes: [],
      pontuacao: 0,
      vidas: CONSTANTES.COBRA.VIDAS_INICIAIS,
      efeitos: this._novosEfeitos(),
      vivo: true,
      invulneravel: false,
      tempoInvulneravel: 0,
      progressoMovimento: 0, // Fracao de celula acumulada ate o proximo passo
      crescimento: 0,     // Segmentos pendentes para crescer
      eliminacoes: 0,     // Quantidade de jogadores eliminados
    });

    // Quem cria a sala (primeiro humano) vira o dono
    if (!this.donoId) this.donoId = socketId;
  }

  /**
   * Remove um jogador da sala e verifica se o jogo deve ser finalizado.
   * @param {string} socketId - ID do socket do jogador a remover.
   * @param {string} [motivo='saiu'] - 'saiu' | 'expulso' (muda o aviso no feed).
   */
  removerJogador(socketId, motivo = 'saiu') {
    const jogador = this.jogadores.get(socketId);
    this.jogadores.delete(socketId);
    this._garantirDono();

    // Se a partida esta em andamento, avisar os demais e verificar fim de jogo
    if (this.estado === 'jogando') {
      if (jogador) {
        this.eventosPendentes.push({
          tipo: motivo === 'expulso' ? 'jogador_expulso' : 'jogador_saiu',
          apelido: jogador.apelido,
        });
      }

      // Desconectados em periodo de graca ainda contam como "na disputa"
      const vivos = this._contarJogadoresVivos() + this._contarDesconectadosEmGraca();
      if (vivos <= 1) {
        this.finalizarJogo();
      }
    }
  }

  /* =========================================================================
   * RECONEXAO DE JOGADORES
   * Quando um jogador humano cai no meio da partida, ele entra em um
   * "periodo de graca": a cobra sai do tabuleiro (derrubando comida),
   * mas apelido, pontuacao, vidas e eliminacoes ficam reservados.
   * Se voltar a tempo com o mesmo token de sessao, renasce onde parou.
   * ======================================================================= */

  /**
   * Marca um jogador como desconectado, preservando seus dados para
   * uma possivel reconexao. So vale durante a partida e para humanos
   * que informaram token de sessao ao entrar.
   * @param {string} socketId - ID do socket que caiu.
   * @returns {boolean} True se o jogador entrou no periodo de graca.
   */
  marcarDesconectado(socketId) {
    const jogador = this.jogadores.get(socketId);
    if (!jogador || jogador.ehBot || !jogador.token) return false;
    if (this.estado !== 'jogando' || jogador.desconectado) return false;

    jogador.desconectado = true;
    jogador.ticksParaRemocao =
      CONSTANTES.MULTI.TEMPO_RECONEXAO * CONSTANTES.MULTI.TICKS_POR_SEGUNDO;
    jogador.estavaVivo = jogador.vivo;

    // Retirar a cobra do tabuleiro enquanto o jogador estiver fora,
    // derrubando comida como em uma morte (o corpo nao vira obstaculo fantasma)
    const corpoAnterior = jogador.cobra;
    jogador.vivo = false;
    jogador.cobra = [];
    jogador.filaDeDirecoes = [];
    this._droparComidaMorte(corpoAnterior);

    this.eventosPendentes.push({
      tipo: 'jogador_desconectou',
      jogadorId: jogador.id,
      apelido: jogador.apelido,
    });

    return true;
  }

  /**
   * Reconecta um jogador identificado pelo token de sessao, remapeando
   * seus dados para o novo socket. Tambem cobre "takeover": se o socket
   * antigo ainda constar como conectado (rede instavel), a sessao migra
   * para o novo socket mesmo assim.
   * @param {string} token - Token de sessao apresentado pelo cliente.
   * @param {string} novoSocketId - ID do novo socket.
   * @returns {{sucesso: boolean, erro?: string, socketIdAntigo?: string,
   *            estado?: string, apelido?: string}}
   */
  reconectarJogador(token, novoSocketId) {
    if (typeof token !== 'string' || !token) {
      return { sucesso: false, erro: 'Sessão inválida.' };
    }

    let jogador = null;
    let socketIdAntigo = null;
    for (const [chave, candidato] of this.jogadores) {
      if (!candidato.ehBot && candidato.token === token) {
        jogador = candidato;
        socketIdAntigo = chave;
        break;
      }
    }

    if (!jogador) {
      return { sucesso: false, erro: 'Sessão não encontrada nesta sala.' };
    }

    // Re-chavear o Map de jogadores para o novo socket
    this.jogadores.delete(socketIdAntigo);
    jogador.id = novoSocketId;
    this.jogadores.set(novoSocketId, jogador);
    if (this.donoId === socketIdAntigo) this.donoId = novoSocketId;

    if (jogador.desconectado) {
      jogador.desconectado = false;
      jogador.ticksParaRemocao = 0;

      // Renascer apenas quem ainda estava vivo e tem vidas; quem ja havia
      // sido eliminado volta como espectador ate o fim da partida
      if (this.estado === 'jogando' && jogador.estavaVivo && jogador.vidas > 0) {
        this._respawnarJogador(jogador);
        jogador.vivo = true;
      }

      this.eventosPendentes.push({
        tipo: 'jogador_reconectou',
        jogadorId: jogador.id,
        apelido: jogador.apelido,
      });
    }

    return {
      sucesso: true,
      socketIdAntigo,
      estado: this.estado,
      apelido: jogador.apelido,
    };
  }

  /**
   * Decrementa o periodo de graca dos desconectados e remove em
   * definitivo quem nao voltou a tempo.
   * @returns {boolean} True se o tick deve ser abortado (sala destruida
   *          ou partida finalizada por falta de adversarios).
   * @private
   */
  _atualizarGracaDesconectados() {
    let removeuAlguem = false;

    for (const [id, jogador] of [...this.jogadores]) {
      if (!jogador.desconectado) continue;

      jogador.ticksParaRemocao--;
      if (jogador.ticksParaRemocao > 0) continue;

      // Tempo esgotado: remocao definitiva
      this.jogadores.delete(id);
      removeuAlguem = true;
      this.eventosRecentes.push({
        tipo: 'jogador_saiu',
        apelido: jogador.apelido,
      });
      if (this.aoRemoverJogador) this.aoRemoverJogador(jogador);
    }

    if (!removeuAlguem) return false;
    this._garantirDono();

    // Sem nenhum humano restante (nem em graca): sala nao tem mais motivo de existir
    if (this.obterQuantidadeHumanos() === 0) {
      if (this.aoEsvaziar) this.aoEsvaziar();
      return true;
    }

    // Mesma regra da saida voluntaria: sobrando 1 na disputa, acabou
    const naDisputa = this._contarJogadoresVivos() + this._contarDesconectadosEmGraca();
    if (naDisputa <= 1) {
      this.finalizarJogo();
      return true;
    }

    return false;
  }

  /* =========================================================================
   * DONO DA SALA
   * O dono eh quem criou a sala. So ele pode expulsar jogadores e
   * encerrar a sala. Se ele sair de vez, o cargo passa ao proximo humano.
   * ======================================================================= */

  /**
   * Verifica se um socket eh o dono da sala.
   * @param {string} socketId - ID do socket.
   * @returns {boolean}
   */
  ehDono(socketId) {
    return !!socketId && this.donoId === socketId;
  }

  /**
   * Garante que o dono ainda esta na sala; se nao estiver, promove o
   * proximo humano (de preferencia um conectado). Bots nunca sao donos.
   * @private
   */
  _garantirDono() {
    const atual = this.jogadores.get(this.donoId);
    if (atual && !atual.ehBot) return;

    const humanos = [...this.jogadores.values()].filter(j => !j.ehBot);
    const proximo = humanos.find(j => !j.desconectado) || humanos[0];
    this.donoId = proximo ? proximo.id : null;
  }

  /**
   * Retira um jogador (humano ou bot) da sala por ordem do dono.
   * Nao cuida do socket do expulso — isso eh papel do servidor.
   * @param {string} solicitanteId - Socket de quem pediu a expulsao.
   * @param {string} alvoId - ID do jogador a expulsar.
   * @returns {{sucesso: boolean, erro?: string, jogador?: object}}
   */
  expulsarJogador(solicitanteId, alvoId) {
    if (!this.ehDono(solicitanteId)) {
      return { sucesso: false, erro: 'Só o dono da sala pode expulsar jogadores.' };
    }
    if (typeof alvoId !== 'string' || alvoId === solicitanteId) {
      return { sucesso: false, erro: 'Jogador inválido.' };
    }

    const jogador = this.jogadores.get(alvoId);
    if (!jogador) return { sucesso: false, erro: 'Jogador não está mais na sala.' };

    // A cobra sai do tabuleiro deixando comida, como em uma morte
    if (this.estado === 'jogando') this._droparComidaMorte(jogador.cobra);

    this.removerJogador(alvoId, 'expulso');
    return { sucesso: true, jogador };
  }

  /**
   * Conta os jogadores desconectados que ainda podem voltar.
   * @returns {number}
   * @private
   */
  _contarDesconectadosEmGraca() {
    let contagem = 0;
    for (const jogador of this.jogadores.values()) {
      if (jogador.desconectado) contagem++;
    }
    return contagem;
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

    const cor = this._proximaCorLivre();
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
      token: null,
      desconectado: false,
      ticksParaRemocao: 0,
      estavaVivo: true,
      cobra: [],
      direcao: 'direita',
      proximaDirecao: 'direita',
      filaDeDirecoes: [],
      pontuacao: 0,
      vidas: CONSTANTES.COBRA.VIDAS_INICIAIS,
      efeitos: this._novosEfeitos(),
      vivo: true,
      invulneravel: false,
      tempoInvulneravel: 0,
      progressoMovimento: 0, // Fracao de celula acumulada ate o proximo passo
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
    this.eventosPendentes = [];

    // Contagem regressiva de 3 segundos antes das cobras se moverem
    this.ticksContagem = 3 * CONSTANTES.MULTI.TICKS_POR_SEGUNDO;

    // Calcular encolhimentos de arena baseado no tempo
    const minutos = Math.floor(this.tempoPartida / 60);
    this.totalEncolhimentos = Math.max(0, minutos - 1);
    this.bordaArena = 0;
    this.encolhimentosFeitos = 0;
    this.pausaEncolhimento = 0;
    this.encolhendo = false;
    this.velocidadeBase = CONSTANTES.MULTI.VELOCIDADE_INICIAL;

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
    if (this.estado === 'finalizado') return; // Evitar dupla finalizacao
    this.estado = 'finalizado';

    if (this.intervaloJogo) {
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
    }

    // Montar ranking final (inclui desconectados: a pontuacao deles vale)
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

    // Registrar no ranking persistente (Hall da Fama)
    if (this.aoFinalizarPartida) {
      try {
        this.aoFinalizarPartida(ranking);
      } catch (erro) {
        console.error(`[Sala ${this.codigo}] Falha ao registrar ranking:`, erro.message);
      }
    }

    this.io.to(this.codigo).emit('partida-finalizada', { ranking });

    // Quem estava em periodo de graca nao tem mais partida para voltar
    for (const [id, jogador] of [...this.jogadores]) {
      if (jogador.desconectado) {
        this.jogadores.delete(id);
        if (this.aoRemoverJogador) this.aoRemoverJogador(jogador);
      }
    }
    this._garantirDono();
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

  /**
   * Reabre a sala apos uma partida finalizada (revanche).
   * Volta ao estado 'aguardando' preservando jogadores, bots e configuracoes.
   * @returns {boolean} True se a sala foi reaberta.
   */
  reiniciarParaLobby() {
    if (this.estado === 'jogando') return false;

    // Outro jogador ja reabriu a sala: nao resetar o "pronto" de ninguem
    if (this.estado === 'aguardando') return true;

    this.parar();
    this.estado = 'aguardando';
    this.comidas = [];
    this.eventosRecentes = [];
    this.eventosPendentes = [];
    this.bordaArena = 0;
    this.encolhendo = false;
    this.tempoRestante = this.tempoPartida;

    // Garantia extra: nenhum "fantasma" desconectado atravessa para o lobby
    for (const [id, jogador] of [...this.jogadores]) {
      if (jogador.desconectado) {
        this.jogadores.delete(id);
        if (this.aoRemoverJogador) this.aoRemoverJogador(jogador);
      }
    }
    this._garantirDono();

    for (const jogador of this.jogadores.values()) {
      jogador.pronto = jogador.ehBot; // Bots continuam prontos; humanos reconfirmam
      jogador.vivo = true;
      jogador.cobra = [];
      jogador.pontuacao = 0;
      jogador.eliminacoes = 0;
      jogador.vidas = CONSTANTES.COBRA.VIDAS_INICIAIS;
    }

    return true;
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
    // Whitelist: ignorar qualquer payload que nao seja uma direcao valida.
    // hasOwnProperty evita chaves herdadas ('__proto__', 'constructor') —
    // sem isso, um cliente malicioso corromperia o estado no proximo tick.
    if (typeof direcao !== 'string' ||
        !Object.prototype.hasOwnProperty.call(CONSTANTES.DIRECOES, direcao)) return;

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
   * Executa um tick do jogo protegido contra excecoes.
   * Um erro inesperado em uma sala nao pode derrubar o processo inteiro
   * (o setInterval transformaria a excecao em uncaughtException).
   * @private
   */
  _loopDoJogo() {
    try {
      this._executarTick();
    } catch (erro) {
      console.error(`[Sala ${this.codigo}] Erro no game loop:`, erro);
      try {
        this.finalizarJogo();
      } catch (erroFinal) {
        this.parar(); // Ultimo recurso: ao menos parar o loop desta sala
      }
    }
  }

  /**
   * Executa um tick do jogo. Este eh o coracao do servidor de jogo.
   * Cada tick: processa inputs, move cobras, verifica colisoes,
   * atualiza efeitos, mantem comida, e emite o estado atualizado.
   * @private
   */
  _executarTick() {
    // Incorporar eventos gerados entre ticks (ex: jogador desconectou)
    this.eventosRecentes = this.eventosPendentes;
    this.eventosPendentes = [];

    // 0a. Contagem regressiva pre-partida: nada se move ainda
    if (this.ticksContagem > 0) {
      this.ticksContagem--;
      this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
      return;
    }

    this.tickAtual++;

    // 0b. Se pausado para encolhimento da arena, apenas decrementar
    if (this.pausaEncolhimento > 0) {
      this.pausaEncolhimento--;
      if (this.pausaEncolhimento === 0) {
        this._aplicarEncolhimento();
      }
      this.io.to(this.codigo).emit('estado-jogo', this._obterEstadoJogo());
      return;
    }

    // 1a. Expirar periodos de graca de jogadores desconectados.
    // Se a sala ficou sem humanos, ela foi destruida: abortar o tick.
    if (this._atualizarGracaDesconectados()) return;

    // 1b. Atualizar temporizadores de efeitos e invulnerabilidade
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

    // 7. Reabastecer comida se necessario.
    // Se _gerarComida falhar (mapa lotado), interromper — um `while`
    // aqui travaria o servidor num loop infinito.
    while (this.comidas.length < CONSTANTES.MULTI.QUANTIDADE_COMIDA) {
      if (!this._gerarComida()) break;
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

    // 9. Verificar se resta apenas 1 jogador na disputa.
    // Desconectados em periodo de graca contam: eles podem voltar.
    const vivos = this._contarJogadoresVivos() + this._contarDesconectadosEmGraca();
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
   * Velocidade atual de uma cobra em celulas por segundo: a base da
   * arena (que sobe a cada encolhimento), multiplicada pelo raio se
   * ativo. Limitada a 1 celula por tick para nenhuma colisao ser pulada.
   * @param {object} jogador - Dados do jogador.
   * @returns {number} Celulas por segundo.
   * @private
   */
  _velocidadeDe(jogador) {
    const multi = CONSTANTES.MULTI;
    const velocidade = jogador.efeitos.velocidade.ativo
      ? this.velocidadeBase * multi.MULTIPLICADOR_RAIO
      : this.velocidadeBase;
    return Math.min(velocidade, multi.TICKS_POR_SEGUNDO);
  }

  /**
   * Move cada cobra viva de acordo com sua velocidade e direcao.
   * Cada tick soma "velocidade / ticks por segundo" ao progresso da
   * cobra; quando o progresso completa 1 celula, ela anda. Isso permite
   * velocidades fracionarias (ex.: 7 celulas/s) com o tick fixo.
   * @private
   */
  _moverCobras() {
    const ticksPorSegundo = CONSTANTES.MULTI.TICKS_POR_SEGUNDO;

    for (const jogador of this.jogadores.values()) {
      if (!jogador.vivo) continue;

      // Tolerancia: somar 1/6 seis vezes da 0.9999... em ponto flutuante
      jogador.progressoMovimento += this._velocidadeDe(jogador) / ticksPorSegundo;
      if (jogador.progressoMovimento < 1 - 1e-9) continue;
      jogador.progressoMovimento = Math.max(0, jogador.progressoMovimento - 1);

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

      case 'caveira':
        // Corpo letal: quem encostar morre na hora
        jogador.efeitos.caveira.ativo = true;
        jogador.efeitos.caveira.tempoRestante += tipos.CAVEIRA.duracao;
        this.eventosRecentes.push({
          tipo: 'caveira_ativada',
          jogadorId: jogador.id,
          apelido: jogador.apelido,
        });
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
   * - Caveira (corpo letal): qualquer contato com quem esta com a
   *   caveira mata o outro na hora — encostar no corpo dela, bater de
   *   frente ou ser tocado pela cabeca dela. O escudo protege (e reflete).
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

            // Alvo com caveira: encostou, morreu (so o escudo salva)
            if (alvo.efeitos.caveira.ativo) {
              if (!atacante.efeitos.escudo.ativo) this._matarPorCaveira(alvo, atacante);
              break;
            }

            // Atacante com caveira: em vez de cortar segmentos, mata o alvo
            if (atacante.efeitos.caveira.ativo) {
              this._matarPorCaveira(atacante, alvo);
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

    // Caveira de um lado so: o outro morre. Ambos com caveira: regra normal
    const caveiraA = jogadorA.efeitos.caveira.ativo;
    const caveiraB = jogadorB.efeitos.caveira.ativo;
    if (caveiraA && !caveiraB) {
      this._matarPorCaveira(jogadorA, jogadorB);
      return;
    }
    if (caveiraB && !caveiraA) {
      this._matarPorCaveira(jogadorB, jogadorA);
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
   * Mata na hora quem encostou em uma cobra com caveira, creditando a
   * eliminacao ao dono da caveira. Invulneraveis (recem-renascidos) escapam.
   * @param {object} dono - Jogador com a caveira ativa.
   * @param {object} vitima - Jogador que encostou.
   * @private
   */
  _matarPorCaveira(dono, vitima) {
    if (!vitima.vivo || vitima.invulneravel || vitima.cobra.length === 0) return;

    dono.pontuacao += CONSTANTES.PONTUACAO.ELIMINAR_JOGADOR;
    dono.eliminacoes++;

    this.eventosRecentes.push({
      tipo: 'caveira_matou',
      jogadorId: dono.id,
      apelido: dono.apelido,
      vitimaId: vitima.id,
      vitimaApelido: vitima.apelido,
      posicao: { ...vitima.cobra[0] },
    });

    this._processarMorte(vitima, 'caveira');
  }

  /**
   * Processa a morte ou perda de vida de um jogador.
   * Se o jogador ainda tem vidas, ele renasce (respawn).
   * Caso contrario, eh eliminado definitivamente.
   *
   * A invulnerabilidade pos-respawn protege apenas contra outras cobras.
   * Paredes continuam letais — sem isso, uma cobra invulneravel
   * atravessaria a borda e continuaria "viva" fora da arena.
   * @param {object} jogador - Dados do jogador.
   * @param {string} causa - Motivo da morte para log/eventos.
   * @private
   */
  _processarMorte(jogador, causa) {
    if (jogador.invulneravel && causa !== 'parede') return;

    jogador.vidas--;

    if (jogador.vidas > 0) {
      // Respawn: reposicionar a cobra em local seguro
      this._respawnarJogador(jogador);

      this.eventosRecentes.push({
        tipo: 'respawn',
        jogadorId: jogador.id,
        apelido: jogador.apelido,
        vidasRestantes: jogador.vidas,
      });
    } else {
      // Morte definitiva: dropar comida onde estava o corpo
      const corpoAnterior = jogador.cobra;
      jogador.vivo = false;
      jogador.cobra = [];

      this.eventosRecentes.push({
        tipo: 'morte',
        jogadorId: jogador.id,
        apelido: jogador.apelido,
        causa,
      });

      this._droparComidaMorte(corpoAnterior);
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
    jogador.progressoMovimento = 0;
    jogador.crescimento = 0;
    jogador.invulneravel = true;
    jogador.tempoInvulneravel = CONSTANTES.MULTI.TEMPO_INVULNERAVEL;
    jogador.efeitos = this._novosEfeitos();

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
   * Dropa comidas normais ao longo do corpo do jogador que morreu,
   * premiando quem chegar primeiro aos "restos" da cobra.
   * @param {Array<{x:number, y:number}>} corpo - Segmentos da cobra no momento da morte.
   * @private
   */
  _droparComidaMorte(corpo) {
    if (!corpo || corpo.length === 0) return;

    const maxDrop = Math.min(3, Math.ceil(corpo.length / 3));
    const dadosTipo = CONSTANTES.TIPOS_COMIDA.NORMAL;
    let dropados = 0;

    // Percorrer o corpo em intervalos regulares para espalhar as comidas
    const passo = Math.max(1, Math.floor(corpo.length / maxDrop));
    for (let i = 0; i < corpo.length && dropados < maxDrop; i += passo) {
      const pos = corpo[i];

      // So dropar dentro da arena ativa e em celula livre
      const dentroArena =
        pos.x >= this.bordaArena && pos.x < this.largura - this.bordaArena &&
        pos.y >= this.bordaArena && pos.y < this.altura - this.bordaArena;
      if (!dentroArena || this._posicaoOcupada(pos.x, pos.y)) continue;

      this.comidas.push({
        tipo: dadosTipo.tipo,
        posicao: { x: pos.x, y: pos.y },
        pontos: dadosTipo.pontos,
        cor: dadosTipo.cor,
        brilho: dadosTipo.brilho,
        descricao: dadosTipo.descricao,
        criadoEm: this.tickAtual,
      });
      dropados++;
    }
  }

  /* =========================================================================
   * GERACAO DE COMIDA
   * ======================================================================= */

  /**
   * Gera uma nova comida aleatoria em uma posicao livre do mapa.
   * O tipo da comida eh sorteado com base nas probabilidades definidas
   * nas constantes (sistema de roleta ponderada).
   * @returns {boolean} True se a comida foi criada.
   * @private
   */
  _gerarComida() {
    const posicao = this._encontrarPosicaoLivre();
    if (!posicao) return false; // Mapa completamente cheio (improvavel)

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
    return true;
  }

  /**
   * Sorteia um tipo de comida usando roleta ponderada (weighted random).
   * Comidas mais comuns tem maior probabilidade de aparecer.
   * @returns {string} Chave do tipo de comida em CONSTANTES.TIPOS_COMIDA.
   * @private
   */
  _sortearTipoComida() {
    // Caveira: chance propria e no maximo uma no mapa por vez
    const temCaveira = this.comidas.some(c => c.tipo === 'caveira');
    if (!temCaveira && Math.random() < CONSTANTES.MULTI.CHANCE_CAVEIRA) return 'CAVEIRA';

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

      // Efeito: caveira (corpo letal)
      if (jogador.efeitos.caveira.ativo) {
        jogador.efeitos.caveira.tempoRestante -= msPerTick;
        if (jogador.efeitos.caveira.tempoRestante <= 0) {
          jogador.efeitos.caveira.ativo = false;
          jogador.efeitos.caveira.tempoRestante = 0;
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
      donoId: this.donoId,
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
          caveira: jogador.efeitos.caveira.ativo,
          velocidadeTempo: jogador.efeitos.velocidade.tempoRestante,
          escudoTempo: jogador.efeitos.escudo.tempoRestante,
          caveiraTempo: jogador.efeitos.caveira.tempoRestante,
        },
        velocidade: this._velocidadeDe(jogador), // celulas/s (suaviza a interpolacao no cliente)
        ehRei: jogador.id === idRei,
        eliminacoes: jogador.eliminacoes,
        ehBot: jogador.ehBot,
        desconectado: jogador.desconectado,
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
      velocidadeBase: this.velocidadeBase,
      donoId: this.donoId,
      contagem: this.ticksContagem > 0
        ? Math.ceil(this.ticksContagem / CONSTANTES.MULTI.TICKS_POR_SEGUNDO)
        : 0,
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

    // Arena menor, cobras mais rapidas (o raio multiplica por cima disso)
    const multi = CONSTANTES.MULTI;
    this.velocidadeBase = Math.min(
      this.velocidadeBase * multi.ACELERACAO_POR_ENCOLHIMENTO,
      multi.VELOCIDADE_MAXIMA_BASE
    );

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
      velocidadeBase: this.velocidadeBase,
    });
  }

  /* =========================================================================
   * UTILITARIOS INTERNOS
   * ======================================================================= */

  /**
   * Cria o objeto de efeitos temporarios zerado de uma cobra.
   * @returns {object} { velocidade, escudo, caveira }.
   * @private
   */
  _novosEfeitos() {
    return {
      velocidade: { ativo: false, tempoRestante: 0 },
      escudo: { ativo: false, tempoRestante: 0 },
      caveira: { ativo: false, tempoRestante: 0 },
    };
  }

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
    jogador.progressoMovimento = 0;
    jogador.crescimento = 0;
    jogador.eliminacoes = 0;
    jogador.invulneravel = true;
    jogador.tempoInvulneravel = CONSTANTES.MULTI.TEMPO_INVULNERAVEL;
    jogador.efeitos = this._novosEfeitos();

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
