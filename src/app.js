import express from 'express';
import channelsRoutes from './routes/channels.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import { logger } from './utils/logger.js';

const app = express();

// API Key para autenticação (definir via variável de ambiente ou usar padrão)
const API_KEY = process.env.API_KEY || 'q3UydSOJTNCQXxF6MtyjGFRr';

// Middleware para parsing JSON
app.use(express.json({ limit: '50mb' }));

// Middleware de autenticação por API Key
app.use((req, res, next) => {
    // Rotas públicas (não precisam de autenticação)
    const publicRoutes = ['/', '/health'];
    if (publicRoutes.includes(req.path)) {
        return next();
    }

    // Verificar API Key no header
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

// Middleware de logging de requests
app.use((req, res, next) => {
    const start = Date.now();

    // Override do método end para capturar o status code e tempo de resposta
    const originalEnd = res.end;
    res.end = function(...args) {
        const responseTime = Date.now() - start;
        const channelId = req.body?.channelId || req.params?.channelId || null;

        logger.httpLog(req.method, req.originalUrl, res.statusCode, responseTime, channelId);

        originalEnd.apply(this, args);
    };

    next();
});

// Rotas
app.use('/channels', channelsRoutes);
app.use('/messages', messagesRoutes);

// Rota raiz - informações da API
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

// Rota de health check
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

// Middleware para rotas não encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'ROUTE_NOT_FOUND',
        message: `Rota ${req.method} ${req.originalUrl} não encontrada`
    });
});

// Middleware de tratamento de erros global (deve ser o ÚLTIMO)
app.use((err, req, res, next) => {
    // Se já foi enviada uma resposta, delegar para o handler padrão do Express
    if (res.headersSent) {
        return next(err);
    }

    // Tratar especificamente erros de JSON inválido
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            error: 'INVALID_JSON',
            message: 'JSON malformado na requisição'
        });
    }

    // Tratar outros erros de sintaxe
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