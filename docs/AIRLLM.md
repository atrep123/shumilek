# AirLLM Backend pro Shumilek

## 🚀 Co je AirLLM?

AirLLM umožňuje spouštět **70B modely na 4GB GPU** a **405B modely na 8GB VRAM** bez kvantizace, distilace nebo pruningu.

## 📦 Instalace

```bash
# Základní instalace
pip install airllm flask

# Pro 4-bit/8-bit kompresi (3x rychlejší)
pip install bitsandbytes
```

## 🏃 Spuštění serveru

### Základní použití (70B model)

```bash
cd scripts
python airllm_server.py --model "Qwen/Qwen2.5-72B-Instruct"
```

### S 4-bit kompresí (rychlejší, ~stejná kvalita)

```bash
python airllm_server.py \
  --model "Qwen/Qwen2.5-72B-Instruct" \
  --compression 4bit
```

### Llama 3.1 405B (potřeba 8GB VRAM)

```bash
python airllm_server.py \
  --model "meta-llama/Meta-Llama-3.1-405B" \
  --compression 4bit \
  --preload
```

### Všechny parametry

| Parametr | Popis | Default |
|----------|-------|---------|
| `--model, -m` | HuggingFace model ID | `Qwen/Qwen2.5-72B-Instruct` |
| `--compression, -c` | `4bit`, `8bit`, `none` | `none` |
| `--port, -p` | Port serveru | `11435` |
| `--host` | Host | `127.0.0.1` |
| `--max-length` | Max kontext | `2048` |
| `--preload` | Načíst model ihned | `false` |
| `--delete-original` | Smazat HF cache | `false` |

## ⚙️ Konfigurace Shumilek

V VS Code nastavení (`Ctrl+,`):

```json
{
  "shumilek.baseUrl": "http://localhost:11435",
  "shumilek.model": "Qwen2.5-72B-Instruct"
}
```

Nebo v `settings.json`:

```json
{
  "shumilek.backendType": "airllm",
  "shumilek.airllm.serverUrl": "http://localhost:11435"
}
```

## 📊 Podporované modely

| Model | VRAM potřeba | Komprese |
|-------|--------------|----------|
| Llama 2 70B | 4GB | volitelná |
| Llama 3 70B | 4GB | volitelná |
| Llama 3.1 405B | 8GB | doporučena 4bit |
| Qwen 2.5 72B | 4GB | volitelná |
| Mixtral 8x22B | 4GB | volitelná |
| DeepSeek 67B | 4GB | volitelná |

## 🔧 API Endpointy

Server je **kompatibilní s Ollama API**, takže Shumilek funguje bez úprav:

- `GET /api/tags` - Seznam modelů
- `POST /api/generate` - Generování textu
- `POST /api/chat` - Chat API
- `POST /api/show` - Info o modelu
- `GET /health` - Health check

## ⚠️ Poznámky

1. **První spuštění** trvá déle - model se transformuje na vrstvy
2. **Disk space** - potřeba ~2x velikost modelu pro transformaci
3. **Inference je pomalejší** než Ollama s kvantizovanými modely
4. **Vhodné pro** kvalitní odpovědi, ne rychlé iterace

## 🐛 Troubleshooting

### MetadataIncompleteBuffer error
```
Došel disk. Uvolni místo a smaž HuggingFace cache:
rm -rf ~/.cache/huggingface
```

### CUDA out of memory
```
Zkus 4-bit kompresi:
python airllm_server.py --compression 4bit
```

### Model nenalezen
```
Pro gated modely (Llama) potřebuješ HF token:
export HF_TOKEN=your_token_here
```

## Cache and precision (optional)

Example settings:

```json
{
  "shumilek.airllm.cacheDir": "C:\\AI\\hf",
  "shumilek.airllm.dtype": "bf16"
}
```
