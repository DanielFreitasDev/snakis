/**
 * @fileoverview Servidor principal do jogo Snake multiplayer.
 *
 * Este modulo configura o Express para servir os arquivos estaticos da
 * interface e o Socket.IO para comunicacao em tempo real. Gerencia
 * a criacao/destruicao de salas de jogo e o roteamento de eventos
 * entre os clientes conectados.
 *
 * Padrao utilizado: Mediator Pattern - o servidor atua como mediador
 * central de comunicacao entre os clientes, encaminhando mensagens
 * e coordenando o estado das salas.
 *
 * Uso: node servidor.js
 * O servidor escuta na porta definida pela variavel de ambiente PORTA
 * ou na porta 3000 por padrao.
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const SalaDeJogo = require('./jogo/SalaDeJogo');
const RankingPersistente = require('./jogo/RankingPersistente');

/* =========================================================================
 * INICIALIZACAO DO SERVIDOR
 * ======================================================================= */

const aplicacao = express();
const servidorHttp = createServer(aplicacao);

/**
 * Configuracao do Socket.IO com CORS liberado para permitir
 * conexoes de qualquer origem na rede local.
 */
const io = new Server(servidorHttp, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

/** Porta do servidor (variavel de ambiente ou padrao 3000) */
const PORTA = process.env.PORTA || 3000;

/** Servir arquivos estaticos da pasta 'publico' */
aplicacao.use(express.static(path.join(__dirname, 'publico')));

/* =========================================================================
 * GERENCIAMENTO DE SALAS E JOGADORES
 * ======================================================================= */

/** @type {Map<string, SalaDeJogo>} Mapa de codigo da sala -> instancia */
const salas = new Map();

/** @type {Map<string, string>} Mapa de socketId do jogador -> codigo da sala */
const jogadorParaSala = new Map();

/** @type {Map<string, string>} Mapa de token de sessao -> codigo da sala (reconexao) */
const tokenParaSala = new Map();

/** Ranking persistente entre partidas (Hall da Fama), gravado em dados/ranking.json */
const rankingPersistente = new RankingPersistente();

/**
 * Valida um token de sessao vindo do cliente. Tokens sao UUIDs (ou
 * equivalentes) gerados no navegador: apenas letras, numeros e hifens.
 * @param {*} token - Valor bruto recebido.
 * @returns {boolean} True se o token pode ser usado.
 */
function tokenValido(token) {
  return typeof token === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(token);
}

/**
 * Cria uma sala ja conectada aos servicos do servidor: ranking
 * persistente, limpeza de tokens e autodestruicao quando esvaziar.
 * @param {string} codigo - Codigo da nova sala.
 * @returns {SalaDeJogo}
 */
function criarSalaConfigurada(codigo) {
  const sala = new SalaDeJogo(codigo, io);

  sala.aoFinalizarPartida = (ranking) => rankingPersistente.registrarPartida(ranking);
  sala.aoRemoverJogador = (jogador) => {
    if (jogador && jogador.token) tokenParaSala.delete(jogador.token);
  };
  sala.aoEsvaziar = () => destruirSala(codigo);

  return sala;
}

/**
 * Para o loop da sala, remove-a do registro e limpa os tokens de
 * sessao que apontavam para ela.
 * @param {string} codigo - Codigo da sala a destruir.
 */
function destruirSala(codigo) {
  const sala = salas.get(codigo);
  if (!sala) return;

  sala.parar();
  salas.delete(codigo);

  for (const [token, codigoDaSala] of tokenParaSala) {
    if (codigoDaSala === codigo) tokenParaSala.delete(token);
  }

  console.log(`[Sala] Sala ${codigo} removida`);
}

/**
 * Gera um codigo alfanumerico aleatorio para identificar uma sala.
 * O codigo eh curto o suficiente para ser compartilhado verbalmente.
 * @returns {string} Codigo de 5 caracteres em maiusculas.
 */
function gerarCodigoSala() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem I/1/O/0 para evitar confusao
  let codigo = '';
  for (let i = 0; i < 5; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  // Verificar unicidade (colisao eh improvavel, mas prevenir nao custa)
  return salas.has(codigo) ? gerarCodigoSala() : codigo;
}

/**
 * Obtem o endereco IP local da maquina na rede (IPv4, nao-loopback).
 * Usado para exibir o endereco de acesso na rede local.
 * @returns {string} Endereco IP local ou 'localhost' se nao encontrado.
 */
function obterIpLocal() {
  const interfaces = os.networkInterfaces();
  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * Garante que o callback de um evento seja sempre uma funcao chamavel.
 * Clientes maliciosos podem omitir o callback ou enviar outro tipo —
 * chamar algo que nao eh funcao derrubaria o handler.
 * @param {*} callback - Valor recebido do cliente.
 * @returns {Function} Callback seguro.
 */
function callbackSeguro(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

/**
 * Envolve um handler de evento em try/catch para que nenhuma excecao
 * (payload inesperado, bug interno) derrube o processo do servidor.
 * @param {string} nome - Nome do evento (para log).
 * @param {Function} handler - Handler original.
 * @returns {Function} Handler protegido.
 */
function handlerSeguro(nome, handler) {
  return (...args) => {
    try {
      handler(...args);
    } catch (erro) {
      console.error(`[Erro] Evento "${nome}" falhou:`, erro.message);
    }
  };
}

/* =========================================================================
 * EVENTOS DO SOCKET.IO
 * Cada evento corresponde a uma acao do cliente. O servidor valida
 * a acao e atualiza o estado conforme necessario.
 * ======================================================================= */

io.on('connection', (socket) => {
  console.log(`[Conexao] Jogador conectado: ${socket.id}`);

  /** Registra um evento com protecao automatica contra excecoes */
  const registrar = (nome, handler) => socket.on(nome, handlerSeguro(nome, handler));

  /* -----------------------------------------------------------------------
   * LOBBY: Listar, criar e entrar em salas
   * --------------------------------------------------------------------- */

  /**
   * Retorna a lista de salas disponiveis para o lobby do multiplayer.
   * Filtra apenas salas que ainda estao aguardando jogadores.
   */
  registrar('listar-salas', (callback) => {
    const responder = callbackSeguro(callback);
    const listaSalas = [];
    for (const [codigo, sala] of salas) {
      if (sala.estado === 'aguardando') {
        listaSalas.push({
          codigo,
          jogadores: sala.obterQuantidadeJogadores(),
          maxJogadores: sala.maxJogadores,
          estado: sala.estado,
        });
      }
    }
    responder(listaSalas);
  });

  /**
   * Cria uma nova sala de jogo e adiciona o jogador como primeiro participante.
   * Retorna o codigo da sala criada para que outros possam entrar.
   */
  registrar('criar-sala', (dados, callback) => {
    const responder = callbackSeguro(callback);
    const apelido = dados && dados.apelido;
    const token = dados && dados.token;

    // Se ja esta em uma sala, sair primeiro
    _sairDaSalaAtual(socket);

    const codigo = gerarCodigoSala();
    const sala = criarSalaConfigurada(codigo);
    salas.set(codigo, sala);

    // Entrar na room do Socket.IO e registrar o jogador
    socket.join(codigo);
    sala.adicionarJogador(socket.id, apelido, tokenValido(token) ? token : null);
    jogadorParaSala.set(socket.id, codigo);
    if (tokenValido(token)) tokenParaSala.set(token, codigo);

    console.log(`[Sala] "${apelido}" criou a sala ${codigo}`);
    responder({ sucesso: true, codigo });

    // Notificar todos os participantes da sala sobre a atualizacao
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Adiciona o jogador a uma sala existente identificada pelo codigo.
   * Valida se a sala existe, esta aberta e tem vagas.
   */
  registrar('entrar-sala', (dados, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = dados && dados.codigo;
    const apelido = dados && dados.apelido;
    const token = dados && dados.token;

    if (typeof codigo !== 'string') {
      responder({ sucesso: false, erro: 'Código inválido.' });
      return;
    }

    _sairDaSalaAtual(socket);

    const codigoNormalizado = codigo.toUpperCase().trim();
    const sala = salas.get(codigoNormalizado);

    if (!sala) {
      responder({ sucesso: false, erro: 'Sala não encontrada.' });
      return;
    }

    if (sala.estado !== 'aguardando') {
      responder({ sucesso: false, erro: 'A partida já está em andamento.' });
      return;
    }

    if (sala.obterQuantidadeJogadores() >= sala.maxJogadores) {
      responder({ sucesso: false, erro: 'A sala está cheia.' });
      return;
    }

    socket.join(codigoNormalizado);
    sala.adicionarJogador(socket.id, apelido, tokenValido(token) ? token : null);
    jogadorParaSala.set(socket.id, codigoNormalizado);
    if (tokenValido(token)) tokenParaSala.set(token, codigoNormalizado);

    console.log(`[Sala] "${apelido}" entrou na sala ${codigoNormalizado}`);
    responder({ sucesso: true, codigo: codigoNormalizado });

    io.to(codigoNormalizado).emit('sala-atualizada', sala.obterInfoSala());
  });

  /* -----------------------------------------------------------------------
   * SALA: Prontidao e inicio de partida
   * --------------------------------------------------------------------- */

  /**
   * Alterna o estado de "pronto" do jogador na sala.
   * Quando todos estiverem prontos, o jogo pode ser iniciado.
   */
  registrar('jogador-pronto', () => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return;

    const sala = salas.get(codigo);
    if (!sala) return;

    sala.marcarPronto(socket.id);
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Inicia a partida se todas as condicoes forem atendidas.
   * Qualquer jogador pode solicitar o inicio.
   */
  registrar('iniciar-partida', () => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return;

    const sala = salas.get(codigo);
    if (!sala) return;

    if (sala.podeIniciar()) {
      sala.iniciarJogo();
      io.to(codigo).emit('partida-iniciada');
      console.log(`[Jogo] Partida iniciada na sala ${codigo}`);
    }
  });

  /* -----------------------------------------------------------------------
   * JOGO: Movimentacao
   * --------------------------------------------------------------------- */

  /**
   * Recebe a mudanca de direcao de um jogador e encaminha para a sala.
   * A validacao da direcao (anti-180°) eh feita na SalaDeJogo.
   */
  registrar('mudar-direcao', (direcao) => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return;

    const sala = salas.get(codigo);
    if (!sala) return;

    sala.mudarDirecao(socket.id, direcao);
  });

  /* -----------------------------------------------------------------------
   * SALA: Gerenciamento de bots
   * --------------------------------------------------------------------- */

  /**
   * Adiciona um bot a sala do jogador.
   */
  registrar('adicionar-bot', (callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false, erro: 'Você não está em uma sala.' });

    const sala = salas.get(codigo);
    if (!sala) return responder({ sucesso: false, erro: 'Sala não encontrada.' });

    if (sala.estado !== 'aguardando') {
      return responder({ sucesso: false, erro: 'A partida já está em andamento.' });
    }

    const resultado = sala.adicionarBot();
    responder(resultado);

    if (resultado.sucesso) {
      io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
    }
  });

  /**
   * Remove o ultimo bot da sala do jogador.
   */
  registrar('remover-bot', (callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false, erro: 'Você não está em uma sala.' });

    const sala = salas.get(codigo);
    if (!sala) return responder({ sucesso: false, erro: 'Sala não encontrada.' });

    if (sala.estado !== 'aguardando') {
      return responder({ sucesso: false, erro: 'A partida já está em andamento.' });
    }

    const resultado = sala.removerBot();
    responder(resultado);

    if (resultado.sucesso) {
      io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
    }
  });

  /**
   * Altera o tempo da partida.
   */
  registrar('alterar-tempo-partida', (segundos, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return responder({ sucesso: false });

    sala.alterarTempoPartida(segundos);
    responder({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Altera a dificuldade dos bots na sala.
   */
  registrar('alterar-dificuldade-bots', (nivel, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return responder({ sucesso: false });

    sala.alterarDificuldadeBots(nivel);
    responder({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Altera a configuracao de uma comida: se da ponto, quanto e quantas
   * chances tem de aparecer (ex: 'dourada', { daPonto: true, pontos: 50, chances: 15 }).
   */
  registrar('alterar-config-comida', (tipo, dados, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return responder({ sucesso: false });

    sala.alterarConfigComida(tipo, dados);
    responder({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Altera quantos pontos vale eliminar outro jogador.
   */
  registrar('alterar-pontos-eliminacao', (valor, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return responder({ sucesso: false });

    sala.alterarPontosEliminacao(valor);
    responder({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Revanche: reabre a sala finalizada para uma nova partida,
   * mantendo jogadores, bots e configurações.
   */
  registrar('voltar-sala', (callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return responder({ sucesso: false, erro: 'Você não está em uma sala.' });

    const sala = salas.get(codigo);
    if (!sala) return responder({ sucesso: false, erro: 'Sala não encontrada.' });

    if (!sala.reiniciarParaLobby()) {
      return responder({ sucesso: false, erro: 'A partida ainda está em andamento.' });
    }

    responder({ sucesso: true, codigo });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /* -----------------------------------------------------------------------
   * RECONEXAO E RANKING PERSISTENTE
   * --------------------------------------------------------------------- */

  /**
   * Tenta retomar uma sessao de jogo apos queda de conexao ou reload
   * da pagina. O cliente apresenta seu token de sessao; se houver uma
   * sala com aquele token, o jogador eh remapeado para o novo socket.
   */
  registrar('reconectar-partida', (dados, callback) => {
    const responder = callbackSeguro(callback);
    const token = dados && dados.token;

    if (!tokenValido(token)) {
      return responder({ sucesso: false, erro: 'Sessão inválida.' });
    }

    const codigo = tokenParaSala.get(token);
    const sala = codigo ? salas.get(codigo) : null;

    if (!sala) {
      tokenParaSala.delete(token);
      return responder({ sucesso: false, erro: 'Nenhuma partida para retomar.' });
    }

    // Seguranca: se este socket ja estava em outra sala, sair dela primeiro
    _sairDaSalaAtual(socket);

    const resultado = sala.reconectarJogador(token, socket.id);
    if (!resultado.sucesso) {
      return responder({ sucesso: false, erro: resultado.erro });
    }

    // Derrubar o socket antigo "zumbi", se ainda constar como conectado
    if (resultado.socketIdAntigo && resultado.socketIdAntigo !== socket.id) {
      jogadorParaSala.delete(resultado.socketIdAntigo);
      const socketAntigo = io.sockets.sockets.get(resultado.socketIdAntigo);
      if (socketAntigo) {
        socketAntigo.leave(codigo);
        socketAntigo.disconnect(true);
      }
    }

    socket.join(codigo);
    jogadorParaSala.set(socket.id, codigo);

    console.log(`[Sala] "${resultado.apelido}" reconectou na sala ${codigo}`);
    responder({
      sucesso: true,
      codigo,
      estado: resultado.estado,
      apelido: resultado.apelido,
    });

    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Retorna o Hall da Fama (ranking persistente entre partidas).
   */
  registrar('obter-ranking', (callback) => {
    const responder = callbackSeguro(callback);
    responder(rankingPersistente.obterTop(10));
  });

  /* -----------------------------------------------------------------------
   * SALA: Poderes do dono (expulsar jogador e encerrar a sala)
   * --------------------------------------------------------------------- */

  /**
   * O dono expulsa um jogador (humano ou bot). O expulso sai da sala em
   * definitivo: o token de sessao eh liberado, entao ele nao consegue
   * "reconectar" de volta na partida.
   */
  registrar('expulsar-jogador', (jogadorId, callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    const sala = codigo ? salas.get(codigo) : null;
    if (!sala) return responder({ sucesso: false, erro: 'Você não está em uma sala.' });

    const resultado = sala.expulsarJogador(socket.id, jogadorId);
    if (!resultado.sucesso) return responder(resultado);

    const expulso = resultado.jogador;
    if (expulso.token) tokenParaSala.delete(expulso.token);

    // Humano conectado: tirar o socket da sala e avisa-lo
    if (!expulso.ehBot) {
      jogadorParaSala.delete(expulso.id);
      const socketExpulso = io.sockets.sockets.get(expulso.id);
      if (socketExpulso) {
        socketExpulso.leave(codigo);
        socketExpulso.emit('voce-foi-expulso');
      }
    }

    console.log(`[Sala] "${expulso.apelido}" foi expulso da sala ${codigo}`);
    responder({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * O dono encerra a sala: todos voltam ao lobby e a partida em
   * andamento eh descartada (nao entra no Hall da Fama).
   */
  registrar('encerrar-sala', (callback) => {
    const responder = callbackSeguro(callback);
    const codigo = jogadorParaSala.get(socket.id);
    const sala = codigo ? salas.get(codigo) : null;
    if (!sala) return responder({ sucesso: false, erro: 'Você não está em uma sala.' });

    if (!sala.ehDono(socket.id)) {
      return responder({ sucesso: false, erro: 'Só o dono da sala pode encerrá-la.' });
    }

    // Avisar todos (inclusive o dono) antes de desmontar a sala
    io.to(codigo).emit('sala-encerrada');

    for (const jogador of sala.jogadores.values()) {
      if (jogador.ehBot) continue;
      jogadorParaSala.delete(jogador.id);
      const socketJogador = io.sockets.sockets.get(jogador.id);
      if (socketJogador) socketJogador.leave(codigo);
    }

    destruirSala(codigo);
    console.log(`[Sala] Sala ${codigo} encerrada pelo dono`);
    responder({ sucesso: true });
  });

  /* -----------------------------------------------------------------------
   * SALA: Sair e voltar ao lobby
   * --------------------------------------------------------------------- */

  /**
   * Jogador solicita sair da sala voluntariamente.
   */
  registrar('sair-sala', () => {
    _sairDaSalaAtual(socket);
  });

  /* -----------------------------------------------------------------------
   * DESCONEXAO
   * --------------------------------------------------------------------- */

  /**
   * Trata a queda de conexao (fechar aba, perder rede). Durante uma
   * partida o jogador entra em periodo de graca e pode reconectar;
   * fora dela, eh removido como em uma saida voluntaria.
   */
  registrar('disconnect', () => {
    console.log(`[Conexao] Jogador desconectado: ${socket.id}`);
    _sairDaSalaAtual(socket, { podeReconectar: true });
  });
});

/* =========================================================================
 * FUNCOES AUXILIARES
 * ======================================================================= */

/**
 * Remove o jogador da sala em que esta atualmente (se estiver em alguma).
 * Em quedas de conexao durante a partida (podeReconectar), o jogador
 * entra em periodo de graca em vez de ser removido. Limpa a sala caso
 * fique sem humanos (contando os que ainda podem reconectar).
 * @param {import('socket.io').Socket} socket - Socket do jogador.
 * @param {{podeReconectar?: boolean}} [opcoes] - Comportamento da saida.
 */
function _sairDaSalaAtual(socket, opcoes = {}) {
  const codigo = jogadorParaSala.get(socket.id);
  if (!codigo) return;

  jogadorParaSala.delete(socket.id);

  const sala = salas.get(codigo);
  if (!sala) return;

  // Queda de conexao no meio da partida: reservar a vaga do jogador
  if (opcoes.podeReconectar && sala.marcarDesconectado(socket.id)) {
    socket.leave(codigo);
    return;
  }

  // Saida definitiva: liberar o token de sessao
  const jogador = sala.jogadores.get(socket.id);
  if (jogador && jogador.token) tokenParaSala.delete(jogador.token);

  sala.removerJogador(socket.id);
  socket.leave(codigo);

  // Notificar demais jogadores
  io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());

  // Limpar sala quando nao houver mais jogadores humanos
  // (desconectados em graca contam como presentes ate expirar)
  if (sala.obterQuantidadeHumanos() === 0) {
    destruirSala(codigo);
  }
}

/* =========================================================================
 * INICIAR O SERVIDOR
 * ======================================================================= */

servidorHttp.listen(PORTA, '0.0.0.0', () => {
  const ipLocal = obterIpLocal();

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║       🐍  SNAKIS - Servidor Rastejando!      ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Local:  http://localhost:${PORTA}              ║`);
  console.log(`  ║  Rede:   http://${ipLocal}:${PORTA}          ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║  Compartilhe o endereco de rede com seus     ║');
  console.log('  ║  amigos e descubra quem e a cobra suprema!   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
