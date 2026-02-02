import express from 'express';
import sessionManager from '../sessions/manager.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /channels
 * Criar novo canal WhatsApp
 */
router.post('/', async (req, res) => {
    try {
        const { channelId } = req.body;

        if (!channelId) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CHANNEL_ID',
                message: 'channelId é obrigatório'
            });
        }

        const existingChannel = sessionManager.getChannelStatus(channelId);
        if (existingChannel) {
            return res.status(409).json({
                success: false,
                error: 'CHANNEL_ALREADY_EXISTS',
                message: 'Canal já existe',
                data: existingChannel
            });
        }

        const channelData = await sessionManager.createChannel(channelId);
        logger.info(`Canal criado via API: ${channelId}`);

        res.status(201).json({
            success: true,
            data: channelData
        });
    } catch (error) {
        logger.error('Erro ao criar canal:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /channels
 * Listar todos os canais
 */
router.get('/', async (req, res) => {
    try {
        const channels = sessionManager.getAllChannels();
        res.json({
            success: true,
            data: {
                channels,
                total: channels.length
            }
        });
    } catch (error) {
        logger.error('Erro ao listar canais:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /channels/:channelId/status
 * Obter status de um canal
 */
router.get('/:channelId/status', async (req, res) => {
    try {
        const { channelId } = req.params;
        const channelStatus = sessionManager.getChannelStatus(channelId);

        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        res.json({
            success: true,
            data: channelStatus
        });
    } catch (error) {
        logger.error(`Erro ao consultar status do canal:`, error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /channels/:channelId/qrcode
 * Regenerar QR Code
 */
router.post('/:channelId/qrcode', async (req, res) => {
    try {
        const { channelId } = req.params;
        const channelStatus = sessionManager.getChannelStatus(channelId);

        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        if (channelStatus.status === 'CONNECTED') {
            return res.status(400).json({
                success: false,
                error: 'CHANNEL_ALREADY_CONNECTED',
                message: 'Canal já está conectado'
            });
        }

        const newChannelData = await sessionManager.regenerateQRCode(channelId);
        logger.info(`QR Code regenerado para canal: ${channelId}`);

        res.json({
            success: true,
            data: newChannelData
        });
    } catch (error) {
        logger.error(`Erro ao regenerar QR Code:`, error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /channels/:channelId/health
 * Verificar saúde da conexão
 */
router.get('/:channelId/health', async (req, res) => {
    try {
        const { channelId } = req.params;
        const channelStatus = sessionManager.getChannelStatus(channelId);

        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        const healthCheck = await sessionManager.testConnection(channelId);

        res.json({
            success: true,
            data: {
                channelId,
                status: channelStatus.status,
                healthy: healthCheck.healthy,
                reason: healthCheck.reason
            }
        });
    } catch (error) {
        logger.error(`Erro no health check:`, error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * DELETE /channels/:channelId
 * Desconectar/remover canal
 */
router.delete('/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const channelStatus = sessionManager.getChannelStatus(channelId);

        if (!channelStatus) {
            return res.status(404).json({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: 'Canal não encontrado'
            });
        }

        await sessionManager.closeChannel(channelId);
        logger.info(`Canal desconectado via API: ${channelId}`);

        res.json({
            success: true,
            message: `Canal ${channelId} desconectado com sucesso`
        });
    } catch (error) {
        logger.error(`Erro ao desconectar canal:`, error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

export default router;
