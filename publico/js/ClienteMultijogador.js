/**
 * @fileoverview Cliente multiplayer do jogo Snake.
 *
 * Gerencia toda a interacao do jogador com o modo multiplayer:
 * - Conexao via Socket.IO com o servidor
 * - Fluxo de telas: Lobby -> Sala de espera -> Jogo -> Resultado
 * - Envio de inputs (direcao) ao servidor
 * - Recepcao e renderizacao do estado de jogo em tempo real
 * - Exibicao de HUD, placar, feed de eventos e ranking final
 *
 * No modo multiplayer, o servidor eh autoritativo: toda a logica
 * de jogo (movimento, colisoes, comida) roda no servidor, e o
 * cliente apenas envia inputs e renderiza o estado recebido.
 *
 * Padrao utilizado: Observer Pattern - o cliente se inscreve em
 * eventos do Socket.IO e reage a cada atualizacao do servidor.
 *
 * @class ClienteMultijogador
 */

class ClienteMultijogador {
  /**
   * Inicializa o cliente multiplayer e conecta ao servidor.
   */
  constructor() {
    /* -----------------------------------------------------------------------
     * ELEMENTOS DO DOM
     * --------------------------------------------------------------------- */

    // Telas
    this.elTelaLobby = document.getElementById('tela-lobby');
    this.elTelaSala = document.getElementById('tela-sala');
    this.elTelaJogo = document.getElementById('tela-jogo');
    this.elTelaResultado = document.getElementById('tela-resultado');

    // Lobby
    this.elInputApelido = document.getElementById('input-apelido');
    this.elBotaoCriarSala = document.getElementById('botao-criar-sala');
    this.elInputCodigoSala = document.getElementById('input-codigo-sala');
    this.elBotaoEntrarSala = document.getElementById('botao-entrar-sala');
    this.elListaSalas = document.getElementById('lista-salas');
    this.elBotaoAtualizarSalas = document.getElementById('botao-atualizar-salas');
    this.elLobbyErro = document.getElementById('lobby-erro');

    // Sala de espera
    this.elSalaCodigo = document.getElementById('sala-codigo');
    this.elListaJogadoresSala = document.getElementById('lista-jogadores-sala');
    this.elBotaoPronto = document.getElementById('botao-pronto');
    this.elBotaoIniciarPartida = document.getElementById('botao-iniciar-partida');
    this.elBotaoSairSala = document.getElementById('botao-sair-sala');
    this.elSalaStatus = document.getElementById('sala-status');
    this.elBotaoAdicionarBot = document.getElementById('botao-adicionar-bot');
    this.elBotaoRemoverBot = document.getElementById('botao-remover-bot');
    this.elQuantidadeBots = document.getElementById('quantidade-bots');
    this.elLinhaDificuldade = document.getElementById('linha-dificuldade');
    this.elBotoesDificuldade = document.querySelectorAll('#bots-dificuldade .botao-dificuldade');
    this.elBotoesTempo = document.querySelectorAll('#opcoes-tempo .botao-opcao');

    // Jogo
    this.canvasMulti = document.getElementById('canvas-multi');
    this.elMultiTempo = document.getElementById('multi-tempo');
    this.elMultiPontuacao = document.getElementById('multi-pontuacao');
    this.elMultiVidas = document.getElementById('multi-vidas');
    this.elMultiBarraEfeitos = document.getElementById('multi-barra-efeitos');
    this.elPlacarLateral = document.getElementById('placar-lateral');
    this.elFeedEventos = document.getElementById('feed-eventos');

    // Resultado
    this.elRankingFinal = document.getElementById('ranking-final');
    this.elBotaoJogarNovamente = document.getElementById('botao-jogar-novamente');

    /* -----------------------------------------------------------------------
     * ESTADO DO CLIENTE
     * --------------------------------------------------------------------- */

    /** @type {string|null} Codigo da sala atual */
    this.codigoSala = null;

    /** @type {string} Apelido do jogador */
    this.apelido = '';

    /** @type {boolean} Se o jogador esta marcado como pronto */
    this.estouPronto = false;

    /** @type {string} Tela ativa atual */
    this.telaAtiva = 'lobby';

    /** @type {object|null} Ultimo estado de jogo recebido do servidor */
    this.ultimoEstado = null;

    /** @type {Renderizador|null} Renderizador do canvas */
    this.renderizador = null;

    /** @type {SistemaDeParticulas|null} Sistema de particulas */
    this.particulas = null;

    /** @type {number|null} requestAnimationFrame ID */
    this.frameAnimacao = null;

    /* -----------------------------------------------------------------------
     * CONEXAO SOCKET.IO
     * --------------------------------------------------------------------- */

    /** @type {import('socket.io-client').Socket} */
    this.socket = io();

    // Registrar eventos do socket
    this._registrarEventosSocket();

    // Configurar controles e botoes
    this._configurarControles();
    this._configurarBotoes();

    // Carregar lista de salas ao iniciar
    this._atualizarListaSalas();

    // Recuperar apelido salvo (se houver)
    const apelidoSalvo = localStorage.getItem('snake_apelido');
    if (apelidoSalvo) {
      this.elInputApelido.value = apelidoSalvo;
    }
  }

