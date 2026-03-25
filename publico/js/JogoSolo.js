/**
 * @fileoverview Logica completa do modo solo do jogo Snake.
 *
 * Gerencia todo o ciclo de vida do jogo solo: inicializacao, loop de jogo,
 * controles (teclado e touch), movimentacao da cobra, colisoes, comidas
 * especiais, sistema de vidas, pontuacao e recordes (localStorage).
 *
 * O jogo roda inteiramente no cliente, sem necessidade de servidor.
 * O estado eh atualizado a cada tick (controlado por setInterval) e
 * renderizado a cada frame (requestAnimationFrame).
 *
 * Padrao utilizado: Game Loop Pattern - separa a logica de atualizacao
 * (tick fixo) da renderizacao (frame rate variavel) para garantir
 * jogabilidade consistente independente da taxa de quadros.
 *
 * @class JogoSolo
 */

class JogoSolo {
  /**
   * Inicializa o jogo solo, configurando canvas, renderizador e controles.
   */
  constructor() {
    // Elementos do DOM
    this.canvas = document.getElementById('canvas-jogo');
    this.elPontuacao = document.getElementById('pontuacao');
    this.elRecorde = document.getElementById('recorde');
    this.elVidas = document.getElementById('vidas');
    this.elBarraEfeitos = document.getElementById('barra-efeitos');
    this.elTempo = document.getElementById('tempo');
    this.elTelaInicio = document.getElementById('tela-inicio');
    this.elTelaGameover = document.getElementById('tela-gameover');
    this.elTelaPausado = document.getElementById('tela-pausado');
    this.elPontuacaoFinal = document.getElementById('pontuacao-final');
    this.elTempoFinal = document.getElementById('tempo-final');
    this.elNovoRecorde = document.getElementById('novo-recorde');

    // Configuracoes do grid
    this.larguraGrid = CONSTANTES.TABULEIRO.LARGURA_SOLO;
    this.alturaGrid = CONSTANTES.TABULEIRO.ALTURA_SOLO;

    // Inicializar renderizador e sistema de particulas
    this.renderizador = new Renderizador(this.canvas, this.larguraGrid, this.alturaGrid);
    this.particulas = new SistemaDeParticulas(this.renderizador.ctx);

    // Estado do jogo
    this.estado = 'inicio'; // inicio | jogando | pausado | gameover
    this.cobra = [];
    this.direcao = 'direita';
    this.proximaDirecao = 'direita';
    this.filaDeDirecoes = [];
    this.comidas = [];
    this.pontuacao = 0;
    this.vidas = CONSTANTES.COBRA.VIDAS_INICIAIS;
    this.crescimento = 0;
    this.invulneravel = false;
    this.tempoInvulneravel = 0;

    // Efeitos ativos
    this.efeitos = {
      velocidade: { ativo: false, tempoRestante: 0 },
    };

    // Timer de tempo jogado (em milissegundos)
    this.tempoJogado = 0;

    // Controle de velocidade
    this.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
    this.contadorMovimento = 0;

    // Referencia aos intervals/animation frames
    this.intervaloJogo = null;
    this.frameAnimacao = null;

    // Carregar recorde do localStorage
    this.recorde = this._carregarRecorde();
    this.elRecorde.textContent = this.recorde.toLocaleString('pt-BR');

    // Configurar controles
    this._configurarControles();

    // Configurar botoes
    this._configurarBotoes();

    // Iniciar loop de renderizacao (sempre ativo para animacoes de fundo)
    this._iniciarRenderizacao();
  }

  /* =========================================================================
   * INICIALIZACAO E CONTROLE DE ESTADO
   * ======================================================================= */

