import fs from 'fs';
import path from 'path';

class Logger {
    constructor() {
        this.logDir = path.join('logs');

        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getCurrentTimestamp() {
        return new Date().toISOString();
    }

    formatMessage(level, message, data = null) {
        const timestamp = this.getCurrentTimestamp();
        let formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

        if (data) {
            if (typeof data === 'object') {
                formattedMessage += `\\n${JSON.stringify(data, null, 2)}`;
            } else {
                formattedMessage += ` ${data}`;
            }
        }

        return formattedMessage;
    }

    writeToFile(level, formattedMessage) {
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const logFile = path.join(this.logDir, `${today}.log`);

            fs.appendFileSync(logFile, formattedMessage + '\\n');
        } catch (error) {
            console.error('Erro ao escrever no arquivo de log:', error);
        }
    }

    log(level, message, data = null) {
        const formattedMessage = this.formatMessage(level, message, data);

        if (level === 'error') {
            console.error(formattedMessage);
        } else if (level === 'warn') {
            console.warn(formattedMessage);
        } else {
            console.log(formattedMessage);
        }

        this.writeToFile(level, formattedMessage);
    }

    info(message, data = null) {
        this.log('info', message, data);
    }

    warn(message, data = null) {
        this.log('warn', message, data);
    }

    error(message, data = null) {
        this.log('error', message, data);
    }

    debug(message, data = null) {
        if (process.env.NODE_ENV !== 'production') {
            this.log('debug', message, data);
        }
    }

    channelLog(channelId, level, message, data = null) {
        const channelMessage = `[CANAL:${channelId}] ${message}`;
        this.log(level, channelMessage, data);
    }

    httpLog(method, url, statusCode, responseTime, channelId = null) {
        const message = channelId
            ? `[CANAL:${channelId}] ${method} ${url} - ${statusCode} (${responseTime}ms)`
            : `${method} ${url} - ${statusCode} (${responseTime}ms)`;

        if (statusCode >= 400) {
            this.error(message);
        } else {
            this.info(message);
        }
    }

    cleanOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            files.forEach(file => {
                if (file.endsWith('.log')) {
                    const fileDate = file.replace('.log', '');
                    const logDate = new Date(fileDate);

                    if (logDate < thirtyDaysAgo) {
                        const filePath = path.join(this.logDir, file);
                        fs.unlinkSync(filePath);
                        this.info(`Log antigo removido: ${file}`);
                    }
                }
            });
        } catch (error) {
            this.error('Erro ao limpar logs antigos:', error);
        }
    }

    getTodayLogs() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const logFile = path.join(this.logDir, `${today}.log`);

            if (fs.existsSync(logFile)) {
                return fs.readFileSync(logFile, 'utf8').split('\\n').filter(line => line.trim());
            }

            return [];
        } catch (error) {
            this.error('Erro ao ler logs do dia:', error);
            return [];
        }
    }

    getChannelLogs(channelId, maxLines = 100) {
        try {
            const todayLogs = this.getTodayLogs();
            const channelLogs = todayLogs
                .filter(log => log.includes(`[CANAL:${channelId}]`))
                .slice(-maxLines);

            return channelLogs;
        } catch (error) {
            this.error(`Erro ao obter logs do canal ${channelId}:`, error);
            return [];
        }
    }
}

export const logger = new Logger();

logger.cleanOldLogs();