import sessionManager from '../sessions/manager.js';
import axios from 'axios';
import path from 'path';
import { logger } from '../utils/logger.js';

class WhatsAppService {
    constructor() {
        this.lastMessageTime = new Map();
        this.MIN_DELAY_MS = 1000; // Delay mínimo entre mensagens
    }

    async sendTextMessage(channelId, to, message) {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            if (!socket.user) {
                logger.error(`Socket sem usuário autenticado para canal ${channelId}`);
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            logger.info(`[${channelId}] Usuário conectado: ${socket.user.id}`);

            await this.applyMessageDelay(channelId);

            const formattedNumber = this.formatWhatsAppNumber(to);
            logger.info(`[${channelId}] Número formatado: ${to} -> ${formattedNumber}`);

            try {
                const [exists] = await socket.onWhatsApp(formattedNumber);
                logger.info(`[${channelId}] Verificação onWhatsApp:`, exists);

                if (!exists?.exists) {
                    throw new Error('INVALID_WHATSAPP_NUMBER');
                }

                const jid = exists.jid;
                logger.info(`[${channelId}] JID confirmado: ${jid}`);

                logger.info(`[${channelId}] Enviando mensagem para ${jid}...`);
                const result = await socket.sendMessage(jid, { text: message });

                logger.info(`[${channelId}] Resultado do envio:`, {
                    messageId: result?.key?.id,
                    remoteJid: result?.key?.remoteJid,
                    status: result?.status
                });

                this.lastMessageTime.set(channelId, Date.now());
                logger.info(`Mensagem enviada para ${to} via canal ${channelId}`);

                return {
                    success: true,
                    messageId: result.key.id,
                    to: jid,
                    message
                };
            } catch (verifyError) {
                logger.error(`[${channelId}] Erro na verificação/envio:`, verifyError.message);
                throw verifyError;
            }
        } catch (error) {
            logger.error(`Erro ao enviar mensagem (${channelId}):`, error.message);
            logger.error(`Stack:`, error.stack);

            if (error.message.includes('not-authorized') || error.message.includes('Connection Closed')) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            throw error;
        }
    }