  /**
   * Inicia uma nova partida: reseta todos os estados e comeca o game loop.
   */
  iniciar() {
    // Resetar estado
    this.pontuacao = 0;
    this.vidas = CONSTANTES.COBRA.VIDAS_INICIAIS;
    this.direcao = 'direita';
    this.proximaDirecao = 'direita';
    this.filaDeDirecoes = [];
    this.crescimento = 0;
    this.invulneravel = false;
    this.tempoInvulneravel = 0;
    this.contadorMovimento = 0;
    this.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
    this.efeitos = {
      velocidade: { ativo: false, tempoRestante: 0 },
    };
    this.tempoJogado = 0;

    // Posicionar cobra no centro do mapa
    const centroX = Math.floor(this.larguraGrid / 2);
    const centroY = Math.floor(this.alturaGrid / 2);
    this.cobra = [];
    for (let i = 0; i < CONSTANTES.COBRA.TAMANHO_INICIAL; i++) {
      this.cobra.push({ x: centroX - i, y: centroY });
    }

    // Gerar comidas iniciais
    this.comidas = [];
    for (let i = 0; i < CONSTANTES.SOLO.QUANTIDADE_COMIDA; i++) {
      this._gerarComida();
    }

    // Limpar particulas
    this.particulas.limpar();

    // Atualizar HUD
    this._atualizarHUD();

    // Esconder overlays
    this.elTelaInicio.style.display = 'none';
    this.elTelaGameover.style.display = 'none';
    this.elTelaPausado.style.display = 'none';

    // Mudar estado e iniciar loop logico
    this.estado = 'jogando';

    if (this.intervaloJogo) clearInterval(this.intervaloJogo);
    const msPerTick = 1000 / CONSTANTES.SOLO.TICKS_POR_SEGUNDO;
    this.intervaloJogo = setInterval(() => this._tick(), msPerTick);
  }

  /**
   * Pausa ou retoma o jogo.
   */
  alternarPausa() {
    if (this.estado === 'jogando') {
      this.estado = 'pausado';
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
      this.elTelaPausado.style.display = 'flex';
    } else if (this.estado === 'pausado') {
      this.estado = 'jogando';
      this.elTelaPausado.style.display = 'none';
      const msPerTick = 1000 / CONSTANTES.SOLO.TICKS_POR_SEGUNDO;
      this.intervaloJogo = setInterval(() => this._tick(), msPerTick);
    }
  }

  /**
   * Finaliza o jogo (game over).
   * Para o loop, salva recorde se necessario e exibe tela de resultado.
   */
  _gameOver() {
    this.estado = 'gameover';

    if (this.intervaloJogo) {
      clearInterval(this.intervaloJogo);
      this.intervaloJogo = null;
    }

    // Verificar e salvar recorde
    const novoRecorde = this.pontuacao > this.recorde;
    if (novoRecorde) {
      this.recorde = this.pontuacao;
      this._salvarRecorde(this.pontuacao);
      this.elRecorde.textContent = this.recorde.toLocaleString('pt-BR');
    }

    // Exibir tela de game over
    this.elPontuacaoFinal.textContent = this.pontuacao.toLocaleString('pt-BR');
    const totalSegs = Math.floor(this.tempoJogado / 1000);
    const mins = Math.floor(totalSegs / 60);
    const segs = totalSegs % 60;
    this.elTempoFinal.textContent =
      String(mins).padStart(2, '0') + ':' + String(segs).padStart(2, '0');
    this.elNovoRecorde.style.display = novoRecorde ? 'block' : 'none';
    this.elTelaGameover.style.display = 'flex';

    // Explosao dramatica de particulas
    if (this.cobra.length > 0) {
      const cabeca = this.cobra[0];
      const tam = this.renderizador.tamanhoCelula;
      this.particulas.criarExplosaoGrande(
        cabeca.x * tam + tam / 2,
        cabeca.y * tam + tam / 2,
        '#ff4444'
      );
    }
  }

  /* =========================================================================
   * LOOP DO JOGO
   * ======================================================================= */

