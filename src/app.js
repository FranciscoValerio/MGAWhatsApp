import express from 'express';
import channelsRoutes from './routes/channels.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import { logger } from './utils/logger.js';

const app = express();

const API_KEY = process.env.API_KEY || 'q3UydSOJTNCQXxF6MtyjGFRr';

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
    const publicRoutes = ['/', '/health'];
    if (publicRoutes.includes(req.path)) {
        return next();
    }

    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED',
            message: 'API Key não fornecida. Use o header x-api-key ou Authorization: Bearer <key>'
        });
    }

    if (apiKey !== API_KEY) {
        logger.warn(`Tentativa de acesso com API Key inválida: ${apiKey.substring(0, 10)}...`);
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED',
            message: 'API Key inválida'
        });
    }

    next();
});

app.use((req, res, next) => {
    const start = Date.now();

    const originalEnd = res.end;
    res.end = function(...args) {
        const responseTime = Date.now() - start;
        const channelId = req.body?.channelId || req.params?.channelId || null;

        logger.httpLog(req.method, req.originalUrl, res.statusCode, responseTime, channelId);

        originalEnd.apply(this, args);
    };

    next();
});

app.use('/channels', channelsRoutes);
app.use('/messages', messagesRoutes);

app.get('/', (req, res) => {
    res.json({
        success: true,
        data: {
            name: 'MGA WhatsApp API',
            version: '1.0.0',
            description: 'API REST para WhatsApp com Baileys - Multicanais',
            endpoints: {
                channels: {
                    create: 'POST /channels',
                    list: 'GET /channels',
                    status: 'GET /channels/:channelId/status',
                    details: 'GET /channels/:channelId',
                    qrcode: 'POST /channels/:channelId/qrcode',
                    disconnect: 'DELETE /channels/:channelId'
                },
                messages: {
                    text: 'POST /messages/text',
                    document: 'POST /messages/document',
                    checkNumber: 'POST /messages/check-number',
                    supportedTypes: 'GET /messages/supported-types',
                    health: 'GET /messages/health'
                }
            },
            documentation: 'https://github.com/seu-usuario/mga-whatsapp-api#readme',
            timestamp: new Date().toISOString()
        }
    });
});

app.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            nodeVersion: process.version
        }
    });
});

app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'ROUTE_NOT_FOUND',
        message: `Rota ${req.method} ${req.originalUrl} não encontrada`
    });
});

app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            error: 'INVALID_JSON',
            message: 'JSON malformado na requisição'
        });
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_JSON',
            message: 'JSON inválido na requisição'
        });
    }

    logger.error('Erro não tratado:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        body: req.body
    });

    res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor'
    });
});

export default app;