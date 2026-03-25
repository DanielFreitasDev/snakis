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

/* =========================================================================
 * EVENTOS DO SOCKET.IO
 * Cada evento corresponde a uma acao do cliente. O servidor valida
 * a acao e atualiza o estado conforme necessario.
 * ======================================================================= */

io.on('connection', (socket) => {
  console.log(`[Conexao] Jogador conectado: ${socket.id}`);

  /* -----------------------------------------------------------------------
   * LOBBY: Listar, criar e entrar em salas
   * --------------------------------------------------------------------- */

  /**
   * Retorna a lista de salas disponiveis para o lobby do multiplayer.
   * Filtra apenas salas que ainda estao aguardando jogadores.
   */
  socket.on('listar-salas', (callback) => {
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
    callback(listaSalas);
  });

  /**
   * Cria uma nova sala de jogo e adiciona o jogador como primeiro participante.
   * Retorna o codigo da sala criada para que outros possam entrar.
   */
  socket.on('criar-sala', ({ apelido }, callback) => {
    // Se ja esta em uma sala, sair primeiro
    _sairDaSalaAtual(socket);

    const codigo = gerarCodigoSala();
    const sala = new SalaDeJogo(codigo, io);
    salas.set(codigo, sala);

    // Entrar na room do Socket.IO e registrar o jogador
    socket.join(codigo);
    sala.adicionarJogador(socket.id, apelido);
    jogadorParaSala.set(socket.id, codigo);

    console.log(`[Sala] "${apelido}" criou a sala ${codigo}`);
    callback({ sucesso: true, codigo });

    // Notificar todos os participantes da sala sobre a atualizacao
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Adiciona o jogador a uma sala existente identificada pelo codigo.
   * Valida se a sala existe, esta aberta e tem vagas.
   */
  socket.on('entrar-sala', ({ codigo, apelido }, callback) => {
    _sairDaSalaAtual(socket);

    const codigoNormalizado = codigo.toUpperCase().trim();
    const sala = salas.get(codigoNormalizado);

    if (!sala) {
      callback({ sucesso: false, erro: 'Sala nao encontrada.' });
      return;
    }

    if (sala.estado !== 'aguardando') {
      callback({ sucesso: false, erro: 'A partida ja esta em andamento.' });
      return;
    }

    if (sala.obterQuantidadeJogadores() >= sala.maxJogadores) {
      callback({ sucesso: false, erro: 'A sala esta cheia.' });
      return;
    }

    socket.join(codigoNormalizado);
    sala.adicionarJogador(socket.id, apelido);
    jogadorParaSala.set(socket.id, codigoNormalizado);

    console.log(`[Sala] "${apelido}" entrou na sala ${codigoNormalizado}`);
    callback({ sucesso: true, codigo: codigoNormalizado });

    io.to(codigoNormalizado).emit('sala-atualizada', sala.obterInfoSala());
  });

  /* -----------------------------------------------------------------------
   * SALA: Prontidao e inicio de partida
   * --------------------------------------------------------------------- */

  /**
   * Alterna o estado de "pronto" do jogador na sala.
   * Quando todos estiverem prontos, o jogo pode ser iniciado.
   */
  socket.on('jogador-pronto', () => {
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
  socket.on('iniciar-partida', () => {
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
  socket.on('mudar-direcao', (direcao) => {
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
  socket.on('adicionar-bot', (callback) => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return callback({ sucesso: false, erro: 'Voce nao esta em uma sala.' });

    const sala = salas.get(codigo);
    if (!sala) return callback({ sucesso: false, erro: 'Sala nao encontrada.' });

    if (sala.estado !== 'aguardando') {
      return callback({ sucesso: false, erro: 'A partida ja esta em andamento.' });
    }

    const resultado = sala.adicionarBot();
    callback(resultado);

    if (resultado.sucesso) {
      io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
    }
  });

  /**
   * Remove o ultimo bot da sala do jogador.
   */
  socket.on('remover-bot', (callback) => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return callback({ sucesso: false, erro: 'Voce nao esta em uma sala.' });

    const sala = salas.get(codigo);
    if (!sala) return callback({ sucesso: false, erro: 'Sala nao encontrada.' });

    if (sala.estado !== 'aguardando') {
      return callback({ sucesso: false, erro: 'A partida ja esta em andamento.' });
    }

    const resultado = sala.removerBot();
    callback(resultado);

    if (resultado.sucesso) {
      io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
    }
  });

  /**
   * Altera o tempo da partida.
   */
  socket.on('alterar-tempo-partida', (segundos, callback) => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return callback({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return callback({ sucesso: false });

    sala.alterarTempoPartida(segundos);
    callback({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /**
   * Altera a dificuldade dos bots na sala.
   */
  socket.on('alterar-dificuldade-bots', (nivel, callback) => {
    const codigo = jogadorParaSala.get(socket.id);
    if (!codigo) return callback({ sucesso: false });

    const sala = salas.get(codigo);
    if (!sala || sala.estado !== 'aguardando') return callback({ sucesso: false });

    sala.alterarDificuldadeBots(nivel);
    callback({ sucesso: true });
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());
  });

  /* -----------------------------------------------------------------------
   * SALA: Sair e voltar ao lobby
   * --------------------------------------------------------------------- */

  /**
   * Jogador solicita sair da sala voluntariamente.
   */
  socket.on('sair-sala', () => {
    _sairDaSalaAtual(socket);
  });

  /* -----------------------------------------------------------------------
   * DESCONEXAO
   * --------------------------------------------------------------------- */

  /**
   * Limpa os dados do jogador ao desconectar (fechar aba, perder conexao).
   */
  socket.on('disconnect', () => {
    console.log(`[Conexao] Jogador desconectado: ${socket.id}`);
    _sairDaSalaAtual(socket);
  });
});

/* =========================================================================
 * FUNCOES AUXILIARES
 * ======================================================================= */

/**
 * Remove o jogador da sala em que esta atualmente (se estiver em alguma).
 * Limpa a sala caso fique vazia.
 * @param {import('socket.io').Socket} socket - Socket do jogador.
 */
function _sairDaSalaAtual(socket) {
  const codigo = jogadorParaSala.get(socket.id);
  if (!codigo) return;

  const sala = salas.get(codigo);
  if (sala) {
    sala.removerJogador(socket.id);
    socket.leave(codigo);

    // Notificar demais jogadores
    io.to(codigo).emit('sala-atualizada', sala.obterInfoSala());

    // Limpar sala quando nao houver mais jogadores humanos
    if (sala.obterQuantidadeHumanos() === 0) {
      sala.parar();
      salas.delete(codigo);
      console.log(`[Sala] Sala ${codigo} removida (vazia)`);
    }
  }

  jogadorParaSala.delete(socket.id);
}

/* =========================================================================
 * INICIAR O SERVIDOR
 * ======================================================================= */

servidorHttp.listen(PORTA, '0.0.0.0', () => {
  const ipLocal = obterIpLocal();

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║        🐍  SNAKE GAME - Servidor Ativo       ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Local:  http://localhost:${PORTA}              ║`);
  console.log(`  ║  Rede:   http://${ipLocal}:${PORTA}          ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║  Compartilhe o endereco de rede com seus     ║');
  console.log('  ║  amigos para jogar no modo multiplayer!      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