  /**
   * Executa um tick logico do jogo.
   * Processa input, move a cobra, verifica colisoes e atualiza efeitos.
   * @private
   */
  _tick() {
    // Atualizar temporizadores de efeitos
    this._atualizarEfeitos();

    // Atualizar timer de tempo jogado
    this.tempoJogado += 1000 / CONSTANTES.SOLO.TICKS_POR_SEGUNDO;

    // Sistema de velocidade: a cobra so move quando o contador atinge o limite
    this.contadorMovimento++;
    if (this.contadorMovimento < this.velocidadeAtual) return;
    this.contadorMovimento = 0;

    // Processar fila de direcoes (previne giro 180 e perda de inputs rapidos)
    if (this.filaDeDirecoes.length > 0) {
      const novaDirecao = this.filaDeDirecoes.shift();
      if (novaDirecao !== CONSTANTES.DIRECAO_OPOSTA[this.direcao]) {
        this.direcao = novaDirecao;
      }
    }

    // Calcular nova posicao da cabeca
    const vetor = CONSTANTES.DIRECOES[this.direcao];
    const cabecaAtual = this.cobra[0];
    const novaCabeca = {
      x: cabecaAtual.x + vetor.x,
      y: cabecaAtual.y + vetor.y,
    };

    // Verificar colisao com paredes
    if (novaCabeca.x < 0 || novaCabeca.x >= this.larguraGrid ||
        novaCabeca.y < 0 || novaCabeca.y >= this.alturaGrid) {
      this._processarColisao();
      return;
    }

    // Verificar auto-colisao (cobra bateu em si mesma)
    for (let i = 0; i < this.cobra.length; i++) {
      if (novaCabeca.x === this.cobra[i].x && novaCabeca.y === this.cobra[i].y) {
        this._processarColisao();
        return;
      }
    }

    // Mover: adicionar nova cabeca
    this.cobra.unshift(novaCabeca);

    // Crescer ou manter tamanho
    if (this.crescimento > 0) {
      this.crescimento--;
    } else {
      this.cobra.pop();
    }

    // Verificar colisao com comida
    this._verificarComida();

    // Manter quantidade de comida no mapa
    while (this.comidas.length < CONSTANTES.SOLO.QUANTIDADE_COMIDA) {
      this._gerarComida();
    }

    // Atualizar HUD
    this._atualizarHUD();
  }

  /**
   * Processa uma colisao (parede ou auto-colisao).
   * Se tem escudo ativo, ignora. Se tem vidas, perde uma e faz respawn.
   * Caso contrario, game over.
   * @private
   */
  _processarColisao() {
    if (this.invulneravel) return;

    this.vidas--;
    this._atualizarHUD();

    if (this.vidas <= 0) {
      this._gameOver();
      return;
    }

    // Respawn: reposicionar cobra
    this._respawnar();
  }

  /**
   * Reposiciona a cobra no centro do mapa apos perder uma vida.
   * Concede invulnerabilidade temporaria.
   * @private
   */
  _respawnar() {
    const centroX = Math.floor(this.larguraGrid / 2);
    const centroY = Math.floor(this.alturaGrid / 2);

    this.direcao = 'direita';
    this.filaDeDirecoes = [];
    this.crescimento = 0;
    this.contadorMovimento = 0;
    this.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
    this.efeitos.velocidade = { ativo: false, tempoRestante: 0 };

    // Cobra com tamanho inicial
    this.cobra = [];
    for (let i = 0; i < CONSTANTES.COBRA.TAMANHO_INICIAL; i++) {
      this.cobra.push({ x: centroX - i, y: centroY });
    }

    // Invulnerabilidade temporaria (3 segundos)
    this.invulneravel = true;
    this.tempoInvulneravel = 3000;

    // Efeito visual de respawn
    const tam = this.renderizador.tamanhoCelula;
    this.particulas.criarExplosao(
      centroX * tam + tam / 2,
      centroY * tam + tam / 2,
      '#ffffff',
      20
    );
  }

  /* =========================================================================
   * COMIDA
   * ======================================================================= */

  /**
   * Verifica se a cabeca da cobra colidiu com alguma comida.
   * Aplica os efeitos correspondentes ao tipo de comida coletada.
   * @private
   */
  _verificarComida() {
    const cabeca = this.cobra[0];
    const tam = this.renderizador.tamanhoCelula;

    for (let i = this.comidas.length - 1; i >= 0; i--) {
      const comida = this.comidas[i];

      if (cabeca.x === comida.posicao.x && cabeca.y === comida.posicao.y) {
        // Somar pontos
        this.pontuacao += comida.pontos;

        // Aplicar efeito conforme o tipo
        this._aplicarEfeitoComida(comida);

        // Efeitos visuais: explosao de particulas e texto flutuante
        const cx = comida.posicao.x * tam + tam / 2;
        const cy = comida.posicao.y * tam + tam / 2;
        this.particulas.criarExplosao(cx, cy, comida.cor, 12);
        this.particulas.criarTextoFlutuante(cx, cy - 10, `+${comida.pontos}`, comida.cor);

        // Remover comida consumida
        this.comidas.splice(i, 1);
        break;
      }
    }
  }