    async sendDocument(channelId, to, fileUrl, fileName, caption = '') {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            await this.applyMessageDelay(channelId);

            const fileBuffer = await this.downloadFile(fileUrl);
            const formattedNumber = this.formatWhatsAppNumber(to);

            const fileExtension = path.extname(fileName).toLowerCase();
            const mimeType = this.getMimeType(fileExtension);

            let messageContent;

            if (this.isImageType(fileExtension)) {
                messageContent = {
                    image: fileBuffer,
                    caption: caption
                };
            } else if (this.isVideoType(fileExtension)) {
                messageContent = {
                    video: fileBuffer,
                    caption: caption
                };
            } else if (this.isAudioType(fileExtension)) {
                messageContent = {
                    audio: fileBuffer,
                    mimetype: mimeType
                };
            } else {
                messageContent = {
                    document: fileBuffer,
                    mimetype: mimeType,
                    fileName: fileName,
                    caption: caption
                };
            }

            const result = await socket.sendMessage(formattedNumber, messageContent);

            this.lastMessageTime.set(channelId, Date.now());
            logger.info(`Arquivo ${fileName} enviado para ${to} via canal ${channelId}`);

            return {
                success: true,
                messageId: result.key.id,
                to: formattedNumber,
                fileName,
                caption
            };
        } catch (error) {
            logger.error(`Erro ao enviar documento (${channelId}):`, error.message);

            if (error.message.includes('not-authorized')) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            throw error;
        }
    }

    async sendImage(channelId, to, imageUrl, caption = '') {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            await this.applyMessageDelay(channelId);
            const formattedNumber = this.formatWhatsAppNumber(to);

            const [exists] = await socket.onWhatsApp(formattedNumber);
            if (!exists?.exists) {
                throw new Error('INVALID_WHATSAPP_NUMBER');
            }
            const jid = exists.jid;

            const result = await socket.sendMessage(jid, {
                image: { url: imageUrl },
                caption: caption
            });

            this.lastMessageTime.set(channelId, Date.now());
            logger.info(`Imagem enviada para ${to} via canal ${channelId}`);

            return {
                success: true,
                messageId: result.key.id,
                to: jid,
                imageUrl,
                caption
            };
        } catch (error) {
            logger.error(`Erro ao enviar imagem (${channelId}):`, error.message);
            throw error;
        }
    }

    async sendImageBase64(channelId, to, base64Data, caption = '') {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            await this.applyMessageDelay(channelId);
            const formattedNumber = this.formatWhatsAppNumber(to);

            const [exists] = await socket.onWhatsApp(formattedNumber);
            if (!exists?.exists) {
                throw new Error('INVALID_WHATSAPP_NUMBER');
            }
            const jid = exists.jid;

            const imageBuffer = this.base64ToBuffer(base64Data);

            const result = await socket.sendMessage(jid, {
                image: imageBuffer,
                caption: caption
            });

            this.lastMessageTime.set(channelId, Date.now());
            logger.info(`Imagem (base64) enviada para ${to} via canal ${channelId}`);

            return {
                success: true,
                messageId: result.key.id,
                to: jid,
                caption
            };
        } catch (error) {
            logger.error(`Erro ao enviar imagem base64 (${channelId}):`, error.message);
            throw error;
        }
    }

    async sendDocumentBase64(channelId, to, base64Data, fileName, mimetype, caption = '') {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            await this.applyMessageDelay(channelId);
            const formattedNumber = this.formatWhatsAppNumber(to);

            const [exists] = await socket.onWhatsApp(formattedNumber);
            if (!exists?.exists) {
                throw new Error('INVALID_WHATSAPP_NUMBER');
            }
            const jid = exists.jid;

            const fileBuffer = this.base64ToBuffer(base64Data);

            const fileExtension = path.extname(fileName).toLowerCase();
            const mimeType = mimetype || this.getMimeType(fileExtension);

            let messageContent;

            if (this.isImageType(fileExtension)) {
                messageContent = {
                    image: fileBuffer,
                    caption: caption
                };
            } else if (this.isVideoType(fileExtension)) {
                messageContent = {
                    video: fileBuffer,
                    caption: caption
                };
            } else if (this.isAudioType(fileExtension)) {
                messageContent = {
                    audio: fileBuffer,
                    mimetype: mimeType
                };
            } else {
                messageContent = {
                    document: fileBuffer,
                    mimetype: mimeType,
                    fileName: fileName,
                    caption: caption
                };
            }

            const result = await socket.sendMessage(jid, messageContent);

            this.lastMessageTime.set(channelId, Date.now());
            logger.info(`Documento ${fileName} (base64) enviado para ${to} via canal ${channelId}`);

            return {
                success: true,
                messageId: result.key.id,
                to: jid,
                fileName,
                caption
            };
        } catch (error) {
            logger.error(`Erro ao enviar documento base64 (${channelId}):`, error.message);
            throw error;
        }
    }

    base64ToBuffer(base64String) {
        const base64Data = base64String.replace(/^data:[^;]+;base64,/, '');
        return Buffer.from(base64Data, 'base64');
    }

    async checkNumber(channelId, number) {
        try {
            if (!sessionManager.isChannelConnected(channelId)) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const socket = sessionManager.getSocket(channelId);
            if (!socket) {
                throw new Error('CHANNEL_NOT_CONNECTED');
            }

            const formattedNumber = this.formatWhatsAppNumber(number);
            const [result] = await socket.onWhatsApp(formattedNumber);

            return {
                exists: result?.exists || false,
                jid: result?.jid || formattedNumber
            };
        } catch (error) {
            logger.error(`Erro ao verificar número (${channelId}):`, error.message);
            return { exists: false, jid: null };
        }
    }

    async downloadFile(url) {
        try {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: 30000
            });
            return Buffer.from(response.data);
        } catch (error) {
            logger.error(`Erro ao baixar arquivo ${url}:`, error.message);
            throw new Error('DOWNLOAD_FAILED');
        }
    }

    formatWhatsAppNumber(number) {
        let cleanNumber = number.replace(/\D/g, '');

        if (!cleanNumber.startsWith('55')) {
            cleanNumber = '55' + cleanNumber;
        }

        logger.debug(`Formatando número: ${number} -> ${cleanNumber}@s.whatsapp.net`);

        return cleanNumber + '@s.whatsapp.net';
    }

    getMimeType(extension) {
        const mimeTypes = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.txt': 'text/plain',
            '.xml': 'application/xml',
            '.zip': 'application/zip',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.ogg': 'audio/ogg'
        };
        return mimeTypes[extension] || 'application/octet-stream';
    }

    isImageType(extension) {
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension);
    }

    isVideoType(extension) {
        return ['.mp4', '.avi', '.mov'].includes(extension);
    }

    isAudioType(extension) {
        return ['.mp3', '.ogg', '.wav', '.m4a'].includes(extension);
    }

    async applyMessageDelay(channelId) {
        const lastTime = this.lastMessageTime.get(channelId);
        if (lastTime) {
            const elapsed = Date.now() - lastTime;
            if (elapsed < this.MIN_DELAY_MS) {
                const delay = this.MIN_DELAY_MS - elapsed;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    isValidWhatsAppNumber(number) {
        const cleanNumber = number.replace(/\D/g, '');
        return cleanNumber.length >= 10 && cleanNumber.length <= 15;
    }
}

export default new WhatsAppService();
