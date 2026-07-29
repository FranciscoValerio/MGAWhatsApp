import {
    useMultiFileAuthState,
    DisconnectReason,
    makeWASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import P from 'pino';
import { logger } from '../utils/logger.js';

const baileysLogger = P({
    level: 'warn',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'hostname,pid'
        }
    }
});

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.channels = new Map();
        this.messageStores = new Map();
        this.qrPromises = new Map();
        this.connectingChannels = new Set();
        this.repairingChannels = new Set();
        this.reconnectTimers = new Map();
    }

    async createChannel(channelId) {
        try {
            if (this.channels.has(channelId)) {
                throw new Error('Canal já existe');
            }

            const channelPath = path.join('src', 'channels', channelId);
            if (!fs.existsSync(channelPath)) {
                fs.mkdirSync(channelPath, { recursive: true });
            }

            this.channels.set(channelId, {
                status: 'CREATED',
                url_qrcode: null,
                lastSeen: new Date()
            });

            logger.info(`Canal ${channelId} criado`);

            let qrResolve, qrReject;
            const qrPromise = new Promise((resolve, reject) => {
                qrResolve = resolve;
                qrReject = reject;
            });
            this.qrPromises.set(channelId, { resolve: qrResolve, reject: qrReject });

            await this.initializeSession(channelId, true);

            try {
                await Promise.race([
                    qrPromise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout aguardando QR Code')), 15000)
                    )
                ]);
            } catch (timeoutError) {
                logger.warn(`Timeout aguardando QR Code para ${channelId}`);
            } finally {
                this.qrPromises.delete(channelId);
            }

            return {
                channelId,
                status: this.channels.get(channelId).status,
                url_qrcode: this.channels.get(channelId).url_qrcode
            };
        } catch (error) {
            logger.error(`Erro ao criar canal ${channelId}:`, error.message);
            this.qrPromises.delete(channelId);
            this.channels.delete(channelId);
            this.sessions.delete(channelId);
            throw error;
        }
    }

    async initializeSession(channelId, forceNew = false) {
        try {
            if (this.connectingChannels.has(channelId)) {
                logger.info(`Canal ${channelId} já está sendo inicializado`);
                return;
            }
            this.connectingChannels.add(channelId);

            const existingSession = this.sessions.get(channelId);
            if (existingSession?.socket) {
                try {
                    await existingSession.socket.end();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    logger.debug(`Erro ao fechar sessão anterior: ${error.message}`);
                }
            }
            this.sessions.delete(channelId);

            const channelPath = path.join('src', 'channels', channelId);
            const authPath = path.join(channelPath, 'auth_info');

            if (forceNew && fs.existsSync(authPath)) {
                logger.info(`Limpando autenticação do canal ${channelId}`);
                fs.rmSync(authPath, { recursive: true, force: true });
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const { state, saveCreds } = await useMultiFileAuthState(authPath);

            const hasValidAuth = state.creds?.me?.id;
            logger.info(`Inicializando ${channelId} - Auth existente: ${hasValidAuth ? 'Sim' : 'Não'}`);

            const { version } = await fetchLatestBaileysVersion();
            logger.info(`Usando WhatsApp Web versão: ${version.join('.')}`);

            let msgStore = this.messageStores.get(channelId);
            if (!msgStore) {
                msgStore = new Map();
                this.messageStores.set(channelId, msgStore);
            }

            const msgRetryCounterCache = new Map();
            const userDevicesCache = new Map();

            const socket = makeWASocket({
                version,
                logger: baileysLogger,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
                },
                browser: Browsers.ubuntu('MGA WhatsApp API'),
                printQRInTerminal: false,
                markOnlineOnConnect: true,
                syncFullHistory: false,
                defaultQueryTimeoutMs: 60_000,
                keepAliveIntervalMs: 25_000,
                connectTimeoutMs: 60_000,
                qrTimeout: 40_000,
                retryRequestDelayMs: 250,
                generateHighQualityLinkPreview: false,
                msgRetryCounterCache,
                userDevicesCache,
                getMessage: async (key) => {
                    const stored = msgStore.get(key.id);
                    if (stored?.message) {
                        logger.info(`[${channelId}] getMessage: encontrada mensagem ${key.id}`);
                        return stored.message;
                    }
                    logger.warn(`[${channelId}] getMessage: mensagem ${key.id} NÃO encontrada no store (${msgStore.size} msgs armazenadas)`);
                    return { conversation: '' };
                }
            });

            socket.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(channelId, update);
            });

            socket.ev.on('creds.update', saveCreds);

            socket.ev.on('messages.upsert', ({ messages, type }) => {
                for (const msg of messages) {
                    msgStore.set(msg.key.id, msg);
                    if (msg.key.fromMe) {
                        logger.info(`[${channelId}] Mensagem enviada armazenada no store: ${msg.key.id} (type: ${type})`);
                    } else {
                        logger.debug(`[${channelId}] Mensagem recebida de ${msg.key.remoteJid}`);
                    }
                }
            });

            socket.ev.on('messages.update', (updates) => {
                for (const { key, update } of updates) {
                    logger.info(`[${channelId}] Status atualizado: ${key.id} -> status: ${update.status}`);

                    if (update.status === 0 || update.status === 'ERROR') {
                        logger.warn(`[${channelId}] Mensagem ${key.id} com erro de entrega - possível sessão corrompida`);
                        this.repairSession(channelId).catch(err =>
                            logger.error(`[${channelId}] Falha no reparo automático: ${err.message}`)
                        );
                    }
                }
            });

            this.sessions.set(channelId, { socket, saveCreds });
            logger.info(`Sessão inicializada para canal ${channelId}`);

        } catch (error) {
            logger.error(`Erro ao inicializar sessão ${channelId}:`, error.message);
            throw error;
        } finally {
            this.connectingChannels.delete(channelId);
        }
    }

    async handleConnectionUpdate(channelId, update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info(`QR Code gerado para canal ${channelId}`);
            await this.handleQRCode(channelId, qr);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errorMessage = lastDisconnect?.error?.message || '';
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.info(`[${channelId}] Conexão fechada. Status: ${statusCode}, Msg: ${errorMessage}, Reconectar: ${shouldReconnect}`);

            const isCryptoError = errorMessage.includes('Bad MAC')
                || errorMessage.includes('decryption')
                || errorMessage.includes('hmac')
                || statusCode === DisconnectReason.badSession;

            if (isCryptoError) {
                logger.warn(`[${channelId}] Erro de criptografia detectado, iniciando reparo automático...`);
                this.repairSession(channelId).catch(err =>
                    logger.error(`[${channelId}] Falha no reparo por erro cripto: ${err.message}`)
                );
                return;
            }

            if (shouldReconnect) {
                const channel = this.channels.get(channelId);
                const attempts = (channel?.reconnectAttempts || 0) + 1;

                if (attempts <= 5) {
                    this.channels.set(channelId, {
                        ...channel,
                        status: 'RECONNECTING',
                        lastSeen: new Date(),
                        reconnectAttempts: attempts
                    });

                    const delay = Math.min(3000 * Math.pow(2, attempts - 1), 60000);
                    const timer = setTimeout(() => {
                        this.reconnectTimers.delete(channelId);
                        if (!this.channels.has(channelId)) {
                            return;
                        }
                        this.sessions.delete(channelId);
                        this.initializeSession(channelId);
                    }, delay);
                    this.reconnectTimers.set(channelId, timer);
                } else {
                    logger.error(`Canal ${channelId} atingiu limite de reconexões`);
                    this.channels.set(channelId, {
                        ...channel,
                        status: 'FAILED',
                        lastSeen: new Date(),
                        reconnectAttempts: 0
                    });
                }
            } else {
                this.channels.set(channelId, {
                    ...this.channels.get(channelId),
                    status: 'LOGGED_OUT',
                    lastSeen: new Date()
                });
                this.sessions.delete(channelId);
            }
        }

        if (connection === 'open') {
            logger.info(`✅ Canal ${channelId} conectado com sucesso!`);
            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'CONNECTED',
                url_qrcode: null,
                lastSeen: new Date(),
                reconnectAttempts: 0
            });

            const socket = this.getSocket(channelId);
            if (socket) {
                try {
                    await socket.sendPresenceUpdate('available');
                    logger.info(`[${channelId}] Presença 'available' enviada`);
                } catch (err) {
                    logger.warn(`[${channelId}] Erro ao enviar presença: ${err.message}`);
                }
            }
        }

        if (connection === 'connecting') {
            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'CONNECTING',
                lastSeen: new Date()
            });
        }
    }

    async handleQRCode(channelId, qr) {
        this.channels.set(channelId, {
            ...this.channels.get(channelId),
            status: 'QRCODE',
            url_qrcode: qr,
            lastSeen: new Date()
        });
        logger.info(`✅ QR Code pronto para canal ${channelId}`);

        const qrPromise = this.qrPromises.get(channelId);
        if (qrPromise) {
            qrPromise.resolve();
        }
    }

    getChannelStatus(channelId) {
        if (!this.channels.has(channelId)) {
            return null;
        }
        return {
            channelId,
            ...this.channels.get(channelId)
        };
    }

    getSocket(channelId) {
        return this.sessions.get(channelId)?.socket || null;
    }

    storeMessage(channelId, msg) {
        const store = this.messageStores.get(channelId);
        if (store && msg?.key?.id) {
            store.set(msg.key.id, msg);
        }
    }

    isChannelConnected(channelId) {
        const channel = this.channels.get(channelId);
        return channel?.status === 'CONNECTED';
    }

    getAllChannels() {
        const channels = [];
        for (const [channelId, data] of this.channels.entries()) {
            channels.push({ channelId, ...data });
        }
        return channels;
    }

    async closeChannel(channelId) {
        const timer = this.reconnectTimers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(channelId);
        }

        try {
            const session = this.sessions.get(channelId);
            if (session?.socket) {
                try {
                    await Promise.race([
                        session.socket.logout(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Timeout ao fazer logout')), 8000)
                        )
                    ]);
                } catch (logoutError) {
                    logger.warn(`Logout falhou/expirou para ${channelId}, forçando fechamento: ${logoutError.message}`);
                    try {
                        session.socket.end(new Error('Fechamento forçado'));
                    } catch (endError) {
                        logger.debug(`Erro ao forçar fechamento do socket ${channelId}: ${endError.message}`);
                    }
                }
            }
        } finally {
            this.sessions.delete(channelId);
            this.channels.delete(channelId);
            this.messageStores.delete(channelId);

            try {
                const authPath = path.join('src', 'channels', channelId, 'auth_info');
                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                }
            } catch (fsError) {
                logger.warn(`Erro ao remover auth_info do canal ${channelId}: ${fsError.message}`);
            }

            logger.info(`Canal ${channelId} fechado`);
        }
    }

    async regenerateQRCode(channelId) {
        try {
            logger.info(`Regenerando QR Code para canal ${channelId}`);

            const session = this.sessions.get(channelId);
            if (session?.socket) {
                try {
                    await session.socket.end();
                } catch (error) {
                    logger.debug(`Erro ao fechar socket: ${error.message}`);
                }
            }
            this.sessions.delete(channelId);

            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.initializeSession(channelId, true);

            return {
                channelId,
                status: this.channels.get(channelId)?.status,
                url_qrcode: this.channels.get(channelId)?.url_qrcode
            };
        } catch (error) {
            logger.error(`Erro ao regenerar QR Code ${channelId}:`, error);
            throw error;
        }
    }

    async testConnection(channelId) {
        try {
            const socket = this.getSocket(channelId);
            if (!socket) {
                return { healthy: false, reason: 'Socket não encontrado' };
            }

            if (!socket.ws || socket.ws.readyState !== 1) {
                return { healthy: false, reason: 'WebSocket não está aberto' };
            }

            return { healthy: true, reason: 'Conexão OK' };
        } catch (error) {
            return { healthy: false, reason: error.message };
        }
    }

    async repairSession(channelId) {
        if (this.repairingChannels.has(channelId)) {
            return;
        }

        try {
            this.repairingChannels.add(channelId);
            logger.info(`[${channelId}] Iniciando reparo de sessão (limpeza de chaves cripto)...`);

            const authPath = path.join('src', 'channels', channelId, 'auth_info');
            if (!fs.existsSync(authPath)) {
                logger.warn(`[${channelId}] Pasta auth_info não encontrada, cancelando reparo`);
                return;
            }

            const session = this.sessions.get(channelId);
            if (session?.socket) {
                try {
                    await session.socket.end();
                } catch (err) {
                    logger.debug(`[${channelId}] Erro ao fechar socket para reparo: ${err.message}`);
                }
            }
            this.sessions.delete(channelId);

            const files = fs.readdirSync(authPath);
            let cleaned = 0;
            for (const file of files) {
                if (file.startsWith('sender-key-') || file.startsWith('session-') || file.startsWith('pre-key-')) {
                    fs.unlinkSync(path.join(authPath, file));
                    cleaned++;
                }
            }
            logger.info(`[${channelId}] ${cleaned} arquivo(s) de chaves cripto removidos (auth principal mantida)`);

            await new Promise(resolve => setTimeout(resolve, 1000));

            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'REPAIRING',
                lastSeen: new Date()
            });

            await this.initializeSession(channelId, false);
            logger.info(`[${channelId}] Reparo de sessão concluído`);
        } catch (error) {
            logger.error(`[${channelId}] Erro no reparo de sessão: ${error.message}`);
        } finally {
            this.repairingChannels.delete(channelId);
        }
    }

    async restoreSession(channelId) {
        try {
            if (this.channels.has(channelId) && this.isChannelConnected(channelId)) {
                logger.info(`Canal ${channelId} já está conectado`);
                return;
            }

            const channelPath = path.join('src', 'channels', channelId);
            if (!fs.existsSync(channelPath)) {
                throw new Error('Canal não encontrado');
            }

            this.channels.set(channelId, {
                status: 'RESTORING',
                url_qrcode: null,
                lastSeen: new Date()
            });

            await this.initializeSession(channelId, false);

            return {
                channelId,
                status: this.channels.get(channelId)?.status
            };
        } catch (error) {
            logger.error(`Erro ao restaurar sessão ${channelId}:`, error.message);
            throw error;
        }
    }
}

export default new SessionManager();