  /**
   * Aplica o efeito especifico de cada tipo de comida.
   * @param {object} comida - Dados da comida coletada.
   * @private
   */
  _aplicarEfeitoComida(comida) {
    const tipos = CONSTANTES.TIPOS_COMIDA;

    switch (comida.tipo) {
      case 'normal':
        this.crescimento += tipos.NORMAL.segmentos;
        break;

      case 'velocidade':
        this.efeitos.velocidade.ativo = true;
        this.efeitos.velocidade.tempoRestante += tipos.VELOCIDADE.duracao;
        this.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_RAPIDA;
        break;

      case 'dourada':
        this.crescimento += tipos.DOURADA.segmentos;
        break;

      case 'vida':
        this.vidas++;
        break;
    }
  }

  /**
   * Gera uma nova comida aleatoria em posicao livre.
   * Usa sistema de roleta ponderada para sortear o tipo.
   * @private
   */
  _gerarComida() {
    const posicao = this._encontrarPosicaoLivre();
    if (!posicao) return;

    // Sortear tipo com roleta ponderada (sem escudo no modo solo)
    const tiposDisponiveis = Object.values(CONSTANTES.TIPOS_COMIDA)
      .filter(t => t.tipo !== 'escudo');
    const somaProb = tiposDisponiveis.reduce((s, t) => s + t.probabilidade, 0);

    const sorteio = Math.random() * somaProb;
    let acumulado = 0;
    let tipoSorteado = CONSTANTES.TIPOS_COMIDA.NORMAL;

    for (const tipo of tiposDisponiveis) {
      acumulado += tipo.probabilidade;
      if (sorteio <= acumulado) {
        tipoSorteado = tipo;
        break;
      }
    }

    this.comidas.push({
      tipo: tipoSorteado.tipo,
      posicao,
      pontos: tipoSorteado.pontos,
      cor: tipoSorteado.cor,
      brilho: tipoSorteado.brilho,
      descricao: tipoSorteado.descricao,
    });
  }

  /**
   * Encontra uma posicao aleatoria no grid que nao esteja ocupada.
   * @returns {{x:number, y:number}|null} Posicao livre ou null.
   * @private
   */
  _encontrarPosicaoLivre() {
    for (let tentativa = 0; tentativa < 100; tentativa++) {
      const x = Math.floor(Math.random() * this.larguraGrid);
      const y = Math.floor(Math.random() * this.alturaGrid);

      // Verificar se a cobra esta nessa posicao
      let ocupada = false;
      for (const seg of this.cobra) {
        if (seg.x === x && seg.y === y) {
          ocupada = true;
          break;
        }
      }

      // Verificar se outra comida esta nessa posicao
      if (!ocupada) {
        for (const c of this.comidas) {
          if (c.posicao.x === x && c.posicao.y === y) {
            ocupada = true;
            break;
          }
        }
      }

      if (!ocupada) return { x, y };
    }

    return null;
  }

  /* =========================================================================
   * EFEITOS TEMPORARIOS
   * ======================================================================= */

  /**
   * Atualiza os temporizadores dos efeitos ativos e a invulnerabilidade.
   * @private
   */
  _atualizarEfeitos() {
    const msPerTick = 1000 / CONSTANTES.SOLO.TICKS_POR_SEGUNDO;

    // Invulnerabilidade pos-respawn
    if (this.invulneravel) {
      this.tempoInvulneravel -= msPerTick;
      if (this.tempoInvulneravel <= 0) {
        this.invulneravel = false;
        this.tempoInvulneravel = 0;
      }
    }

    // Boost de velocidade
    if (this.efeitos.velocidade.ativo) {
      this.efeitos.velocidade.tempoRestante -= msPerTick;
      if (this.efeitos.velocidade.tempoRestante <= 0) {
        this.efeitos.velocidade.ativo = false;
        this.efeitos.velocidade.tempoRestante = 0;
        this.velocidadeAtual = CONSTANTES.COBRA.VELOCIDADE_BASE;
      }
    }
  }

  /* =========================================================================
   * RENDERIZACAO
   * ======================================================================= */

  /**
   * Inicia o loop de renderizacao com requestAnimationFrame.
   * Sempre ativo para manter animacoes de particulas mesmo com jogo pausado.
   * @private
   */
  _iniciarRenderizacao() {
    const renderizar = () => {
      this._renderizarFrame();
      this.frameAnimacao = requestAnimationFrame(renderizar);
    };
    renderizar();
  }