  /* =========================================================================
   * EVENTOS DO SOCKET.IO
   * ======================================================================= */

  /**
   * Registra todos os listeners de eventos vindos do servidor.
   * @private
   */
  _registrarEventosSocket() {
    /**
     * Evento: sala-atualizada
     * Recebido quando o estado do lobby/sala muda (jogador entrou, saiu, ficou pronto).
     */
    this.socket.on('sala-atualizada', (infoSala) => {
      this._atualizarSalaEspera(infoSala);
    });

    /**
     * Evento: partida-iniciada
     * Recebido quando todos estao prontos e o jogo comecou.
     */
    this.socket.on('partida-iniciada', () => {
      this._iniciarTelaJogo();
    });

    /**
     * Evento: estado-jogo
     * Recebido a cada tick do servidor com o estado completo do jogo.
     * Este eh o evento mais frequente e critico para o desempenho.
     */
    this.socket.on('estado-jogo', (estado) => {
      this.ultimoEstado = estado;
      this._processarEventos(estado.eventos);
    });

    /**
     * Evento: partida-finalizada
     * Recebido quando a partida termina (tempo esgotado ou 1 sobrevivente).
     */
    this.socket.on('partida-finalizada', (resultado) => {
      this._exibirResultado(resultado);
    });

    /**
     * Evento: disconnect
     * Tratamento de desconexao inesperada.
     */
    this.socket.on('disconnect', () => {
      this._exibirErro('Conexao com o servidor perdida. Tente novamente.');
      this._mostrarTela('lobby');
    });
  }

  /* =========================================================================
   * NAVEGACAO ENTRE TELAS
   * ======================================================================= */

  /**
   * Mostra a tela especificada e esconde as demais.
   * @param {string} nome - Nome da tela ('lobby'|'sala'|'jogo'|'resultado').
   * @private
   */
  _mostrarTela(nome) {
    this.telaAtiva = nome;

    this.elTelaLobby.style.display = nome === 'lobby' ? 'block' : 'none';
    this.elTelaSala.style.display = nome === 'sala' ? 'block' : 'none';
    this.elTelaJogo.style.display = nome === 'jogo' ? 'block' : 'none';
    this.elTelaResultado.style.display = nome === 'resultado' ? 'block' : 'none';

    // Controles mobile no jogo
    const controlesMobile = document.getElementById('controles-mobile-multi');
    if (controlesMobile) {
      controlesMobile.style.display = nome === 'jogo' ? '' : 'none';
    }

    // Parar renderizacao se saiu do jogo
    if (nome !== 'jogo' && this.frameAnimacao) {
      cancelAnimationFrame(this.frameAnimacao);
      this.frameAnimacao = null;
    }
  }

  /* =========================================================================
   * LOBBY
   * ======================================================================= */

