# Discord Anti-Scam Images Bot

A high-performance Discord bot that uses state-of-the-art vision models and OCR (Optical Character Recognition) to detect, block, and log scam messages containing images with banned text.

## 🚀 Key Features
-   **Advanced AI Vision**: Integrates **Groq (Llama 4 Vision)** for lightning-fast, highly accurate text extraction from images.
-   **Multi-Bot Support**: Run multiple bot instances from a single process using a clean JSON-based configuration.
-   **Multi-Engine OCR Stack**: Uses a chain-of-responsibility pattern for reliable detection:
    *   **Groq (Llama 4)**: Primary high-speed AI vision engine.
    *   **Tesseract.js**: Fast local OCR fallback.
    *   **OCR.space**: Cloud OCR fallback with automatic image compression.
    *   **Google Gemini 2.5 Flash-Lite**: Ultimate complex pattern recognition.
-   **Batch Scanning Optimization**: AI engines (Groq/Gemini) process all message attachments in a single request, significantly reducing latency and API usage.
-   **Per-Bot Filtering**: Configure unique whitelists or blacklists for each bot instance.

## 🛠 Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## ⚙️ Configuration

Create a `.env` file in the root directory.

### 🤖 Bot Management (`BOTS`)
The bot uses a JSON array in the `.env` file for managing one or more bots. You must wrap the entire JSON in single quotes (`'`).

| Property | Description | Required |
| :--- | :--- | :--- |
| `token` | Discord Bot Token | Yes |
| `enabled` | Enable or disable this specific bot instance | No (Default: true) |
| `logChannel` | Channel ID for logging scam detections | No |
| `isWhitelist` | If `true`, only `allowedChannels` are scanned. If `false`, all channels except `disallowedChannels` are scanned. | No (Default: false) |
| `allowedChannels` | Array of Channel IDs to scan (Active only when `isWhitelist` is `true`) | No |
| `disallowedChannels`| Array of Channel IDs to skip (Active only when `isWhitelist` is `false`) | No |

**Example:**
```env
BOTS='[
  {
    "token": "BOT_TOKEN_1",
    "name": "Main Guard",
    "enabled": true,
    "logChannel": "123456789",
    "isWhitelist": true,
    "allowedChannels": ["111222333", "444555666"]
  },
  {
    "token": "BOT_TOKEN_2",
    "enabled": false
  }
]'
```

### 🌍 Global Settings
| Variable | Description | Default |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | Your Groq Cloud API Key | Recommended |
| `GROQ_MODEL` | The vision model to use (e.g., `meta-llama/llama-4-scout-17b-16e-instruct`) | `llama-4-scout` |
| `BANNED_WORDS` | Comma-separated words to trigger moderation | - |
| `MAX_ATTACHMENTS` | Skip messages with more than this many images | `8` |
| `SHOULD_DELETE` | Delete messages containing banned words | `true` |
| `SHOULD_PUNISH` | Timeout users for sending scam images | `true` |
| `TIMEOUT_DURATION` | Duration of timeout (e.g., `7d`, `24h`) | `7d` |
| `OCR_ENGINE_ORDER` | Priority of engines (e.g., `groq,tesseract,ocrspace`) | `groq,tesseract...` |
| `MASS_ANALYZER_DELAY` | Time (ms) to wait for batching messages | `3000` |
| `DEBUG` | Enable detailed logs for analysis | `false` |

## 🚀 Deployment

To run in development mode (with hot-reload):
```bash
npm run dev
```

To run in production:
```bash
npm start
```

Based on the initial concept from [Saeraphinx/anti-scam-ocr](https://github.com/Saeraphinx/anti-scam-ocr). Significantly refactored and enhanced with modern OCR engines, Groq Vision, and a multi-bot modular architecture.