  /**
   * Renderiza um frame completo: fundo, comidas, cobra, particulas.
   * @private
   */
  _renderizarFrame() {
    const rend = this.renderizador;

    // Atualizar tick de animacao
    rend.atualizarAnimacao();

    // Desenhar fundo com grade
    rend.desenharFundo();

    // Desenhar comidas (se o jogo estiver ativo)
    if (this.estado === 'jogando' || this.estado === 'pausado') {
      for (const comida of this.comidas) {
        rend.desenharComida(comida.posicao, comida.tipo, comida.cor, comida.brilho);
      }

      // Desenhar cobra
      rend.desenharCobra(
        this.cobra,
        '#00ff88',     // Cor principal (verde neon)
        '#00cc66',     // Cor secundaria
        this.direcao,
        {
          escudo: false,
          invulneravel: this.invulneravel,
          velocidade: this.efeitos.velocidade.ativo,
        }
      );

      // Trilha de particulas se em velocidade
      if (this.efeitos.velocidade.ativo && this.cobra.length > 0) {
        const cauda = this.cobra[this.cobra.length - 1];
        const tam = rend.tamanhoCelula;
        this.particulas.criarTrilha(
          cauda.x * tam + tam / 2,
          cauda.y * tam + tam / 2,
          '#ffee00'
        );
      }

    }

    // Atualizar e renderizar particulas (sempre ativo para animacoes)
    this.particulas.atualizar();
    this.particulas.renderizar();

    // Atualizar barra de efeitos no HUD
    this._atualizarBarraEfeitos();
  }

  /* =========================================================================
   * INTERFACE (HUD)
   * ======================================================================= */

  /**
   * Atualiza os elementos do HUD: pontuacao, vidas.
   * @private
   */
  _atualizarHUD() {
    this.elPontuacao.textContent = this.pontuacao.toLocaleString('pt-BR');

    // Timer formatado como MM:SS
    const totalSegs = Math.floor(this.tempoJogado / 1000);
    const mins = Math.floor(totalSegs / 60);
    const segs = totalSegs % 60;
    this.elTempo.textContent =
      String(mins).padStart(2, '0') + ':' + String(segs).padStart(2, '0');

    // Vidas como coracoes
    let vidasHtml = '';
    for (let i = 0; i < this.vidas; i++) {
      vidasHtml += '❤️';
    }
    this.elVidas.textContent = vidasHtml || '💀';
  }

  /**
   * Atualiza a barra de efeitos ativos mostrada abaixo do HUD.
   * Exibe chips coloridos para cada efeito temporario ativo.
   * @private
   */
  _atualizarBarraEfeitos() {
    let html = '';

    if (this.efeitos.velocidade.ativo) {
      const segs = Math.ceil(this.efeitos.velocidade.tempoRestante / 1000);
      html += `<div class="efeito-ativo efeito-velocidade">⚡ Velocidade ${segs}s</div>`;
    }

    this.elBarraEfeitos.innerHTML = html;
  }

  /* =========================================================================
   * CONTROLES (TECLADO + TOUCH)
   * ======================================================================= */