  /**
   * Solicita ao servidor a lista de salas disponiveis e renderiza na tela.
   * @private
   */
  _atualizarListaSalas() {
    this.socket.emit('listar-salas', (salas) => {
      if (salas.length === 0) {
        this.elListaSalas.innerHTML = '<p class="salas-vazio">Nenhuma sala disponivel. Crie uma!</p>';
        return;
      }

      let html = '';
      for (const sala of salas) {
        html += `
          <div class="sala-item" data-codigo="${sala.codigo}">
            <span class="sala-item-codigo">${sala.codigo}</span>
            <span class="sala-item-jogadores">${sala.jogadores}/${sala.maxJogadores} jogadores</span>
          </div>
        `;
      }
      this.elListaSalas.innerHTML = html;

      // Clicar em uma sala para entrar
      this.elListaSalas.querySelectorAll('.sala-item').forEach((item) => {
        item.addEventListener('click', () => {
          const codigo = item.getAttribute('data-codigo');
          this.elInputCodigoSala.value = codigo;
          this._entrarNaSala(codigo);
        });
      });
    });
  }

  /**
   * Valida o apelido digitado pelo jogador.
   * @returns {string|null} Apelido validado ou null se invalido.
   * @private
   */
  _validarApelido() {
    const apelido = this.elInputApelido.value.trim();
    if (!apelido || apelido.length < 2) {
      this._exibirErro('Digite um apelido com pelo menos 2 caracteres.');
      return null;
    }
    return apelido;
  }

  /**
   * Cria uma nova sala no servidor e entra nela.
   * @private
   */
  _criarSala() {
    const apelido = this._validarApelido();
    if (!apelido) return;

    this.apelido = apelido;
    localStorage.setItem('snake_apelido', apelido);

    this.socket.emit('criar-sala', { apelido }, (resposta) => {
      if (resposta.sucesso) {
        this.codigoSala = resposta.codigo;
        this.estouPronto = false;
        this._mostrarTela('sala');
        this.elSalaCodigo.textContent = resposta.codigo;
      } else {
        this._exibirErro(resposta.erro || 'Erro ao criar sala.');
      }
    });
  }

  /**
   * Tenta entrar em uma sala existente pelo codigo.
   * @param {string} [codigoManual] - Codigo da sala (opcional, pega do input se nao fornecido).
   * @private
   */
  _entrarNaSala(codigoManual) {
    const apelido = this._validarApelido();
    if (!apelido) return;

    const codigo = codigoManual || this.elInputCodigoSala.value.trim().toUpperCase();
    if (!codigo) {
      this._exibirErro('Digite o codigo da sala.');
      return;
    }

    this.apelido = apelido;
    localStorage.setItem('snake_apelido', apelido);

    this.socket.emit('entrar-sala', { codigo, apelido }, (resposta) => {
      if (resposta.sucesso) {
        this.codigoSala = resposta.codigo;
        this.estouPronto = false;
        this._mostrarTela('sala');
        this.elSalaCodigo.textContent = resposta.codigo;
      } else {
        this._exibirErro(resposta.erro || 'Erro ao entrar na sala.');
      }
    });
  }

  /**
   * Exibe uma mensagem de erro no lobby.
   * @param {string} mensagem - Texto do erro.
   * @private
   */
  _exibirErro(mensagem) {
    this.elLobbyErro.textContent = mensagem;
    this.elLobbyErro.style.display = 'block';
    setTimeout(() => {
      this.elLobbyErro.style.display = 'none';
    }, 4000);
  }

  /* =========================================================================
   * SALA DE ESPERA
   * ======================================================================= */

