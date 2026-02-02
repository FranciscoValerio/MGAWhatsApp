import express from 'express';
import whatsappService from '../services/whatsapp.service.js';
import sessionManager from '../sessions/manager.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /messages/text
 * Enviar mensagem de texto
 */
router.post('/text', async (req, res) => {
    try {
        const { channelId, to, message } = req.body;

        // Validações
        if (!channelId || !to || !message) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId, to e message são obrigatórios'
            });
        }

        if (!whatsappService.isValidWhatsAppNumber(to)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_NUMBER',
                message: 'Número de WhatsApp inválido'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.sendTextMessage(channelId, to, message);
        logger.info(`Mensagem enviada - Canal: ${channelId}, Para: ${to}`);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao enviar mensagem:', error);

        if (error.message === 'CHANNEL_NOT_CONNECTED') {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: 'Canal não está conectado'
            });
        }

        if (error.message === 'INVALID_WHATSAPP_NUMBER') {
            return res.status(400).json({
                success: false,
                error: 'INVALID_WHATSAPP_NUMBER',
                message: 'Número não existe no WhatsApp'
            });
        }

        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /messages/document
 * Enviar documento/arquivo
 */
router.post('/document', async (req, res) => {
    try {
        const { channelId, to, fileUrl, fileName, caption = '' } = req.body;

        // Validações
        if (!channelId || !to || !fileUrl || !fileName) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId, to, fileUrl e fileName são obrigatórios'
            });
        }

        if (!whatsappService.isValidWhatsAppNumber(to)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_NUMBER',
                message: 'Número de WhatsApp inválido'
            });
        }

        if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_URL',
                message: 'URL deve começar com http:// ou https://'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.sendDocument(channelId, to, fileUrl, fileName, caption);
        logger.info(`Documento enviado - Canal: ${channelId}, Para: ${to}, Arquivo: ${fileName}`);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao enviar documento:', error);

        if (error.message === 'CHANNEL_NOT_CONNECTED') {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: 'Canal não está conectado'
            });
        }

        if (error.message === 'DOWNLOAD_FAILED') {
            return res.status(400).json({
                success: false,
                error: 'DOWNLOAD_FAILED',
                message: 'Não foi possível baixar o arquivo'
            });
        }

        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /messages/image
 * Enviar imagem via URL
 */
router.post('/image', async (req, res) => {
    try {
        const { channelId, to, imageUrl, caption = '' } = req.body;

        if (!channelId || !to || !imageUrl) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId, to e imageUrl são obrigatórios'
            });
        }

        if (!whatsappService.isValidWhatsAppNumber(to)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_NUMBER',
                message: 'Número de WhatsApp inválido'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.sendImage(channelId, to, imageUrl, caption);
        logger.info(`Imagem enviada - Canal: ${channelId}, Para: ${to}`);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao enviar imagem:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /messages/image-base64
 * Enviar imagem via Base64
 */
router.post('/image-base64', async (req, res) => {
    try {
        const { channelId, to, base64, caption = '' } = req.body;

        if (!channelId || !to || !base64) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId, to e base64 são obrigatórios'
            });
        }

        if (!whatsappService.isValidWhatsAppNumber(to)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_NUMBER',
                message: 'Número de WhatsApp inválido'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.sendImageBase64(channelId, to, base64, caption);
        logger.info(`Imagem (base64) enviada - Canal: ${channelId}, Para: ${to}`);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao enviar imagem base64:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /messages/document-base64
 * Enviar documento/arquivo via Base64
 */
router.post('/document-base64', async (req, res) => {
    try {
        const { channelId, to, base64, fileName, mimetype, caption = '' } = req.body;

        if (!channelId || !to || !base64 || !fileName) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId, to, base64 e fileName são obrigatórios'
            });
        }

        if (!whatsappService.isValidWhatsAppNumber(to)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_NUMBER',
                message: 'Número de WhatsApp inválido'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.sendDocumentBase64(channelId, to, base64, fileName, mimetype, caption);
        logger.info(`Documento (base64) enviado - Canal: ${channelId}, Para: ${to}, Arquivo: ${fileName}`);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao enviar documento base64:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /messages/check-number
 * Verificar se número existe no WhatsApp
 */
router.post('/check-number', async (req, res) => {
    try {
        const { channelId, number } = req.body;

        if (!channelId || !number) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'channelId e number são obrigatórios'
            });
        }

        const channelStatus = sessionManager.getChannelStatus(channelId);
        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (!sessionManager.isChannelConnected(channelId)) {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_NOT_CONNECTED',
                message: `Canal não está conectado. Status: ${channelStatus.status}`
            });
        }

        const result = await whatsappService.checkNumber(channelId, number);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Erro ao verificar número:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /messages/supported-types
 * Listar tipos de arquivos suportados
 */
router.get('/supported-types', (req, res) => {
    res.json({
        success: true,
        data: {
            images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
            videos: ['.mp4', '.avi', '.mov'],
            audio: ['.mp3', '.ogg', '.wav', '.m4a'],
            documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.xml', '.zip']
        }
    });
});

/**
 * GET /messages/health
 * Health check do serviço de mensagens
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'healthy',
            timestamp: new Date().toISOString()
        }
    });
});

export default router;