  /**
   * Configura os event listeners para teclado e controles touch.
   * @private
   */
  _configurarControles() {
    // Controles por teclado
    document.addEventListener('keydown', (evento) => {
      this._processarTecla(evento);
    });

    // Controles touch (botoes direcionais mobile)
    const botoesDirecao = document.querySelectorAll('.botao-direcao');
    botoesDirecao.forEach((botao) => {
      botao.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const direcao = botao.getAttribute('data-direcao');
        this._adicionarDirecao(direcao);
      });
      botao.addEventListener('click', () => {
        const direcao = botao.getAttribute('data-direcao');
        this._adicionarDirecao(direcao);
      });
    });

    // Swipe no canvas para mobile
    this._configurarSwipe();
  }

  /**
   * Processa uma tecla pressionada e mapeia para acoes do jogo.
   * @param {KeyboardEvent} evento - Evento do teclado.
   * @private
   */
  _processarTecla(evento) {
    const mapa = {
      ArrowUp: 'cima', ArrowDown: 'baixo', ArrowLeft: 'esquerda', ArrowRight: 'direita',
      w: 'cima', W: 'cima', s: 'baixo', S: 'baixo',
      a: 'esquerda', A: 'esquerda', d: 'direita', D: 'direita',
    };

    const direcao = mapa[evento.key];

    if (direcao) {
      evento.preventDefault();
      this._adicionarDirecao(direcao);
      return;
    }

    // Pausar com ESC ou P
    if (evento.key === 'Escape' || evento.key === 'p' || evento.key === 'P') {
      if (this.estado === 'jogando' || this.estado === 'pausado') {
        this.alternarPausa();
      }
    }
  }

  /**
   * Adiciona uma direcao a fila de movimentos.
   * Validacoes: nao permite 180 graus nem direcoes duplicadas seguidas.
   * @param {string} direcao - Direcao a adicionar.
   * @private
   */
  _adicionarDirecao(direcao) {
    if (this.estado !== 'jogando') return;
    if (this.filaDeDirecoes.length >= 3) return;

    const ultima = this.filaDeDirecoes.length > 0
      ? this.filaDeDirecoes[this.filaDeDirecoes.length - 1]
      : this.direcao;

    if (direcao === CONSTANTES.DIRECAO_OPOSTA[ultima]) return;
    if (direcao === ultima) return;

    this.filaDeDirecoes.push(direcao);
  }

  /**
   * Configura deteccao de swipe no canvas para dispositivos touch.
   * @private
   */
  _configurarSwipe() {
    let inicioX = 0;
    let inicioY = 0;

    this.canvas.addEventListener('touchstart', (e) => {
      inicioX = e.touches[0].clientX;
      inicioY = e.touches[0].clientY;
    }, { passive: true });

    this.canvas.addEventListener('touchend', (e) => {
      const fimX = e.changedTouches[0].clientX;
      const fimY = e.changedTouches[0].clientY;
      const dx = fimX - inicioX;
      const dy = fimY - inicioY;

      // Exigir um minimo de deslocamento para registrar o swipe
      const distanciaMinima = 30;
      if (Math.abs(dx) < distanciaMinima && Math.abs(dy) < distanciaMinima) return;

      // Determinar direcao predominante (horizontal ou vertical)
      if (Math.abs(dx) > Math.abs(dy)) {
        this._adicionarDirecao(dx > 0 ? 'direita' : 'esquerda');
      } else {
        this._adicionarDirecao(dy > 0 ? 'baixo' : 'cima');
      }
    });
  }

  /* =========================================================================
   * BOTOES DA INTERFACE
   * ======================================================================= */

  /**
   * Configura os event listeners dos botoes de iniciar/reiniciar.
   * @private
   */
  _configurarBotoes() {
    document.getElementById('botao-iniciar').addEventListener('click', () => {
      this.iniciar();
    });

    document.getElementById('botao-reiniciar').addEventListener('click', () => {
      this.iniciar();
    });
  }

  /* =========================================================================
   * PERSISTENCIA DE RECORDES (localStorage)
   * ======================================================================= */

  /**
   * Carrega o maior recorde salvo no localStorage.
   * @returns {number} Maior pontuacao registrada ou 0.
   * @private
   */
  _carregarRecorde() {
    try {
      const recordes = JSON.parse(localStorage.getItem('snake_recordes') || '[]');
      if (recordes.length === 0) return 0;
      return Math.max(...recordes.map(r => r.pontuacao));
    } catch {
      return 0;
    }
  }

  /**
   * Salva uma nova pontuacao na lista de recordes do localStorage.
   * Mantem apenas os 10 melhores registros.
   * @param {number} pontuacao - Pontuacao a salvar.
   * @private
   */
  _salvarRecorde(pontuacao) {
    try {
      const recordes = JSON.parse(localStorage.getItem('snake_recordes') || '[]');
      recordes.push({
        pontuacao,
        data: new Date().toISOString(),
      });

      // Ordenar e manter apenas top 10
      recordes.sort((a, b) => b.pontuacao - a.pontuacao);
      const top10 = recordes.slice(0, 10);

      localStorage.setItem('snake_recordes', JSON.stringify(top10));
    } catch {
      // Ignorar erros de localStorage (modo privado, etc)
    }
  }
}

/* =========================================================================
 * INICIALIZACAO
 * Cria a instancia do jogo quando a pagina terminar de carregar.
 * ======================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  window.jogoSolo = new JogoSolo();
});