  /**
   * Atualiza a interface da sala de espera com os dados recebidos.
   * @param {object} infoSala - Informacoes da sala vindas do servidor.
   * @private
   */
  _atualizarSalaEspera(infoSala) {
    if (this.telaAtiva !== 'sala') return;

    // Renderizar lista de jogadores
    let html = '';
    let todosProntos = true;
    let temMinimo = infoSala.jogadores.length >= 2;

    let quantidadeBots = 0;

    for (const jogador of infoSala.jogadores) {
      const ehEu = jogador.id === this.socket.id;
      const statusTexto = jogador.pronto ? 'Pronto!' : 'Aguardando...';
      const statusClasse = jogador.pronto ? 'jogador-pronto' : 'jogador-aguardando';
      const indicadorBot = jogador.ehBot ? ' 🤖' : '';
      const indicadorEu = ehEu ? ' (voce)' : '';

      if (jogador.ehBot) quantidadeBots++;
      if (!jogador.pronto) todosProntos = false;

      html += `
        <div class="jogador-item">
          <span class="jogador-cor" style="background: ${jogador.cor.principal}; box-shadow: 0 0 8px ${jogador.cor.principal};"></span>
          <span class="jogador-nome">${jogador.apelido}${indicadorBot}${indicadorEu}</span>
          <span class="jogador-status ${statusClasse}">${statusTexto}</span>
        </div>
      `;
    }

    // Atualizar contador de bots
    this.elQuantidadeBots.textContent = quantidadeBots;

    // Habilitar/desabilitar botoes de bot
    const salaCheia = infoSala.jogadores.length >= infoSala.maxJogadores;
    this.elBotaoAdicionarBot.disabled = salaCheia;
    this.elBotaoRemoverBot.disabled = quantidadeBots === 0;

    // Mostrar seletor de dificuldade apenas quando ha bots
    this.elLinhaDificuldade.style.display = quantidadeBots > 0 ? 'flex' : 'none';

    // Sincronizar botao de dificuldade ativo
    if (infoSala.dificuldadeBots) {
      this.elBotoesDificuldade.forEach(btn => {
        btn.classList.toggle('ativo', btn.dataset.dificuldade === infoSala.dificuldadeBots);
      });
    }

    // Sincronizar botao de tempo ativo
    if (infoSala.tempoPartida) {
      this.elBotoesTempo.forEach(btn => {
        btn.classList.toggle('ativo', Number(btn.dataset.tempo) === infoSala.tempoPartida);
      });
    }

    this.elListaJogadoresSala.innerHTML = html;

    // Exibir botao de iniciar se todos prontos e tem minimo
    const podeIniciar = todosProntos && temMinimo;
    this.elBotaoIniciarPartida.style.display = podeIniciar ? 'block' : 'none';

    // Status textual
    if (!temMinimo) {
      this.elSalaStatus.textContent = 'Aguardando mais jogadores... (minimo 2)';
    } else if (!todosProntos) {
      this.elSalaStatus.textContent = 'Aguardando todos ficarem prontos...';
    } else {
      this.elSalaStatus.textContent = 'Todos prontos! Clique em "Iniciar Partida".';
    }
  }

  /* =========================================================================
   * TELA DE JOGO (RENDERIZACAO EM TEMPO REAL)
   * ======================================================================= */

  /**
   * Inicializa a tela de jogo: canvas, renderizador e loop de renderizacao.
   * @private
   */
  _iniciarTelaJogo() {
    this._mostrarTela('jogo');

    // Inicializar renderizador para o grid multiplayer
    const largura = CONSTANTES.TABULEIRO.LARGURA_MULTI;
    const altura = CONSTANTES.TABULEIRO.ALTURA_MULTI;
    this.renderizador = new Renderizador(this.canvasMulti, largura, altura);
    this.particulas = new SistemaDeParticulas(this.renderizador.ctx);

    // Iniciar loop de renderizacao
    const renderizar = () => {
      this._renderizarFrame();
      this.frameAnimacao = requestAnimationFrame(renderizar);
    };
    renderizar();
  }

  /**
   * Renderiza um frame do jogo multiplayer baseado no ultimo estado recebido.
   * @private
   */
  _renderizarFrame() {
    if (!this.renderizador || !this.ultimoEstado) return;

    const rend = this.renderizador;
    const estado = this.ultimoEstado;

    rend.atualizarAnimacao();

    // Fundo
    rend.desenharFundo();

    // Borda da arena (zona de perigo)
    if (estado.bordaArena > 0) {
      rend.desenharBordaArena(estado.bordaArena, estado.encolhendo);
    }

    // Desenhar comidas
    for (const comida of estado.comidas) {
      rend.desenharComida(comida.posicao, comida.tipo, comida.cor, comida.brilho);
    }

    // Desenhar todas as cobras
    for (const jogador of estado.jogadores) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;

      rend.desenharCobra(
        jogador.cobra,
        jogador.cor.principal,
        jogador.cor.secundaria,
        jogador.direcao,
        {
          escudo: jogador.efeitos.escudo,
          invulneravel: jogador.invulneravel,
          velocidade: jogador.efeitos.velocidade,
          ehRei: jogador.ehRei,
          apelido: jogador.apelido,
        }
      );

      // Trilha de velocidade
      if (jogador.efeitos.velocidade && jogador.cobra.length > 0) {
        const cauda = jogador.cobra[jogador.cobra.length - 1];
        const tam = rend.tamanhoCelula;
        this.particulas.criarTrilha(
          cauda.x * tam + tam / 2,
          cauda.y * tam + tam / 2,
          '#ffee00'
        );
      }
    }

