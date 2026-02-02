# MGA WhatsApp API

API REST para WhatsApp usando [Baileys](https://github.com/WhiskeySockets/Baileys) - Multicanais.

## Características

- ✅ Conexão via QR Code
- ✅ Suporte a múltiplos canais (contas)
- ✅ Envio de mensagens de texto
- ✅ Envio de documentos e arquivos
- ✅ Envio de imagens
- ✅ Verificação de números no WhatsApp
- ✅ Reconexão automática

## Requisitos

- Node.js 18+
- npm ou yarn

## Instalação

```bash
npm install
```

## Executar

```bash
# Produção
npm start

# Desenvolvimento (com auto-reload)
npm run dev
```

O servidor iniciará em `http://localhost:3000`

---

## Endpoints da API

### Canais

#### Criar Canal
```http
POST /channels
Content-Type: application/json

{
  "channelId": "minha-empresa"
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "channelId": "minha-empresa",
    "status": "QRCODE",
    "qrCode": "data:image/png;base64,..."
  }
}
```

#### Listar Canais
```http
GET /channels
```

#### Status do Canal
```http
GET /channels/:channelId/status
```

#### Regenerar QR Code
```http
POST /channels/:channelId/qrcode
```

#### Health Check do Canal
```http
GET /channels/:channelId/health
```

#### Desconectar Canal
```http
DELETE /channels/:channelId
```

---

### Mensagens

#### Enviar Texto
```http
POST /messages/text
Content-Type: application/json

{
  "channelId": "minha-empresa",
  "to": "5511999999999",
  "message": "Olá, tudo bem?"
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "messageId": "ABC123...",
    "to": "5511999999999@s.whatsapp.net",
    "message": "Olá, tudo bem?"
  }
}
```

#### Enviar Documento/Arquivo
```http
POST /messages/document
Content-Type: application/json

{
  "channelId": "minha-empresa",
  "to": "5511999999999",
  "fileUrl": "https://exemplo.com/arquivo.pdf",
  "fileName": "documento.pdf",
  "caption": "Segue o documento solicitado"
}
```

#### Enviar Imagem
```http
POST /messages/image
Content-Type: application/json

{
  "channelId": "minha-empresa",
  "to": "5511999999999",
  "imageUrl": "https://exemplo.com/imagem.jpg",
  "caption": "Confira esta imagem"
}
```

#### Verificar Número
```http
POST /messages/check-number
Content-Type: application/json

{
  "channelId": "minha-empresa",
  "number": "5511999999999"
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "exists": true,
    "jid": "5511999999999@s.whatsapp.net"
  }
}
```

#### Tipos de Arquivos Suportados
```http
GET /messages/supported-types
```

---

### Outros

#### Informações da API
```http
GET /
```

#### Health Check Geral
```http
GET /health
```

---

## Status dos Canais

| Status | Descrição |
|--------|-----------|
| `CREATED` | Canal criado, aguardando inicialização |
| `CONNECTING` | Conectando ao WhatsApp |
| `QRCODE` | QR Code gerado, aguardando escaneamento |
| `CONNECTED` | Conectado e pronto para uso |
| `RECONNECTING` | Reconectando após desconexão |
| `LOGGED_OUT` | Deslogado (requer novo QR Code) |
| `FAILED` | Falha após múltiplas tentativas |

---

## Formato de Números

O número do WhatsApp deve conter:
- **Código do país** (55 para Brasil)
- **DDD**
- **Número**

Exemplos válidos:
- `5511999999999`
- `11999999999` (código do país será adicionado automaticamente)

---

## Tipos de Arquivos Suportados

| Categoria | Extensões |
|-----------|-----------|
| Imagens | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` |
| Vídeos | `.mp4`, `.avi`, `.mov` |
| Áudio | `.mp3`, `.ogg`, `.wav`, `.m4a` |
| Documentos | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.txt`, `.xml`, `.zip` |

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `localhost` | Host do servidor |
| `NODE_ENV` | `development` | Ambiente de execução |

---

## Estrutura do Projeto

```
src/
├── app.js              # Configuração do Express
├── server.js           # Inicialização do servidor
├── channels/           # Dados de autenticação dos canais
├── routes/
│   ├── channels.routes.js
│   └── messages.routes.js
├── services/
│   └── whatsapp.service.js
├── sessions/
│   └── manager.js      # Gerenciador de sessões Baileys
└── utils/
    └── logger.js       # Sistema de logs
```

---

## Exemplo de Uso com cURL

```bash
# 1. Criar canal
curl -X POST http://localhost:3000/channels \
  -H "Content-Type: application/json" \
  -d '{"channelId": "teste"}'

# 2. Verificar status (obter QR Code)
curl http://localhost:3000/channels/teste/status

# 3. Após escanear QR, enviar mensagem
curl -X POST http://localhost:3000/messages/text \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "teste",
    "to": "5511999999999",
    "message": "Olá do MGA WhatsApp API!"
  }'
```

---

## Licença

MIT
