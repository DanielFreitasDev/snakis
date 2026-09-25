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

/**
 * Escapa caracteres especiais de HTML em textos vindos de outros usuarios
 * (apelidos), impedindo injecao de markup/scripts no placar e ranking.
 * @param {*} texto - Texto bruto.
 * @returns {string} Texto seguro para innerHTML.
 */
function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

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
    this.elListaConfigComidas = document.getElementById('lista-config-comidas');
    this.elPontosEliminacao = document.getElementById('pontos-eliminacao');
    this._montarConfigComidas();

    // Jogo
    this.canvasMulti = document.getElementById('canvas-multi');
    this.elMultiTempo = document.getElementById('multi-tempo');
    this.elMultiPontuacao = document.getElementById('multi-pontuacao');
    this.elMultiVidas = document.getElementById('multi-vidas');
    this.elMultiBarraEfeitos = document.getElementById('multi-barra-efeitos');
    this.elPlacarLateral = document.getElementById('placar-lateral');
    this.elFeedEventos = document.getElementById('feed-eventos');

    // Menu da partida (sair / expulsar / encerrar sala)
    this.elBotaoMenuPartida = document.getElementById('botao-menu-partida');
    this.elDialogoMenu = document.getElementById('dialogo-menu-partida');
    this.elMenuSecaoDono = document.getElementById('menu-partida-dono');
    this.elMenuJogadores = document.getElementById('menu-partida-jogadores');
    this.elMenuErro = document.getElementById('menu-partida-erro');
    this.elBotaoContinuarPartida = document.getElementById('botao-continuar-partida');
    this.elBotaoSairPartida = document.getElementById('botao-sair-partida');
    this.elBotaoEncerrarSala = document.getElementById('botao-encerrar-sala');

    // Resultado
    this.elRankingFinal = document.getElementById('ranking-final');
    this.elBotaoJogarNovamente = document.getElementById('botao-jogar-novamente');
    this.elBotaoSairLobby = document.getElementById('botao-sair-lobby');

    // Reconexao e Hall da Fama
    this.elOverlayReconexao = document.getElementById('overlay-reconexao');
    this.elHallDaFama = document.getElementById('hall-da-fama');

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

    /** @type {Map<string, object>} Interpolacao de movimento por jogador */
    this.movimentosVisuais = new Map();

    /** @type {number} Ultimo numero anunciado da contagem regressiva */
    this.ultimaContagem = 0;

    /** @type {string} Cache do HTML do placar (evita innerHTML redundante) */
    this.placarHtmlCache = '';

    /** @type {string} Token de sessao para reconexao (persistido por aba) */
    this.tokenSessao = this._obterTokenSessao();

    /** @type {boolean} Se estamos aguardando a reconexao apos uma queda */
    this.aguardandoReconexao = false;

    /** @type {number} Intensidade atual da musica ambiente (0..1) */
    this.intensidadeMusica = 0.3;

    /** @type {string} Assinatura da lista de jogadores exibida no menu (evita redesenho) */
    this.menuJogadoresCache = '';

    /** @type {boolean} Se fomos nos que pedimos para encerrar a sala */
    this.encerrandoSala = false;

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

    // Configurar suporte mobile (swipe global)
    this._configurarMobile();

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
     * Evento: connect
     * Disparado na primeira conexao e a cada reconexao automatica do
     * Socket.IO. Sempre tentamos retomar uma sessao pendente: apos um
     * reload da pagina ou uma queda de rede no meio da partida, o
     * servidor reconhece o token e devolve o jogador ao jogo.
     */
    this.socket.on('connect', () => {
      this._tentarReconectarPartida();
    });

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
      if (window.som) {
        window.som.iniciarJogo();
        this.intensidadeMusica = 0.3;
        window.som.definirIntensidadeMusica(this.intensidadeMusica);
        window.som.iniciarMusica('multi');
      }
    });

    /**
     * Evento: estado-jogo
     * Recebido a cada tick do servidor com o estado completo do jogo.
     * Este eh o evento mais frequente e critico para o desempenho.
     * O HUD eh atualizado aqui (20x/s) e nao no loop de renderizacao
     * (60x/s) — innerHTML a cada frame gastaria CPU sem necessidade.
     */
    this.socket.on('estado-jogo', (estado) => {
      this.ultimoEstado = estado;
      this._rastrearMovimentos(estado);
      this._processarEventos(estado.eventos);
      this._processarContagem(estado.contagem || 0);
      this._atualizarHUDMulti(estado);
    });

    /**
     * Evento: partida-finalizada
     * Recebido quando a partida termina (tempo esgotado ou 1 sobrevivente).
     */
    this.socket.on('partida-finalizada', (resultado) => {
      this._exibirResultado(resultado);
      if (window.som) {
        window.som.pararMusica();
        window.som.partidaFinalizada();
      }
      Mobile.liberarGestos();
      Mobile.vibrarGameOver();
    });

    /**
     * Evento: voce-foi-expulso
     * O dono da sala nos removeu. O servidor ja liberou nossa sessao.
     */
    this.socket.on('voce-foi-expulso', () => {
      this._voltarAoLobby('Você foi expulso da sala pelo dono.');
    });

    /**
     * Evento: sala-encerrada
     * O dono encerrou a sala: todos voltam ao lobby.
     */
    this.socket.on('sala-encerrada', () => {
      const mensagem = this.encerrandoSala ? null : 'O dono encerrou a sala.';
      this.encerrandoSala = false;
      this._voltarAoLobby(mensagem);
    });

    /**
     * Evento: disconnect
     * Queda de conexao. Se estavamos em uma sala/partida, mostramos o
     * overlay de reconexao e deixamos o Socket.IO tentar reconectar —
     * o servidor guarda nossa vaga por um periodo de graca. No lobby,
     * a queda eh silenciosa (a proxima acao reconecta sozinha).
     */
    this.socket.on('disconnect', () => {
      if (window.som) window.som.pararMusica();

      if (this.telaAtiva === 'lobby') return;

      this.aguardandoReconexao = true;
      this._mostrarOverlayReconexao();
    });
  }

  /* =========================================================================
   * RECONEXAO DE SESSAO
   * ======================================================================= */

  /**
   * Recupera (ou cria) o token de sessao desta aba. Fica no
   * sessionStorage: sobrevive a reloads da pagina, mas cada aba tem o
   * seu — duas abas no mesmo navegador sao dois jogadores distintos.
   * @returns {string} Token de sessao.
   * @private
   */
  _obterTokenSessao() {
    const gerar = () => (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

    try {
      let token = sessionStorage.getItem('snakis_token_sessao');
      if (!token) {
        token = gerar();
        sessionStorage.setItem('snakis_token_sessao', token);
      }
      return token;
    } catch {
      return gerar();
    }
  }

  /**
   * Pergunta ao servidor se ha uma sessao para retomar com nosso token.
   * Cobre dois cenarios: queda de rede no meio da partida (overlay
   * visivel) e reload da pagina com partida em andamento.
   * @private
   */
  _tentarReconectarPartida() {
    if (!this.tokenSessao) return;

    this.socket.emit('reconectar-partida', { token: this.tokenSessao }, (resposta) => {
      if (resposta && resposta.sucesso) {
        this.aguardandoReconexao = false;
        this.codigoSala = resposta.codigo;
        this._esconderOverlayReconexao();

        if (resposta.estado === 'jogando') {
          this._iniciarTelaJogo();
          if (window.som) {
            window.som.definirIntensidadeMusica(this.intensidadeMusica);
            window.som.iniciarMusica('multi');
          }
        } else if (resposta.estado === 'finalizado') {
          // A partida acabou enquanto estavamos fora: seguir para a revanche
          this._solicitarRevanche();
        } else {
          this._mostrarTela('sala');
          this.elSalaCodigo.textContent = resposta.codigo;
        }
        return;
      }

      // Sem sessao para retomar. Se estavamos aguardando (caimos no meio
      // do jogo), a partida ja era: voltar ao lobby com aviso.
      if (this.aguardandoReconexao) {
        this.aguardandoReconexao = false;
        this._esconderOverlayReconexao();
        this.codigoSala = null;
        this._mostrarTela('lobby');
        this._atualizarListaSalas();
        this._exibirErro((resposta && resposta.erro) || 'Não foi possível voltar à partida.');
      }
    });
  }

  /**
   * Mostra o overlay "reconectando..." sobre a tela atual.
   * @private
   */
  _mostrarOverlayReconexao() {
    if (this.elOverlayReconexao) {
      this.elOverlayReconexao.style.display = 'flex';
    }
  }

  /**
   * Esconde o overlay de reconexao.
   * @private
   */
  _esconderOverlayReconexao() {
    if (this.elOverlayReconexao) {
      this.elOverlayReconexao.style.display = 'none';
    }
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
    const telaAnterior = this.telaAtiva;
    this.telaAtiva = nome;

    this.elTelaLobby.style.display = nome === 'lobby' ? 'block' : 'none';
    this.elTelaSala.style.display = nome === 'sala' ? 'block' : 'none';
    this.elTelaJogo.style.display = nome === 'jogo' ? 'block' : 'none';
    this.elTelaResultado.style.display = nome === 'resultado' ? 'block' : 'none';

    // Entrada animada da nova tela (exceto o jogo, que ja anima sozinho)
    if (nome !== 'jogo' && nome !== telaAnterior && window.AnimacoesUI) {
      const mapa = {
        lobby: this.elTelaLobby,
        sala: this.elTelaSala,
        resultado: this.elTelaResultado,
      };
      AnimacoesUI.telaEntrou(mapa[nome]);
    }

    // Controles mobile no jogo
    const controlesMobile = document.getElementById('controles-mobile-multi');
    if (controlesMobile) {
      controlesMobile.style.display = nome === 'jogo' ? '' : 'none';
    }

    // Liberar gestos do navegador e fechar o menu ao sair da tela de jogo
    if (nome !== 'jogo') {
      Mobile.liberarGestos();
      this._fecharMenuPartida();
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
    // O Hall da Fama acompanha toda atualizacao do lobby
    this._atualizarHallDaFama();

    this.socket.emit('listar-salas', (salas) => {
      if (salas.length === 0) {
        this.elListaSalas.innerHTML = '<p class="salas-vazio">Nenhuma sala disponível. Crie uma!</p>';
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
   * Busca o ranking persistente no servidor e renderiza o Hall da Fama
   * no lobby (vitorias e recordes acumulados entre partidas).
   * @private
   */
  _atualizarHallDaFama() {
    if (!this.elHallDaFama) return;

    this.socket.emit('obter-ranking', (ranking) => {
      if (!Array.isArray(ranking) || ranking.length === 0) {
        this.elHallDaFama.innerHTML =
          '<p class="salas-vazio">Nenhuma lenda ainda. Vença partidas para entrar!</p>';
        return;
      }

      let html = '';
      for (const registro of ranking) {
        const medalha = registro.posicao === 1 ? '🥇'
          : registro.posicao === 2 ? '🥈'
          : registro.posicao === 3 ? '🥉'
          : `${registro.posicao}º`;
        const rotuloVitorias = registro.vitorias === 1 ? 'vitória' : 'vitórias';

        html += `
          <div class="fama-item ${registro.posicao <= 3 ? 'fama-top' : ''}">
            <span class="fama-posicao">${medalha}</span>
            <div class="fama-info">
              <span class="fama-nome">${escaparHtml(registro.apelido)}</span>
              <span class="fama-detalhes">${registro.partidas} partida${registro.partidas === 1 ? '' : 's'} · melhor: ${registro.melhorPontuacao.toLocaleString('pt-BR')} pts</span>
            </div>
            <span class="fama-vitorias">🏆 ${registro.vitorias} <small>${rotuloVitorias}</small></span>
          </div>
        `;
      }
      this.elHallDaFama.innerHTML = html;

      if (window.AnimacoesUI) {
        AnimacoesUI.listaEmCascata(this.elHallDaFama, '.fama-item');
      }
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

    this.socket.emit('criar-sala', { apelido, token: this.tokenSessao }, (resposta) => {
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
      this._exibirErro('Digite o código da sala.');
      return;
    }

    this.apelido = apelido;
    localStorage.setItem('snake_apelido', apelido);

    this.socket.emit('entrar-sala', { codigo, apelido, token: this.tokenSessao }, (resposta) => {
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
   * Cria uma linha por tipo de comida na configuracao da sala:
   * checkbox "da ponto" + quantos pontos + quantas chances de aparecer.
   * @private
   */
  _montarConfigComidas() {
    const maxPontos = CONSTANTES.PONTUACAO.MAXIMO_CONFIGURAVEL;
    const maxChances = CONSTANTES.MULTI.MAXIMO_CHANCES;
    let html = '';
    for (const comida of Object.values(CONSTANTES.TIPOS_COMIDA)) {
      const id = `comida-${comida.tipo}`;
      html += `
        <li class="linha-comida" data-tipo="${comida.tipo}">
          <label class="comida-nome" title="Desmarque para não dar ponto">
            <input type="checkbox" class="comida-da-ponto" checked
                   aria-label="${comida.descricao} dá ponto">
            <span class="comida-emoji" aria-hidden="true">${comida.emoji}</span>
            <span>${comida.descricao}</span>
          </label>
          <div class="comida-campos">
            <label class="campo-mini">
              <span class="campo-mini-rotulo">Pontos</span>
              <input type="number" class="comida-pontos" id="${id}-pontos"
                     inputmode="numeric" min="0" max="${maxPontos}" step="5" enterkeyhint="done"
                     aria-label="Pontos da comida ${comida.descricao}">
            </label>
            <label class="campo-mini">
              <span class="campo-mini-rotulo">Chance <output class="comida-percentual"></output></span>
              <input type="number" class="comida-chances" id="${id}-chances"
                     inputmode="numeric" min="0" max="${maxChances}" step="1" enterkeyhint="done"
                     aria-label="Chances de aparecer da comida ${comida.descricao}">
            </label>
          </div>
        </li>
      `;
    }
    this.elListaConfigComidas.innerHTML = html;
    this.elPontosEliminacao.max = maxPontos;
  }

  /**
   * Reflete na tela a configuracao de comidas e eliminacao vinda do
   * servidor. O campo em que o jogador esta digitando nao eh sobrescrito,
   * para nao "roubar" a edicao.
   * @param {object} infoSala - Informacoes da sala vindas do servidor.
   * @private
   */
  _sincronizarConfigComidas(infoSala) {
    const emFoco = document.activeElement;
    const definirValor = (input, valor) => {
      if (input !== emFoco) input.value = valor;
    };

    if (infoSala.configComidas) {
      for (const linha of this.elListaConfigComidas.children) {
        const config = infoSala.configComidas[linha.dataset.tipo];
        if (!config) continue;
        const campoPontos = linha.querySelector('.comida-pontos');
        linha.querySelector('.comida-da-ponto').checked = config.daPonto;
        campoPontos.disabled = !config.daPonto;
        definirValor(campoPontos, config.pontos);
        definirValor(linha.querySelector('.comida-chances'), config.chances);
      }
      this._atualizarPercentuais(infoSala.configComidas);
    }

    if (typeof infoSala.pontosEliminacao === 'number') {
      definirValor(this.elPontosEliminacao, infoSala.pontosEliminacao);
    }
  }

  /**
   * Mostra ao lado de "Chance" a porcentagem aproximada de cada comida,
   * para ficar claro o efeito das chances (fichas do sorteio).
   * @param {object} configComidas - Configuracao das comidas vinda do servidor.
   * @private
   */
  _atualizarPercentuais(configComidas) {
    const total = Object.values(configComidas).reduce((soma, c) => soma + c.chances, 0);
    for (const linha of this.elListaConfigComidas.children) {
      const config = configComidas[linha.dataset.tipo];
      const saida = linha.querySelector('.comida-percentual');
      if (!config || !saida) continue;
      saida.textContent = total > 0 ? `${Math.round((config.chances / total) * 100)}%` : '';
      linha.classList.toggle('comida-nao-aparece', config.chances === 0);
    }
  }

  /**
   * Le um campo numerico. Campo vazio vira null: o servidor ignora e
   * devolve o valor anterior, em vez de zerar sem querer.
   * @param {HTMLInputElement} campo
   * @returns {number|null}
   * @private
   */
  _lerNumero(campo) {
    return campo.value === '' ? null : Number(campo.value);
  }

  /**
   * Envia ao servidor a configuracao de uma comida a partir da linha dela.
   * @param {HTMLElement} linha - Elemento <li> da comida.
   * @private
   */
  _enviarConfigComida(linha) {
    const daPonto = linha.querySelector('.comida-da-ponto').checked;
    const campoPontos = linha.querySelector('.comida-pontos');
    campoPontos.disabled = !daPonto;
    this.socket.emit('alterar-config-comida', linha.dataset.tipo, {
      daPonto,
      pontos: this._lerNumero(campoPontos),
      chances: this._lerNumero(linha.querySelector('.comida-chances')),
    }, () => {});
  }

  /**
   * Atualiza a interface da sala de espera com os dados recebidos.
   * @param {object} infoSala - Informacoes da sala vindas do servidor.
   * @private
   */
  _atualizarSalaEspera(infoSala) {
    if (this.telaAtiva !== 'sala') return;

    // Sincronizar nosso estado de "pronto" com o servidor (cobre
    // reconexoes e a volta da revanche, quando o servidor reseta o pronto)
    const meusDados = infoSala.jogadores.find(j => j.id === this.socket.id);
    if (meusDados && meusDados.pronto !== this.estouPronto) {
      this.estouPronto = meusDados.pronto;
      this.elBotaoPronto.textContent = this.estouPronto ? 'Cancelar Prontidão' : 'Estou Pronto!';
      this.elBotaoPronto.classList.toggle('pronto-ativo', this.estouPronto);
    }

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
      const indicadorEu = ehEu ? ' (você)' : '';
      const indicadorDono = jogador.id === infoSala.donoId ? ' <span class="tag-dono">dono</span>' : '';

      if (jogador.ehBot) quantidadeBots++;
      if (!jogador.pronto) todosProntos = false;

      html += `
        <div class="jogador-item">
          <span class="jogador-cor" style="background: ${jogador.cor.principal}; box-shadow: 0 0 8px ${jogador.cor.principal};"></span>
          <span class="jogador-nome">${escaparHtml(jogador.apelido)}${indicadorBot}${indicadorEu}${indicadorDono}</span>
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

    // Sincronizar configuracao de comidas e pontuacao
    this._sincronizarConfigComidas(infoSala);

    this.elListaJogadoresSala.innerHTML = html;

    // Exibir botao de iniciar se todos prontos e tem minimo
    const podeIniciar = todosProntos && temMinimo;
    this.elBotaoIniciarPartida.style.display = podeIniciar ? 'block' : 'none';

    // Status textual
    if (!temMinimo) {
      this.elSalaStatus.textContent = 'Aguardando mais jogadores... (mínimo 2)';
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
    // Garantir que nao ha loop de renderizacao anterior rodando
    // (reconexao com a tela de jogo ja ativa criaria um segundo loop)
    if (this.frameAnimacao) {
      cancelAnimationFrame(this.frameAnimacao);
      this.frameAnimacao = null;
    }

    this._mostrarTela('jogo');

    // Resetar estado visual da partida anterior
    this.ultimoEstado = null;
    this.movimentosVisuais.clear();
    this.ultimaContagem = 0;
    this.placarHtmlCache = '';

    // Mobile: fullscreen e bloqueio de gestos
    Mobile.entrarFullscreen();
    Mobile.bloquearGestos();

    // Inicializar renderizador para o grid multiplayer
    // O Renderizador auto-ajusta o CSS ao viewport (mobile/desktop)
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

    // Desenhar todas as cobras (com movimento interpolado)
    for (const jogador of estado.jogadores) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;

      const cobraVisual = this._cobraVisualDe(jogador);

      rend.desenharCobra(
        cobraVisual,
        jogador.cor.principal,
        jogador.cor.secundaria,
        jogador.direcao,
        {
          escudo: jogador.efeitos.escudo,
          caveira: jogador.efeitos.caveira,
          invulneravel: jogador.invulneravel,
          velocidade: jogador.efeitos.velocidade,
          ehRei: jogador.ehRei,
          apelido: jogador.apelido,
        }
      );

      // Trilha de velocidade
      if (jogador.efeitos.velocidade && cobraVisual.length > 0) {
        const cauda = cobraVisual[cobraVisual.length - 1];
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

    // Contagem regressiva pre-partida
    if (estado.contagem > 0) {
      rend.desenharContagem(estado.contagem);
    }
  }

  /* =========================================================================
   * INTERPOLACAO DE MOVIMENTO (SUAVIZACAO VISUAL)
   * ======================================================================= */

  /**
   * Registra as mudancas de posicao de cada cobra entre estados recebidos.
   * A duracao de cada movimento vem da velocidade informada pelo servidor
   * (1000 / celulas por segundo): o deslize fica constante mesmo quando o
   * servidor alterna passos a cada 2 ou 3 ticks.
   * @param {object} estado - Estado recebido do servidor.
   * @private
   */
  _rastrearMovimentos(estado) {
    const agora = performance.now();
    const idsVivos = new Set();

    for (const jogador of estado.jogadores) {
      if (!jogador.vivo || jogador.cobra.length === 0) continue;
      idsVivos.add(jogador.id);

      const cabeca = jogador.cobra[0];
      const cauda = jogador.cobra[jogador.cobra.length - 1];
      const registro = this.movimentosVisuais.get(jogador.id);

      if (!registro) {
        this.movimentosVisuais.set(jogador.id, {
          cabecaAtual: { x: cabeca.x, y: cabeca.y },
          caudaAtual: { x: cauda.x, y: cauda.y },
          tamanhoAtual: jogador.cobra.length,
          cabecaDe: null,
          caudaDe: null,
          cresceu: false,
          inicio: agora,
          duracao: 200,
        });
        continue;
      }

      const moveu = registro.cabecaAtual.x !== cabeca.x ||
                    registro.cabecaAtual.y !== cabeca.y;
      if (!moveu) continue;

      const distancia = Math.abs(registro.cabecaAtual.x - cabeca.x) +
                        Math.abs(registro.cabecaAtual.y - cabeca.y);

      if (distancia === 1) {
        // Movimento normal de 1 celula: interpolar a partir da posicao antiga
        registro.cabecaDe = registro.cabecaAtual;
        registro.caudaDe = registro.caudaAtual;
        registro.cresceu = jogador.cobra.length > registro.tamanhoAtual;
        registro.duracao = jogador.velocidade > 0
          ? 1000 / jogador.velocidade
          : Math.min(350, Math.max(30, agora - registro.inicio));
      } else {
        // Teleporte (respawn/encolhimento): sem interpolacao
        registro.cabecaDe = null;
        registro.caudaDe = null;
      }

      registro.inicio = agora;
      registro.cabecaAtual = { x: cabeca.x, y: cabeca.y };
      registro.caudaAtual = { x: cauda.x, y: cauda.y };
      registro.tamanhoAtual = jogador.cobra.length;
    }

    // Limpar registros de jogadores mortos/removidos
    for (const id of this.movimentosVisuais.keys()) {
      if (!idsVivos.has(id)) this.movimentosVisuais.delete(id);
    }
  }

  /**
   * Monta o array de segmentos interpolados de um jogador para desenhar.
   * Cabeca desliza da celula anterior para a atual; a cauda desliza para
   * fora da celula que desocupou (quando a cobra nao cresceu).
   * @param {object} jogador - Dados do jogador no estado atual.
   * @returns {Array<{x:number, y:number}>} Segmentos para desenhar.
   * @private
   */
  _cobraVisualDe(jogador) {
    const registro = this.movimentosVisuais.get(jogador.id);
    if (!registro || !registro.cabecaDe) return jogador.cobra;

    const t = Math.max(0, Math.min(1,
      (performance.now() - registro.inicio) / registro.duracao));

    const lerp = (de, para) => ({
      x: de.x + (para.x - de.x) * t,
      y: de.y + (para.y - de.y) * t,
    });

    const visual = [lerp(registro.cabecaDe, jogador.cobra[0]), ...jogador.cobra.slice(1)];

    // Cauda deslizando (apenas em movimento normal, sem crescimento)
    if (!registro.cresceu && registro.caudaDe) {
      const caudaAtual = jogador.cobra[jogador.cobra.length - 1];
      const adjacente = Math.abs(registro.caudaDe.x - caudaAtual.x) +
                        Math.abs(registro.caudaDe.y - caudaAtual.y) === 1;
      if (adjacente) {
        visual.push(lerp(registro.caudaDe, caudaAtual));
      }
    }

    return visual;
  }

  /**
   * Anuncia a contagem regressiva com sons (3, 2, 1... VAI!).
   * @param {number} contagem - Numero atual da contagem (0 = sem contagem).
   * @private
   */
  _processarContagem(contagem) {
    if (contagem === this.ultimaContagem) return;

    if (contagem > 0) {
      if (window.som) window.som.contagemTick();
    } else if (this.ultimaContagem > 0) {
      // Contagem chegou ao fim: partida valendo!
      if (window.som) window.som.contagemVai();
    }

    this.ultimaContagem = contagem;
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

      // Barra de efeitos com tempo restante
      let efeitosHtml = '';
      if (eu.efeitos.velocidade) {
        const segs = Math.ceil(eu.efeitos.velocidadeTempo / 1000);
        efeitosHtml += `<div class="efeito-ativo efeito-velocidade">⚡ Velocidade ${segs}s</div>`;
      }
      if (eu.efeitos.escudo) {
        const segs = Math.ceil(eu.efeitos.escudoTempo / 1000);
        efeitosHtml += `<div class="efeito-ativo efeito-escudo">🛡️ Escudo ${segs}s</div>`;
      }
      if (eu.efeitos.caveira) {
        const segs = Math.ceil(eu.efeitos.caveiraTempo / 1000);
        efeitosHtml += `<div class="efeito-ativo efeito-caveira">💀 Caveira ${segs}s</div>`;
      }
      this.elMultiBarraEfeitos.innerHTML = efeitosHtml;
    }

    // Menu aberto acompanha quem entra/sai e troca de dono
    if (this._menuAberto()) this._atualizarMenuPartida();

    // Placar lateral (ranking em tempo real, desempate por eliminacoes)
    const jogadoresOrdenados = [...estado.jogadores].sort((a, b) =>
      (b.pontuacao - a.pontuacao) || (b.eliminacoes - a.eliminacoes));
    let placarHtml = '';
    for (const j of jogadoresOrdenados) {
      const coroa = j.ehRei ? '<span class="placar-jogador-coroa">👑</span>' : '';
      const classes = [
        j.vivo ? '' : 'morto',
        j.id === this.socket.id ? 'eu' : '',
        j.desconectado ? 'desconectado' : '',
      ].filter(Boolean).join(' ');
      const botTag = j.ehBot ? ' 🤖' : '';
      const quedaTag = j.desconectado ? ' 📡' : '';
      placarHtml += `
        <div class="placar-jogador ${classes}">
          <span class="placar-jogador-cor" style="background: ${j.cor.principal};"></span>
          ${coroa}
          <span class="placar-jogador-nome">${escaparHtml(j.apelido)}${botTag}${quedaTag}</span>
          <span class="placar-jogador-pts">${j.pontuacao}</span>
        </div>
      `;
    }

    // So mexer no DOM quando o placar realmente mudou
    if (placarHtml !== this.placarHtmlCache) {
      this.placarHtmlCache = placarHtml;
      this.elPlacarLateral.innerHTML = placarHtml;
    }
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
          if (window.som) window.som.eliminacao();
          Mobile.vibrarEspecial();
          break;

        case 'morte':
          this._adicionarFeed(`☠️ ${evento.apelido} foi eliminado!`);
          if (window.som) window.som.morrer();
          Mobile.vibrarMorrer();
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
          // Som da comida (apenas se o jogador local coletou)
          if (evento.jogadorId === this.socket.id) {
            if (window.som) {
              switch (evento.tipoComida) {
                case 'normal': window.som.comerNormal(); break;
                case 'dourada': window.som.comerDourada(); break;
                case 'velocidade': window.som.comerVelocidade(); break;
                case 'vida': window.som.comerVida(); break;
                case 'escudo': window.som.comerEscudo(); break;
                case 'caveira': window.som.comerCaveira(); break;
              }
            }
            // Haptic para comida coletada pelo jogador local
            if (evento.tipoComida === 'normal') {
              Mobile.vibrarComer();
            } else {
              Mobile.vibrarEspecial();
            }
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
          if (window.som) window.som.segmentoRemovido();
          break;

        case 'respawn': {
          const quem = evento.apelido || 'Jogador';
          const vidas = evento.vidasRestantes === 1 ? 'vida' : 'vidas';
          this._adicionarFeed(`✨ ${quem} renasceu! (${evento.vidasRestantes} ${vidas})`);
          if (window.som && evento.jogadorId === this.socket.id) window.som.respawnar();
          break;
        }

        case 'jogador_saiu':
          this._adicionarFeed(`🚪 ${evento.apelido} saiu da partida`);
          break;

        case 'jogador_expulso':
          this._adicionarFeed(`🥾 ${evento.apelido} foi expulso pelo dono`);
          break;

        case 'caveira_ativada':
          this._adicionarFeed(evento.jogadorId === this.socket.id
            ? '💀 Você pegou a caveira! Quem encostar em você morre!'
            : `💀 ${evento.apelido} pegou a caveira! Não encoste!`);
          break;

        case 'caveira_matou':
          this._adicionarFeed(`💀 ${evento.vitimaApelido} encostou na caveira de ${evento.apelido}!`);
          if (this.particulas && evento.posicao) {
            this.particulas.criarExplosaoGrande(
              evento.posicao.x * tam + tam / 2,
              evento.posicao.y * tam + tam / 2,
              CONSTANTES.TIPOS_COMIDA.CAVEIRA.cor
            );
          }
          if (window.som) window.som.eliminacao();
          break;

        case 'jogador_desconectou':
          this._adicionarFeed(`📡 ${evento.apelido} perdeu a conexão...`);
          break;

        case 'jogador_reconectou':
          this._adicionarFeed(`🔌 ${evento.apelido} voltou à partida!`);
          if (window.som && evento.jogadorId === this.socket.id) window.som.respawnar();
          break;

        case 'arena_encolhendo':
          this._adicionarFeed('⚠️ Arena encolhendo! Cuidado!');
          if (window.som) window.som.arenaEncolhendo();
          break;

        case 'arena_encolheu':
          this._adicionarFeed('🔥 Arena encolheu! Cobras mais rápidas!');
          // Musica acompanha a tensao da arena apertando
          this.intensidadeMusica = Math.min(1, this.intensidadeMusica + 0.22);
          if (window.som) window.som.definirIntensidadeMusica(this.intensidadeMusica);
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

  /**
   * Pede ao servidor para reabrir a sala finalizada (revanche) e navega
   * para a sala de espera. Usado pelo botao "Revanche" e pela reconexao
   * quando a partida terminou enquanto estavamos fora.
   * @private
   */
  _solicitarRevanche() {
    this.socket.emit('voltar-sala', (resposta) => {
      this.ultimoEstado = null;
      this.estouPronto = false;
      this.elBotaoPronto.textContent = 'Estou Pronto!';
      this.elBotaoPronto.classList.remove('pronto-ativo');

      if (resposta && resposta.sucesso) {
        this._mostrarTela('sala');
        this.elSalaCodigo.textContent = this.codigoSala;
      } else {
        // Sala nao existe mais (todos sairam): voltar ao lobby
        this.codigoSala = null;
        this._mostrarTela('lobby');
        this._atualizarListaSalas();
        this._exibirErro((resposta && resposta.erro) || 'A sala foi encerrada.');
      }
    });
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
      const rotuloEliminacoes = item.eliminacoes === 1 ? 'eliminação' : 'eliminações';

      html += `
        <div class="ranking-item">
          <span class="ranking-posicao">${medalha}</span>
          <span class="ranking-cor" style="background: ${item.cor.principal}; box-shadow: 0 0 8px ${item.cor.principal};"></span>
          <div class="ranking-info">
            <div class="ranking-nome">${escaparHtml(item.apelido)}${botTag}</div>
            <div class="ranking-stats">${item.eliminacoes} ${rotuloEliminacoes}</div>
          </div>
          <span class="ranking-pontuacao" data-pontos="${item.pontuacao}">${item.pontuacao.toLocaleString('pt-BR')}</span>
        </div>
      `;
    }

    this.elRankingFinal.innerHTML = html;

    // Revelacao em cascata + contagem animada das pontuacoes
    if (window.AnimacoesUI) {
      AnimacoesUI.listaEmCascata(this.elRankingFinal, '.ranking-item');
      this.elRankingFinal.querySelectorAll('.ranking-pontuacao').forEach((el) => {
        AnimacoesUI.contarAte(el, Number(el.dataset.pontos) || 0);
      });
    }
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

      // Com o menu aberto, o teclado eh do menu (Esc fecha nativamente)
      if (this._menuAberto()) return;

      if (evento.key === 'Escape') {
        evento.preventDefault();
        this._abrirMenuPartida();
        return;
      }

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
        if (this.telaAtiva !== 'jogo' || this._menuAberto()) return;
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
      if (this.telaAtiva !== 'jogo' || this._menuAberto()) return;
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
   * SUPORTE MOBILE
   * ======================================================================= */

  /**
   * Configura funcionalidades especificas para dispositivos mobile:
   * - Swipe global na tela inteira como controle principal
   * - Recalculo do canvas ao rotacionar o dispositivo
   * @private
   */
  _configurarMobile() {
    if (!Mobile.ehTouch()) return;

    // Swipe na tela inteira (controle principal mobile)
    Mobile.configurarSwipeGlobal(
      (direcao) => this.socket.emit('mudar-direcao', direcao),
      () => this.telaAtiva === 'jogo' && !this._menuAberto()
    );

    // Reajustar canvas ao rotacionar/redimensionar o dispositivo
    const reajustar = () => {
      if (this.telaAtiva === 'jogo' && this.renderizador) {
        this.renderizador.ajustarAoViewport();
      }
    };
    window.addEventListener('resize', reajustar);
    window.addEventListener('orientationchange', () => setTimeout(reajustar, 200));
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

    // Sala: Configuracao das comidas (da ponto, pontos, chances). O 'change'
    // dispara ao marcar/desmarcar e ao confirmar o numero (Enter ou sair do campo)
    this.elListaConfigComidas.addEventListener('change', (e) => {
      const linha = e.target.closest('.linha-comida');
      if (linha) this._enviarConfigComida(linha);
    });

    // Sala: Pontos por eliminacao
    this.elPontosEliminacao.addEventListener('change', () => {
      this.socket.emit('alterar-pontos-eliminacao', this._lerNumero(this.elPontosEliminacao), () => {});
    });

    // Sala: Marcar pronto
    this.elBotaoPronto.addEventListener('click', () => {
      this.estouPronto = !this.estouPronto;
      this.elBotaoPronto.textContent = this.estouPronto ? 'Cancelar Prontidão' : 'Estou Pronto!';
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
      this._voltarAoLobby();
    });

    // Resultado: Jogar novamente (revanche na MESMA sala, com os mesmos jogadores)
    this.elBotaoJogarNovamente.addEventListener('click', () => this._solicitarRevanche());

    // Resultado: Sair para o lobby
    if (this.elBotaoSairLobby) {
      this.elBotaoSairLobby.addEventListener('click', () => {
        this.socket.emit('sair-sala');
        this._voltarAoLobby();
      });
    }

    // Menu da partida
    this.elBotaoMenuPartida.addEventListener('click', () => this._abrirMenuPartida());
    this.elBotaoContinuarPartida.addEventListener('click', () => this._fecharMenuPartida());

    this.elBotaoSairPartida.addEventListener('click', () => {
      this._confirmarAcao(this.elBotaoSairPartida, 'Sair mesmo? Toque de novo', () => {
        this.socket.emit('sair-sala');
        this._voltarAoLobby();
      });
    });

    this.elBotaoEncerrarSala.addEventListener('click', () => {
      this._confirmarAcao(this.elBotaoEncerrarSala, 'Encerrar para todos? Toque de novo', () => {
        this.encerrandoSala = true;
        this.socket.emit('encerrar-sala', (resposta) => {
          if (resposta && resposta.sucesso) return; // 'sala-encerrada' leva ao lobby
          this.encerrandoSala = false;
          this._mostrarErroMenu((resposta && resposta.erro) || 'Não foi possível encerrar a sala.');
        });
      });
    });

    // Expulsar: um listener so para a lista inteira (delegacao de eventos)
    this.elMenuJogadores.addEventListener('click', (e) => {
      const botao = e.target.closest('.botao-expulsar');
      if (!botao) return;
      this._confirmarAcao(botao, 'Confirmar', () => {
        botao.disabled = true;
        this.socket.emit('expulsar-jogador', botao.dataset.id, (resposta) => {
          if (resposta && resposta.sucesso) return; // proximo estado atualiza a lista
          botao.disabled = false;
          this._mostrarErroMenu((resposta && resposta.erro) || 'Não foi possível expulsar.');
        });
      });
    });

    // Fechar o menu (Esc ou botao) devolve o foco ao botao que o abriu
    this.elDialogoMenu.addEventListener('close', () => {
      if (this.telaAtiva === 'jogo') this.elBotaoMenuPartida.focus();
    });
  }

  /* =========================================================================
   * MENU DA PARTIDA
   * Todos podem sair; o dono tambem pode expulsar jogadores e encerrar a
   * sala. O jogo nao pausa: o servidor continua rodando a partida.
   * ======================================================================= */

  /**
   * @returns {boolean} Se o menu da partida esta aberto.
   * @private
   */
  _menuAberto() {
    return !!(this.elDialogoMenu && this.elDialogoMenu.open);
  }

  /**
   * Abre o menu da partida como dialogo modal (prende o foco nele).
   * @private
   */
  _abrirMenuPartida() {
    if (this.telaAtiva !== 'jogo' || this._menuAberto()) return;
    this.menuJogadoresCache = '';
    this.elMenuErro.hidden = true;
    this._atualizarMenuPartida();
    this.elDialogoMenu.showModal();
    this.elBotaoContinuarPartida.focus();
  }

  /**
   * Fecha o menu da partida, se aberto.
   * @private
   */
  _fecharMenuPartida() {
    if (this._menuAberto()) this.elDialogoMenu.close();
  }

  /**
   * Mostra as opcoes de dono (lista de expulsao e encerrar sala) apenas
   * para o dono atual, e redesenha a lista quando os jogadores mudam.
   * @private
   */
  _atualizarMenuPartida() {
    const estado = this.ultimoEstado;
    const souDono = !!estado && estado.donoId === this.socket.id;

    this.elMenuSecaoDono.hidden = !souDono;
    this.elBotaoEncerrarSala.hidden = !souDono;
    if (!souDono) return;

    const outros = estado.jogadores.filter(j => j.id !== this.socket.id);
    const assinatura = outros.map(j => `${j.id}:${j.desconectado ? 1 : 0}`).join('|');
    if (assinatura === this.menuJogadoresCache) return;
    this.menuJogadoresCache = assinatura;

    if (outros.length === 0) {
      this.elMenuJogadores.innerHTML = '<li class="menu-partida-vazio">Ninguém para expulsar.</li>';
      return;
    }

    this.elMenuJogadores.innerHTML = outros.map((j) => {
      const nome = escaparHtml(j.apelido);
      const tags = `${j.ehBot ? ' 🤖' : ''}${j.desconectado ? ' 📡' : ''}`;
      return `
        <li class="menu-partida-jogador">
          <span class="placar-jogador-cor" style="background: ${j.cor.principal};"></span>
          <span class="menu-partida-nome">${nome}${tags}</span>
          <button class="botao-expulsar" type="button" data-id="${escaparHtml(j.id)}"
                  aria-label="Expulsar ${nome}">Expulsar</button>
        </li>
      `;
    }).join('');
  }

  /**
   * Confirmacao em dois toques para acoes destrutivas: o primeiro toque
   * troca o texto do botao; o segundo (em ate 3 s) executa a acao.
   * @param {HTMLButtonElement} botao - Botao da acao.
   * @param {string} textoConfirmar - Texto exibido aguardando confirmacao.
   * @param {Function} acao - Executada no segundo toque.
   * @private
   */
  _confirmarAcao(botao, textoConfirmar, acao) {
    if (botao.dataset.confirmando === '1') {
      clearTimeout(botao._timerConfirmacao);
      botao.dataset.confirmando = '';
      botao.textContent = botao.dataset.textoOriginal;
      botao.classList.remove('confirmando');
      acao();
      return;
    }

    botao.dataset.textoOriginal = botao.textContent;
    botao.dataset.confirmando = '1';
    botao.textContent = textoConfirmar;
    botao.classList.add('confirmando');
    botao._timerConfirmacao = setTimeout(() => {
      botao.dataset.confirmando = '';
      botao.textContent = botao.dataset.textoOriginal;
      botao.classList.remove('confirmando');
    }, 3000);
  }

  /**
   * Exibe uma mensagem de erro dentro do menu da partida.
   * @param {string} mensagem - Texto do erro.
   * @private
   */
  _mostrarErroMenu(mensagem) {
    this.elMenuErro.textContent = mensagem;
    this.elMenuErro.hidden = false;
  }

  /**
   * Volta ao lobby limpando o estado da sala/partida. Usado ao sair,
   * ao ser expulso e quando o dono encerra a sala.
   * @param {string|null} [mensagem] - Aviso a exibir no lobby.
   * @private
   */
  _voltarAoLobby(mensagem = null) {
    if (window.som) window.som.pararMusica();

    this.codigoSala = null;
    this.estouPronto = false;
    this.ultimoEstado = null;
    this.aguardandoReconexao = false;
    this._esconderOverlayReconexao();
    this.elBotaoPronto.textContent = 'Estou Pronto!';
    this.elBotaoPronto.classList.remove('pronto-ativo');

    this._mostrarTela('lobby');
    this._atualizarListaSalas();
    if (mensagem) this._exibirErro(mensagem);
  }
}

/* =========================================================================
 * INICIALIZACAO
 * ======================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  window.clienteMulti = new ClienteMultijogador();
});