    // Particulas
    this.particulas.atualizar();
    this.particulas.renderizar();

    // Aviso de encolhimento (sobre tudo, antes do HUD)
    if (estado.encolhendo) {
      rend.desenharAvisoEncolhimento();
    }

    // Atualizar HUD
    this._atualizarHUDMulti(estado);
  }

  /**
   * Atualiza os elementos do HUD multiplayer: tempo, pontuacao, vidas, placar.
   * @param {object} estado - Estado do jogo recebido do servidor.
   * @private
   */
  _atualizarHUDMulti(estado) {
    // Tempo restante
    const minutos = Math.floor(estado.tempoRestante / 60);
    const segundos = estado.tempoRestante % 60;
    this.elMultiTempo.textContent = `${minutos}:${String(segundos).padStart(2, '0')}`;

    // Alerta visual quando tempo esta acabando
    if (estado.tempoRestante <= 30) {
      this.elMultiTempo.style.color = '#ff4444';
    } else {
      this.elMultiTempo.style.color = '';
    }

    // Encontrar dados do jogador local
    const eu = estado.jogadores.find(j => j.id === this.socket.id);
    if (eu) {
      this.elMultiPontuacao.textContent = eu.pontuacao.toLocaleString('pt-BR');

      // Vidas como coracoes
      let vidasHtml = '';
      for (let i = 0; i < eu.vidas; i++) vidasHtml += '❤️';
      this.elMultiVidas.textContent = vidasHtml || (eu.vivo ? '' : '💀');

      // Barra de efeitos
      let efeitosHtml = '';
      if (eu.efeitos.velocidade) {
        efeitosHtml += '<div class="efeito-ativo efeito-velocidade">⚡ Velocidade</div>';
      }
      if (eu.efeitos.escudo) {
        efeitosHtml += '<div class="efeito-ativo efeito-escudo">🛡️ Escudo</div>';
      }
      this.elMultiBarraEfeitos.innerHTML = efeitosHtml;
    }

    // Placar lateral (ranking em tempo real)
    const jogadoresOrdenados = [...estado.jogadores].sort((a, b) => b.pontuacao - a.pontuacao);
    let placarHtml = '';
    for (const j of jogadoresOrdenados) {
      const coroa = j.ehRei ? '<span class="placar-jogador-coroa">👑</span>' : '';
      const classeVivo = j.vivo ? '' : 'morto';
      const botTag = j.ehBot ? ' 🤖' : '';
      placarHtml += `
        <div class="placar-jogador ${classeVivo}">
          <span class="placar-jogador-cor" style="background: ${j.cor.principal};"></span>
          ${coroa}
          <span class="placar-jogador-nome">${j.apelido}${botTag}</span>
          <span class="placar-jogador-pts">${j.pontuacao}</span>
        </div>
      `;
    }
    this.elPlacarLateral.innerHTML = placarHtml;
  }

  /**
   * Processa eventos recentes do servidor (eliminacoes, coletas, etc)
   * e exibe no feed lateral.
   * @param {Array<object>} eventos - Lista de eventos do tick.
   * @private
   */
  _processarEventos(eventos) {
    if (!eventos || eventos.length === 0) return;

    const tam = this.renderizador ? this.renderizador.tamanhoCelula : 20;

    for (const evento of eventos) {
      switch (evento.tipo) {
        case 'eliminacao':
          this._adicionarFeed(
            `💀 ${evento.eliminadorApelido} eliminou ${evento.eliminadoApelido}!`
          );
          break;

        case 'morte':
          this._adicionarFeed(`☠️ ${evento.apelido} foi eliminado!`);
          break;

        case 'comida_coletada':
          // Particulas no local da comida
          if (this.particulas) {
            this.particulas.criarExplosao(
              evento.posicao.x * tam + tam / 2,
              evento.posicao.y * tam + tam / 2,
              CONSTANTES.TIPOS_COMIDA[evento.tipoComida.toUpperCase()]?.cor || '#44ff44',
              10
            );
          }
          break;

        case 'segmento_removido':
          if (this.particulas) {
            this.particulas.criarExplosaoGrande(
              evento.posicao.x * tam + tam / 2,
              evento.posicao.y * tam + tam / 2,
              '#ff4444'
            );
          }
          break;

        case 'respawn':
          this._adicionarFeed(`✨ Jogador renasceu! (${evento.vidasRestantes} vidas)`);
          break;

        case 'arena_encolhendo':
          this._adicionarFeed('⚠️ Arena encolhendo! Cuidado!');
          break;

        case 'arena_encolheu':
          this._adicionarFeed('🔥 Arena encolheu! Zona menor!');
          break;
      }
    }
  }

  /**
   * Adiciona uma mensagem ao feed de eventos na tela de jogo.
   * As mensagens desaparecem automaticamente apos 5 segundos.
   * @param {string} mensagem - Texto do evento.
   * @private
   */
  _adicionarFeed(mensagem) {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.textContent = mensagem;
    this.elFeedEventos.prepend(div);

    // Remover apos animacao (5 segundos)
    setTimeout(() => {
      if (div.parentNode) div.remove();
    }, 5000);

    // Limitar quantidade de itens no feed
    while (this.elFeedEventos.children.length > 8) {
      this.elFeedEventos.removeChild(this.elFeedEventos.lastChild);
    }
  }

  /* =========================================================================
   * TELA DE RESULTADO
   * ======================================================================= */

  /**
   * Exibe o ranking final da partida com animacoes.
   * @param {object} resultado - Dados do resultado com ranking.
   * @private
   */
  _exibirResultado(resultado) {
    this._mostrarTela('resultado');

    const { ranking } = resultado;
    let html = '';

    for (const item of ranking) {
      const medalha = item.posicao === 1 ? '🥇' : item.posicao === 2 ? '🥈' : item.posicao === 3 ? '🥉' : `${item.posicao}`;
      const botTag = item.ehBot ? ' 🤖' : '';

      html += `
        <div class="ranking-item">
          <span class="ranking-posicao">${medalha}</span>
          <span class="ranking-cor" style="background: ${item.cor.principal}; box-shadow: 0 0 8px ${item.cor.principal};"></span>
          <div class="ranking-info">
            <div class="ranking-nome">${item.apelido}${botTag}</div>
            <div class="ranking-stats">${item.eliminacoes} eliminacoes</div>
          </div>
          <span class="ranking-pontuacao">${item.pontuacao.toLocaleString('pt-BR')}</span>
        </div>
      `;
    }

    this.elRankingFinal.innerHTML = html;
  }

  /* =========================================================================
   * CONTROLES (TECLADO + TOUCH)
   * ======================================================================= */

  /**
   * Configura os controles de direcao para o modo multiplayer.
   * @private
   */
  _configurarControles() {
    // Teclado
    document.addEventListener('keydown', (evento) => {
      if (this.telaAtiva !== 'jogo') return;

      const mapa = {
        ArrowUp: 'cima', ArrowDown: 'baixo', ArrowLeft: 'esquerda', ArrowRight: 'direita',
        w: 'cima', W: 'cima', s: 'baixo', S: 'baixo',
        a: 'esquerda', A: 'esquerda', d: 'direita', D: 'direita',
      };

      const direcao = mapa[evento.key];
      if (direcao) {
        evento.preventDefault();
        this.socket.emit('mudar-direcao', direcao);
      }
    });

    // Botoes touch
    const botoesDirecao = document.querySelectorAll('#controles-mobile-multi .botao-direcao');
    botoesDirecao.forEach((botao) => {
      const handler = (e) => {
        e.preventDefault();
        if (this.telaAtiva !== 'jogo') return;
        const direcao = botao.getAttribute('data-direcao');
        this.socket.emit('mudar-direcao', direcao);
      };
      botao.addEventListener('touchstart', handler);
      botao.addEventListener('click', handler);
    });

    // Swipe no canvas
    let inicioX = 0;
    let inicioY = 0;

    this.canvasMulti.addEventListener('touchstart', (e) => {
      inicioX = e.touches[0].clientX;
      inicioY = e.touches[0].clientY;
    }, { passive: true });

    this.canvasMulti.addEventListener('touchend', (e) => {
      if (this.telaAtiva !== 'jogo') return;
      const dx = e.changedTouches[0].clientX - inicioX;
      const dy = e.changedTouches[0].clientY - inicioY;

      if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;

      if (Math.abs(dx) > Math.abs(dy)) {
        this.socket.emit('mudar-direcao', dx > 0 ? 'direita' : 'esquerda');
      } else {
        this.socket.emit('mudar-direcao', dy > 0 ? 'baixo' : 'cima');
      }
    });
  }

  /* =========================================================================
   * BOTOES DA INTERFACE
   * ======================================================================= */

  /**
   * Configura todos os event listeners dos botoes nas diversas telas.
   * @private
   */
  _configurarBotoes() {
    // Lobby: Criar sala
    this.elBotaoCriarSala.addEventListener('click', () => this._criarSala());

    // Lobby: Entrar na sala
    this.elBotaoEntrarSala.addEventListener('click', () => this._entrarNaSala());

    // Lobby: Enter no input de codigo
    this.elInputCodigoSala.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._entrarNaSala();
    });

    // Lobby: Enter no input de apelido (cria sala)
    this.elInputApelido.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._criarSala();
    });

    // Lobby: Atualizar lista de salas
    this.elBotaoAtualizarSalas.addEventListener('click', () => this._atualizarListaSalas());

    // Sala: Adicionar bot
    this.elBotaoAdicionarBot.addEventListener('click', () => {
      this.socket.emit('adicionar-bot', () => {});
    });

    // Sala: Remover bot
    this.elBotaoRemoverBot.addEventListener('click', () => {
      this.socket.emit('remover-bot', () => {});
    });

    // Sala: Alterar dificuldade dos bots
    this.elBotoesDificuldade.forEach(btn => {
      btn.addEventListener('click', () => {
        const nivel = btn.dataset.dificuldade;
        this.socket.emit('alterar-dificuldade-bots', nivel, () => {});
      });
    });

    // Sala: Alterar tempo da partida
    this.elBotoesTempo.forEach(btn => {
      btn.addEventListener('click', () => {
        const segundos = Number(btn.dataset.tempo);
        this.socket.emit('alterar-tempo-partida', segundos, () => {});
      });
    });

    // Sala: Marcar pronto
    this.elBotaoPronto.addEventListener('click', () => {
      this.estouPronto = !this.estouPronto;
      this.elBotaoPronto.textContent = this.estouPronto ? 'Cancelar Prontidao' : 'Estou Pronto!';
      this.elBotaoPronto.classList.toggle('pronto-ativo', this.estouPronto);
      this.socket.emit('jogador-pronto');
    });

    // Sala: Iniciar partida
    this.elBotaoIniciarPartida.addEventListener('click', () => {
      this.socket.emit('iniciar-partida');
    });

    // Sala: Sair
    this.elBotaoSairSala.addEventListener('click', () => {
      this.socket.emit('sair-sala');
      this.codigoSala = null;
      this.estouPronto = false;
      this.elBotaoPronto.textContent = 'Estou Pronto!';
      this.elBotaoPronto.classList.remove('pronto-ativo');
      this._mostrarTela('lobby');
      this._atualizarListaSalas();
    });

    // Resultado: Jogar novamente
    this.elBotaoJogarNovamente.addEventListener('click', () => {
      this.socket.emit('sair-sala');
      this.codigoSala = null;
      this.estouPronto = false;
      this.ultimoEstado = null;
      this.elBotaoPronto.textContent = 'Estou Pronto!';
      this.elBotaoPronto.classList.remove('pronto-ativo');
      this._mostrarTela('lobby');
      this._atualizarListaSalas();
    });
  }
}

/* =========================================================================
 * INICIALIZACAO
 * ======================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  window.clienteMulti = new ClienteMultijogador();
});
