import {
    useMultiFileAuthState,
    DisconnectReason,
    makeWASocket,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import P from 'pino';
import { logger } from '../utils/logger.js';

// Logger do Baileys com nível reduzido
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

/**
 * SessionManager - Gerenciador de sessões WhatsApp
 * Baseado na documentação oficial do Baileys
 */
class SessionManager {
    constructor() {
        this.sessions = new Map(); // channelId -> { socket, saveCreds }
        this.channels = new Map(); // channelId -> { status, qrCode, lastSeen }
        this.qrPromises = new Map();
        this.connectingChannels = new Set();
    }

    /**
     * Criar um novo canal WhatsApp
     */
    async createChannel(channelId) {
        try {
            if (this.channels.has(channelId)) {
                throw new Error('Canal já existe');
            }

            // Criar diretório do canal
            const channelPath = path.join('src', 'channels', channelId);
            if (!fs.existsSync(channelPath)) {
                fs.mkdirSync(channelPath, { recursive: true });
            }

            this.channels.set(channelId, {
                status: 'CREATED',
                qrCode: null,
                lastSeen: new Date()
            });

            logger.info(`Canal ${channelId} criado`);

            // Criar promise para aguardar QR Code
            let qrResolve, qrReject;
            const qrPromise = new Promise((resolve, reject) => {
                qrResolve = resolve;
                qrReject = reject;
            });
            this.qrPromises.set(channelId, { resolve: qrResolve, reject: qrReject });

            // Inicializar sessão
            await this.initializeSession(channelId, true);

            // Aguardar QR Code com timeout
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
                qrCode: this.channels.get(channelId).qrCode
            };
        } catch (error) {
            logger.error(`Erro ao criar canal ${channelId}:`, error.message);
            this.qrPromises.delete(channelId);
            throw error;
        }
    }

    /**
     * Inicializar sessão WhatsApp usando a documentação oficial do Baileys
     */
    async initializeSession(channelId, forceNew = false) {
        try {
            // Evitar múltiplas inicializações simultâneas
            if (this.connectingChannels.has(channelId)) {
                logger.info(`Canal ${channelId} já está sendo inicializado`);
                return;
            }
            this.connectingChannels.add(channelId);

            // Fechar sessão existente
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

            // Limpar auth se forceNew
            if (forceNew && fs.existsSync(authPath)) {
                logger.info(`Limpando autenticação do canal ${channelId}`);
                fs.rmSync(authPath, { recursive: true, force: true });
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Usar useMultiFileAuthState conforme documentação
            const { state, saveCreds } = await useMultiFileAuthState(authPath);

            const hasValidAuth = state.creds?.me?.id;
            logger.info(`Inicializando ${channelId} - Auth existente: ${hasValidAuth ? 'Sim' : 'Não'}`);

            // Obter versão mais recente do WhatsApp Web
            const { version } = await fetchLatestBaileysVersion();
            logger.info(`Usando WhatsApp Web versão: ${version.join('.')}`);

            // Criar socket conforme documentação oficial
            const socket = makeWASocket({
                version,
                logger: baileysLogger,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
                },
                browser: Browsers.ubuntu('MGA WhatsApp API'),
                printQRInTerminal: false,
                // Configurações recomendadas pela documentação
                markOnlineOnConnect: false, // Receber notificações no app
                syncFullHistory: false,
                defaultQueryTimeoutMs: 60_000,
                keepAliveIntervalMs: 25_000,
                connectTimeoutMs: 60_000,
                qrTimeout: 40_000,
                generateHighQualityLinkPreview: false
            });

            // Processar eventos conforme documentação
            socket.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(channelId, update);
            });

            socket.ev.on('creds.update', saveCreds);

            // Processar mensagens recebidas
            socket.ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    if (!msg.key.fromMe) {
                        logger.debug(`[${channelId}] Mensagem recebida de ${msg.key.remoteJid}`);
                    }
                }
            });

            // Salvar sessão
            this.sessions.set(channelId, { socket, saveCreds });
            logger.info(`Sessão inicializada para canal ${channelId}`);

        } catch (error) {
            logger.error(`Erro ao inicializar sessão ${channelId}:`, error.message);
            throw error;
        } finally {
            this.connectingChannels.delete(channelId);
        }
    }

    /**
     * Tratar atualizações de conexão
     */
    async handleConnectionUpdate(channelId, update) {
        const { connection, lastDisconnect, qr } = update;

        // QR Code recebido
        if (qr) {
            logger.info(`QR Code gerado para canal ${channelId}`);
            await this.handleQRCode(channelId, qr);
        }

        // Conexão fechada
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.info(`[${channelId}] Conexão fechada. Status: ${statusCode}, Reconectar: ${shouldReconnect}`);

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
                    setTimeout(() => {
                        this.sessions.delete(channelId);
                        this.initializeSession(channelId);
                    }, delay);
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

        // Conexão aberta
        if (connection === 'open') {
            logger.info(`✅ Canal ${channelId} conectado com sucesso!`);
            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'CONNECTED',
                qrCode: null,
                lastSeen: new Date(),
                reconnectAttempts: 0
            });
        }

        // Conectando
        if (connection === 'connecting') {
            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'CONNECTING',
                lastSeen: new Date()
            });
        }
    }

    /**
     * Processar QR Code
     */
    async handleQRCode(channelId, qr) {
        try {
            const qrCodeDataURL = await QRCode.toDataURL(qr);
            this.channels.set(channelId, {
                ...this.channels.get(channelId),
                status: 'QRCODE',
                qrCode: qrCodeDataURL,
                lastSeen: new Date()
            });
            logger.info(`✅ QR Code pronto para canal ${channelId}`);

            // Resolver promise de QR
            const qrPromise = this.qrPromises.get(channelId);
            if (qrPromise) {
                qrPromise.resolve();
            }
        } catch (error) {
            logger.error(`Erro ao processar QR Code ${channelId}:`, error);
            const qrPromise = this.qrPromises.get(channelId);
            if (qrPromise) {
                qrPromise.reject(error);
            }
        }
    }

    /**
     * Obter status de um canal
     */
    getChannelStatus(channelId) {
        if (!this.channels.has(channelId)) {
            return null;
        }
        return {
            channelId,
            ...this.channels.get(channelId)
        };
    }

    /**
     * Obter socket de um canal
     */
    getSocket(channelId) {
        return this.sessions.get(channelId)?.socket || null;
    }

    /**
     * Verificar se canal está conectado
     */
    isChannelConnected(channelId) {
        const channel = this.channels.get(channelId);
        return channel?.status === 'CONNECTED';
    }

    /**
     * Listar todos os canais
     */
    getAllChannels() {
        const channels = [];
        for (const [channelId, data] of this.channels.entries()) {
            channels.push({ channelId, ...data });
        }
        return channels;
    }

    /**
     * Fechar/desconectar canal
     */
    async closeChannel(channelId) {
        try {
            const session = this.sessions.get(channelId);
            if (session?.socket) {
                await session.socket.logout();
            }
            this.sessions.delete(channelId);
            this.channels.delete(channelId);
            logger.info(`Canal ${channelId} fechado`);
        } catch (error) {
            logger.error(`Erro ao fechar canal ${channelId}:`, error);
        }
    }

    /**
     * Regenerar QR Code de um canal
     */
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
                qrCode: this.channels.get(channelId)?.qrCode
            };
        } catch (error) {
            logger.error(`Erro ao regenerar QR Code ${channelId}:`, error);
            throw error;
        }
    }

    /**
     * Testar conexão de um canal
     */
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

    /**
     * Restaurar sessão existente (usado ao reiniciar o servidor)
     * NÃO força novo QR Code, usa credenciais existentes
     */
    async restoreSession(channelId) {
        try {
            // Verificar se já está conectado
            if (this.channels.has(channelId) && this.isChannelConnected(channelId)) {
                logger.info(`Canal ${channelId} já está conectado`);
                return;
            }

            // Criar diretório se não existir
            const channelPath = path.join('src', 'channels', channelId);
            if (!fs.existsSync(channelPath)) {
                throw new Error('Canal não encontrado');
            }

            // Registrar canal como "restaurando"
            this.channels.set(channelId, {
                status: 'RESTORING',
                qrCode: null,
                lastSeen: new Date()
            });

            // Inicializar sessão SEM forçar novo QR (forceNew = false)
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
