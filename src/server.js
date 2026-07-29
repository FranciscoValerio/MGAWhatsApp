import app from './app.js';
import { logger } from './utils/logger.js';
import sessionManager from './sessions/manager.js';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // 0.0.0.0 para funcionar em cloud (Render, Railway, etc)

function createRequiredDirectories() {
    const directories = [
        path.join('src', 'channels'),
        path.join('logs')
    ];

    directories.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`Diretório criado: ${dir}`);
        }
    });
}

async function restoreExistingSessions() {
    const channelsDir = path.join('src', 'channels');

    if (!fs.existsSync(channelsDir)) {
        return;
    }

    const channels = fs.readdirSync(channelsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    if (channels.length === 0) {
        logger.info('Nenhuma sessão anterior encontrada para restaurar');
        return;
    }

    logger.info(`🔄 Encontradas ${channels.length} sessão(ões) para restaurar...`);

    for (const channelId of channels) {
        const authPath = path.join(channelsDir, channelId, 'auth_info');

        if (fs.existsSync(authPath) && fs.readdirSync(authPath).length > 0) {
            try {
                logger.info(`🔄 Restaurando sessão: ${channelId}`);
                await sessionManager.restoreSession(channelId);
                logger.info(`✅ Sessão ${channelId} restaurada`);
            } catch (error) {
                logger.error(`❌ Erro ao restaurar sessão ${channelId}:`, error.message);
            }
        }
    }
}

function setupGracefulShutdown(server) {
    const shutdown = (signal) => {
        logger.info(`Recebido sinal ${signal}, iniciando shutdown graceful...`);

        server.close(() => {
            logger.info('Servidor HTTP fechado');

            // Aqui você pode adicionar limpeza adicional se necessário
            // Por exemplo, fechar conexões de banco de dados, fechar sessões do WhatsApp, etc.

            logger.info('Shutdown completo');
            process.exit(0);
        });

        setTimeout(() => {
            logger.error('Forçando fechamento do servidor após timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('uncaughtException', (error) => {
    logger.error('Exceção não capturada:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promise rejeitada não tratada:', {
        reason: reason?.message || reason,
        stack: reason?.stack,
        promise: promise?.constructor?.name || 'Promise'
    });
    logger.warn('Servidor continuará executando, mas verifique o erro acima');
});

process.on('uncaughtException', (error) => {
    logger.error('Exceção não capturada:', {
        message: error.message,
        stack: error.stack
    });
    logger.error('Encerrando processo devido a exceção não capturada');
    process.exit(1);
});

async function startServer() {
    try {
        createRequiredDirectories();

        await restoreExistingSessions();

        const server = app.listen(PORT, HOST, () => {
            logger.info(`🚀 Servidor MGA WhatsApp API iniciado`);
            logger.info(`📡 Servidor rodando em http://${HOST}:${PORT}`);
            logger.info(`📁 Diretório de canais: src/channels/`);
            logger.info(`📋 Logs salvos em: logs/`);
            logger.info(`🕒 Inicializado em: ${new Date().toISOString()}`);
            logger.info('---');
            logger.info('📚 Endpoints disponíveis:');
            logger.info('  GET  /                        - Informações da API');
            logger.info('  GET  /health                  - Health check');
            logger.info('  POST /channels                - Criar canal');
            logger.info('  GET  /channels                - Listar canais');
            logger.info('  GET  /channels/:id/status     - Status do canal');
            logger.info('  POST /messages/text           - Enviar mensagem');
            logger.info('  POST /messages/document       - Enviar documento');
            logger.info('---');
            logger.info('✅ API pronta para receber requisições!');
        });

        setupGracefulShutdown(server);

        server.timeout = 300000; // 5 minutos
        server.keepAliveTimeout = 65000; // 65 segundos
        server.headersTimeout = 66000; // 66 segundos

        return server;
    } catch (error) {
        logger.error('Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion < 18) {
    logger.error(`Node.js ${nodeVersion} não é suportado. Versão mínima: 18.0.0`);
    process.exit(1);
}

startServer();