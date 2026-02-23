#!/usr/bin/env python3
"""
AirLLM Server pro Shumilek VS Code extension
Poskytuje REST API kompatibilní s Ollama API formátem

Instalace:
    pip install airllm flask

Spuštění:
    python airllm_server.py --model "Qwen/Qwen2.5-72B-Instruct" --port 11435

Podporuje:
    - 70B modely na 4GB GPU
    - 405B modely na 8GB VRAM (s kompresí)
    - 4-bit a 8-bit kompresi pro rychlejší inference
"""

import argparse
import json
import time
import threading
import traceback
from typing import Optional, Generator
from flask import Flask, request, jsonify, Response

# Lazy import airllm
airllm_model = None
airllm_tokenizer = None
model_lock = threading.Lock()

app = Flask(__name__)

# Konfigurace
config = {
    "model_id": "Qwen/Qwen2.5-72B-Instruct",
    "compression": None,  # None, "4bit", "8bit"
    "max_length": 2048,
    "delete_original": False,
    "dtype": "auto",
    "use_kv_cache": False,
    "loaded": False
}


def resolve_dtype(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in ("auto", "none"):
        return None
    mapping = {
        "bf16": "bfloat16",
        "bfloat16": "bfloat16",
        "fp16": "float16",
        "float16": "float16",
        "fp32": "float32",
        "float32": "float32"
    }
    return mapping.get(normalized)


def load_model():
    """Načte AirLLM model (lazy loading)"""
    global airllm_model, airllm_tokenizer
    
    if config["loaded"]:
        return True
    
    with model_lock:
        if config["loaded"]:
            return True
            
        try:
            from airllm import AutoModel
            
            print(f"[AirLLM] Načítám model: {config['model_id']}")
            print(f"[AirLLM] Komprese: {config['compression'] or 'žádná'}")
            print(f"[AirLLM] DType: {config['dtype']}")
            
            kwargs = {
                "delete_original": config["delete_original"]
            }
            if config["compression"]:
                kwargs["compression"] = config["compression"]
            dtype_name = resolve_dtype(config.get("dtype"))
            if dtype_name:
                try:
                    import torch
                    kwargs["dtype"] = getattr(torch, dtype_name, dtype_name)
                except Exception:
                    kwargs["dtype"] = dtype_name
            
            try:
                airllm_model = AutoModel.from_pretrained(
                    config["model_id"],
                    **kwargs
                )
            except Exception as e:
                if "dtype" in kwargs:
                    kwargs.pop("dtype", None)
                    print(f"[AirLLM] DType failed, retry bez dtype: {e}")
                    airllm_model = AutoModel.from_pretrained(
                        config["model_id"],
                        **kwargs
                    )
                else:
                    raise
            airllm_tokenizer = airllm_model.tokenizer
            config["loaded"] = True

            # Compatibility with newer Transformers that expect _is_stateful on model classes.
            if not hasattr(airllm_model.__class__, "_is_stateful"):
                try:
                    airllm_model.__class__._is_stateful = False
                except Exception:
                    pass
            if not hasattr(airllm_model, "_is_stateful"):
                try:
                    airllm_model._is_stateful = False
                except Exception:
                    pass

            # KV cache can speed up decoding, but may be fragile for some models.
            try:
                use_cache = bool(config.get("use_kv_cache"))
                airllm_model.generation_config.use_cache = use_cache
                airllm_model.config.use_cache = use_cache
                print(f"[AirLLM] KV cache: {'on' if use_cache else 'off'}", flush=True)
            except Exception:
                pass

            # Guard against invalid past_key_values injected by newer Transformers.
            try:
                orig_prepare = airllm_model.__class__.prepare_inputs_for_generation

                def patched_prepare_inputs_for_generation(self, input_ids, past_key_values=None, **kwargs):
                    if past_key_values is not None:
                        try:
                            first = past_key_values[0]
                            if first is None or (isinstance(first, tuple) and first[0] is None):
                                past_key_values = None
                        except Exception:
                            past_key_values = None
                    return orig_prepare(self, input_ids, past_key_values=past_key_values, **kwargs)

                airllm_model.__class__.prepare_inputs_for_generation = patched_prepare_inputs_for_generation
            except Exception:
                pass

            try:
                orig_get_past = airllm_model.__class__.get_past_key_values_cache_seq_len

                def patched_get_past_key_values_cache_seq_len(self, past_key_values):
                    if past_key_values is None:
                        return 0
                    try:
                        first = past_key_values[0]
                        if first is None or (isinstance(first, tuple) and first[0] is None):
                            return 0
                    except Exception:
                        return 0
                    return orig_get_past(self, past_key_values)

                airllm_model.__class__.get_past_key_values_cache_seq_len = patched_get_past_key_values_cache_seq_len
            except Exception:
                pass

            # Qwen2 expects position_embeddings; compute RoPE cos/sin on the fly.
            try:
                rotary_provider = None
                if hasattr(airllm_model, "rotary_emb"):
                    rotary_provider = airllm_model.rotary_emb
                elif hasattr(airllm_model, "model") and hasattr(airllm_model.model, "rotary_emb"):
                    rotary_provider = airllm_model.model.rotary_emb
                elif hasattr(airllm_model, "model") and hasattr(airllm_model.model, "model") and hasattr(airllm_model.model.model, "rotary_emb"):
                    rotary_provider = airllm_model.model.model.rotary_emb

                if rotary_provider is not None:
                    import torch as _torch
                    if not hasattr(airllm_model, "_airllm_rotary_logged"):
                        print(f"[AirLLM] RoPE provider={type(rotary_provider)}", flush=True)
                        airllm_model._airllm_rotary_logged = True

                    def patched_get_pos_emb_args(self, len_p, len_s):
                        if len_s <= 0:
                            return {}
                        if not hasattr(self, "_airllm_pos_emb_logged"):
                            print("[AirLLM] Patched position embeddings active")
                            self._airllm_pos_emb_logged = True
                        position_ids = _torch.arange(
                            len_p, len_p + len_s, device=self.running_device, dtype=_torch.long
                        ).unsqueeze(0)
                        dummy = _torch.zeros(
                            (1, len_s, self.config.hidden_size),
                            device=self.running_device,
                            dtype=self.running_dtype
                        )
                        cos, sin = rotary_provider(dummy, position_ids)
                        if not hasattr(self, "_airllm_pos_emb_count"):
                            self._airllm_pos_emb_count = 0
                        if self._airllm_pos_emb_count < 5:
                            print(
                                f"[AirLLM] pos_emb len_p={len_p} len_s={len_s} cos={tuple(cos.shape)} sin={tuple(sin.shape)}",
                                flush=True,
                            )
                            self._airllm_pos_emb_count += 1
                        # Align rotary dims with actual attention head_dim if needed.
                        target_dim = None
                        try:
                            layer_ref = None
                            if hasattr(self.model, "model") and hasattr(self.model.model, "layers"):
                                layer_ref = self.model.model.layers[0]
                            elif hasattr(self.model, "layers"):
                                layer_ref = self.model.layers[0]
                            if layer_ref is not None:
                                q_proj_out = getattr(layer_ref.self_attn.q_proj, "out_features", None)
                                if q_proj_out and getattr(self.config, "num_attention_heads", None):
                                    target_dim = q_proj_out // self.config.num_attention_heads
                                if not target_dim:
                                    target_dim = getattr(layer_ref.self_attn, "head_dim", None)
                        except Exception:
                            target_dim = None
                        if target_dim and cos.shape[-1] != target_dim:
                            cos = cos[..., :target_dim]
                            sin = sin[..., :target_dim]
                        return {"position_embeddings": (cos, sin)}

                    airllm_model.__class__.get_pos_emb_args = patched_get_pos_emb_args
            except Exception:
                pass

            # Patch Qwen2 RoPE to handle dimension mismatches between q/k and cos/sin.
            try:
                import torch as _torch
                from transformers.models.qwen2 import modeling_qwen2 as _qwen2_modeling

                if not getattr(_qwen2_modeling, "_airllm_rope_patch", False):
                    _orig_apply = _qwen2_modeling.apply_rotary_pos_emb

                    def patched_apply_rotary_pos_emb(q, k, cos, sin, position_ids=None, unsqueeze_dim=1):
                        if not hasattr(patched_apply_rotary_pos_emb, "_count"):
                            patched_apply_rotary_pos_emb._count = 0
                        if patched_apply_rotary_pos_emb._count < 5:
                            print(
                                f"[AirLLM] RoPE shapes q={tuple(q.shape)} cos={tuple(cos.shape)} sin={tuple(sin.shape)} unsqueeze_dim={unsqueeze_dim}",
                                flush=True,
                            )
                            patched_apply_rotary_pos_emb._count += 1
                        cos_adj = cos
                        sin_adj = sin
                        if cos_adj.shape[-2] != q.shape[-2] and cos_adj.shape[-1] == q.shape[-2] and cos_adj.shape[-2] == q.shape[-1]:
                            cos_adj = cos_adj.transpose(-1, -2)
                            sin_adj = sin_adj.transpose(-1, -2)
                        if cos_adj.shape[-1] > q.shape[-1]:
                            cos_adj = cos_adj[..., : q.shape[-1]]
                            sin_adj = sin_adj[..., : q.shape[-1]]
                        if cos_adj.shape[-1] < q.shape[-1]:
                            cos_u = cos_adj.unsqueeze(unsqueeze_dim)
                            sin_u = sin_adj.unsqueeze(unsqueeze_dim)
                            dim = cos_adj.shape[-1]
                            q1, q2 = q[..., :dim], q[..., dim:]
                            k1, k2 = k[..., :dim], k[..., dim:]
                            q1 = (q1 * cos_u) + (_qwen2_modeling.rotate_half(q1) * sin_u)
                            k1 = (k1 * cos_u) + (_qwen2_modeling.rotate_half(k1) * sin_u)
                            if not hasattr(patched_apply_rotary_pos_emb, "_logged"):
                                print(
                                    f"[AirLLM] RoPE dim fix applied q={q.shape[-1]} cos={cos.shape[-1]} target={dim}",
                                    flush=True,
                                )
                                patched_apply_rotary_pos_emb._logged = True
                            return _torch.cat((q1, q2), dim=-1), _torch.cat((k1, k2), dim=-1)
                        if not hasattr(patched_apply_rotary_pos_emb, "_logged"):
                            print(
                                f"[AirLLM] RoPE dim ok q={q.shape[-1]} cos={cos.shape[-1]}",
                                flush=True,
                            )
                            patched_apply_rotary_pos_emb._logged = True
                        return _orig_apply(q, k, cos_adj, sin_adj, position_ids=position_ids, unsqueeze_dim=unsqueeze_dim)

                    _qwen2_modeling.apply_rotary_pos_emb = patched_apply_rotary_pos_emb
                    _qwen2_modeling._airllm_rope_patch = True
            except Exception:
                pass

            # AirLLM sequence length can be wrong if batch dim is missing.
            try:
                orig_get_sequence_len = airllm_model.__class__.get_sequence_len

                def patched_get_sequence_len(self, seq):
                    try:
                        if hasattr(seq, "dim") and seq.dim() >= 2:
                            length = seq.shape[-2]
                        else:
                            length = seq.shape[0]
                        if not hasattr(self, "_airllm_seq_len_logged"):
                            print(f"[AirLLM] seq shape={tuple(seq.shape)} len={length}", flush=True)
                            self._airllm_seq_len_logged = True
                        return length
                    except Exception:
                        return orig_get_sequence_len(self, seq)

                airllm_model.__class__.get_sequence_len = patched_get_sequence_len
            except Exception:
                pass

            # Qwen2DecoderLayer returns a tensor, but AirLLM assumes a tuple and indexes [0].
            try:
                import torch as _torch

                # Keep last-loaded layer state for recovery when meta params sneak in.
                try:
                    orig_move_layer_to_device = airllm_model.__class__.move_layer_to_device

                    def patched_move_layer_to_device(self, state_dict):
                        self._airllm_last_state_dict = state_dict
                        return orig_move_layer_to_device(self, state_dict)

                    airllm_model.__class__.move_layer_to_device = patched_move_layer_to_device
                except Exception:
                    pass

                def _wrap_layer_forward(layer):
                    if getattr(layer, "_airllm_tuple_wrap", False):
                        return
                    if not (hasattr(layer, "self_attn") and hasattr(layer, "mlp")):
                        return
                    orig_forward = layer.forward

                    def wrapped_forward(*args, **kwargs):
                        try:
                            if hasattr(layer, "input_layernorm") and getattr(layer.input_layernorm.weight, "is_meta", False):
                                last_sd = getattr(airllm_model, "_airllm_last_state_dict", None)
                                if last_sd is not None:
                                    airllm_model.move_layer_to_device(last_sd)
                        except Exception:
                            pass
                        out = orig_forward(*args, **kwargs)
                        if isinstance(out, _torch.Tensor):
                            return (out,)
                        return out

                    layer.forward = wrapped_forward
                    layer._airllm_tuple_wrap = True

                if hasattr(airllm_model, "layers"):
                    for _idx, _layer in enumerate(airllm_model.layers[:5]):
                        print(f"[AirLLM] layer[{_idx}] class={_layer.__class__.__name__}", flush=True)
                    for _layer in airllm_model.layers:
                        _wrap_layer_forward(_layer)

                # Ensure wrapping persists after AirLLM re-initializes the model each forward call.
                orig_init_model = airllm_model.__class__.init_model

                def patched_init_model(self):
                    orig_init_model(self)
                    try:
                        if hasattr(self, "layers"):
                            for _layer in self.layers:
                                _wrap_layer_forward(_layer)
                    except Exception:
                        pass

                airllm_model.__class__.init_model = patched_init_model
            except Exception:
                pass

            try:
                layer_ref = None
                if hasattr(airllm_model, "model") and hasattr(airllm_model.model, "model") and hasattr(airllm_model.model.model, "layers"):
                    layer_ref = airllm_model.model.model.layers[0]
                elif hasattr(airllm_model, "model") and hasattr(airllm_model.model, "layers"):
                    layer_ref = airllm_model.model.layers[0]
                head_dim = getattr(layer_ref.self_attn, "head_dim", None) if layer_ref is not None else None
                q_proj_out = getattr(layer_ref.self_attn.q_proj, "out_features", None) if layer_ref is not None else None
                head_dim_calc = None
                if q_proj_out and getattr(airllm_model.config, "num_attention_heads", None):
                    head_dim_calc = q_proj_out // airllm_model.config.num_attention_heads
                print(f"[AirLLM] Qwen2 config hidden={airllm_model.config.hidden_size} heads={airllm_model.config.num_attention_heads} head_dim={head_dim} q_proj_out={q_proj_out} head_dim_calc={head_dim_calc}")
            except Exception:
                pass
            
            print("[AirLLM] Model úspěšně načten!")
            return True
            
        except Exception as e:
            print(f"[AirLLM] Chyba při načítání modelu: {e}")
            return False


def generate_response(prompt: str, max_new_tokens: int = 512) -> str:
    """Generuje odpověď pomocí AirLLM"""
    if not load_model():
        return "[Chyba: Model není načten]"
    
    try:
        input_tokens = airllm_tokenizer(
            prompt,
            return_tensors="pt",
            return_attention_mask=True,
            truncation=True,
            max_length=config["max_length"],
            padding=False
        )
        
        input_ids = input_tokens['input_ids'].cuda()
        attention_mask = input_tokens.get('attention_mask')
        if attention_mask is not None:
            attention_mask = attention_mask.cuda()
        
        # Some transformer backends require attention_mask; include when available.
        generation_kwargs = {
            "max_new_tokens": max_new_tokens,
            "use_cache": bool(config.get("use_kv_cache")),
            "return_dict_in_generate": True
        }
        if attention_mask is not None:
            generation_kwargs["attention_mask"] = attention_mask
        if airllm_tokenizer.eos_token_id is not None:
            generation_kwargs["pad_token_id"] = airllm_tokenizer.eos_token_id
        
        generation_output = airllm_model.generate(
            input_ids,
            **generation_kwargs
        )
        
        output = airllm_tokenizer.decode(
            generation_output.sequences[0],
            skip_special_tokens=True
        )
        
        # Odstraň původní prompt z výstupu
        if output.startswith(prompt):
            output = output[len(prompt):].strip()
        
        return output
        
    except Exception as e:
        print(f"[AirLLM] Chyba generování: {e}")
        traceback.print_exc()
        return f"[Chyba generování: {e}]"


def generate_stream(prompt: str, max_new_tokens: int = 512) -> Generator[str, None, None]:
    """
    Streamuje odpověď po částech.
    Poznámka: AirLLM nativně nepodporuje streaming, simulujeme ho.
    """
    response = generate_response(prompt, max_new_tokens)
    
    # Simulace streamingu - posíláme po slovech
    words = response.split()
    for i, word in enumerate(words):
        yield word + (" " if i < len(words) - 1 else "")
        time.sleep(0.02)  # Malé zpoždění pro plynulý stream


@app.route('/api/tags', methods=['GET'])
def list_models():
    """Vrátí seznam dostupných modelů (Ollama API kompatibilní)"""
    return jsonify({
        "models": [
            {
                "name": config["model_id"].split("/")[-1],
                "model": config["model_id"],
                "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "size": 0,
                "digest": "airllm",
                "details": {
                    "format": "airllm",
                    "family": "airllm",
                    "parameter_size": "70B",
                    "quantization_level": config["compression"] or "none"
                }
            }
        ]
    })


@app.route('/api/generate', methods=['POST'])
def api_generate():
    """
    Generování textu (Ollama API kompatibilní)
    
    Body:
        model: string (ignorováno, používá se nakonfigurovaný model)
        prompt: string
        stream: bool (default: false)
        options:
            num_predict: int (max tokens)
    """
    data = request.get_json()
    prompt = data.get('prompt', '')
    stream = data.get('stream', False)
    options = data.get('options', {})
    max_tokens = options.get('num_predict', 512)
    
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400
    
    if stream:
        def generate():
            for chunk in generate_stream(prompt, max_tokens):
                yield json.dumps({
                    "model": config["model_id"],
                    "response": chunk,
                    "done": False
                }) + "\n"
            yield json.dumps({
                "model": config["model_id"],
                "response": "",
                "done": True
            }) + "\n"
        
        return Response(generate(), mimetype='application/x-ndjson')
    else:
        response = generate_response(prompt, max_tokens)
        return jsonify({
            "model": config["model_id"],
            "response": response,
            "done": True,
            "total_duration": 0,
            "load_duration": 0,
            "prompt_eval_duration": 0,
            "eval_duration": 0
        })


@app.route('/api/chat', methods=['POST'])
def api_chat():
    """
    Chat API (Ollama API kompatibilní)
    
    Body:
        model: string
        messages: [{role, content}]
        stream: bool
        options: {...}
    """
    data = request.get_json()
    messages = data.get('messages', [])
    stream = data.get('stream', False)
    options = data.get('options', {})
    max_tokens = options.get('num_predict', 512)
    
    # Sestavení promptu z messages
    prompt_parts = []
    for msg in messages:
        role = msg.get('role', 'user')
        content = msg.get('content', '')
        if role == 'system':
            prompt_parts.append(f"System: {content}")
        elif role == 'user':
            prompt_parts.append(f"User: {content}")
        elif role == 'assistant':
            prompt_parts.append(f"Assistant: {content}")
    
    prompt_parts.append("Assistant:")
    full_prompt = "\n\n".join(prompt_parts)
    
    if stream:
        def generate():
            for chunk in generate_stream(full_prompt, max_tokens):
                yield json.dumps({
                    "model": config["model_id"],
                    "message": {
                        "role": "assistant",
                        "content": chunk
                    },
                    "done": False
                }) + "\n"
            yield json.dumps({
                "model": config["model_id"],
                "message": {
                    "role": "assistant",
                    "content": ""
                },
                "done": True
            }) + "\n"
        
        return Response(generate(), mimetype='application/x-ndjson')
    else:
        response = generate_response(full_prompt, max_tokens)
        return jsonify({
            "model": config["model_id"],
            "message": {
                "role": "assistant",
                "content": response
            },
            "done": True
        })


@app.route('/api/show', methods=['POST'])
def api_show():
    """Informace o modelu"""
    return jsonify({
        "modelfile": f"FROM {config['model_id']}",
        "parameters": f"compression {config['compression'] or 'none'}",
        "template": "",
        "details": {
            "format": "airllm",
            "family": "airllm",
            "parameter_size": "70B"
        }
    })


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "model": config["model_id"],
        "loaded": config["loaded"],
        "compression": config["compression"],
        "kv_cache": config.get("use_kv_cache", False)
    })


@app.route('/', methods=['GET'])
def index():
    """Hlavní stránka s informacemi"""
    return jsonify({
        "name": "AirLLM Server pro Shumilek",
        "version": "1.0.0",
        "model": config["model_id"],
        "compression": config["compression"],
        "endpoints": [
            "/api/tags - Seznam modelů",
            "/api/generate - Generování textu",
            "/api/chat - Chat API",
            "/api/show - Info o modelu",
            "/health - Health check"
        ]
    })


def main():
    parser = argparse.ArgumentParser(description="AirLLM Server pro Shumilek")
    parser.add_argument(
        "--model", "-m",
        type=str,
        default="Qwen/Qwen2.5-72B-Instruct",
        help="HuggingFace model ID nebo lokální cesta"
    )
    parser.add_argument(
        "--compression", "-c",
        type=str,
        choices=["4bit", "8bit", "none"],
        default="none",
        help="Komprese modelu pro rychlejší inference"
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=11435,
        help="Port serveru (default: 11435)"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=2048,
        help="Maximální délka kontextu"
    )
    parser.add_argument(
        "--dtype",
        type=str,
        choices=["auto", "bf16", "fp16", "fp32"],
        default="auto",
        help="Precision for weights (auto/bf16/fp16/fp32)"
    )
    parser.add_argument(
        "--kv-cache",
        action="store_true",
        help="Enable KV cache (faster decoding, higher VRAM usage)"
    )
    parser.add_argument(
        "--preload",
        action="store_true",
        help="Načíst model ihned při startu"
    )
    parser.add_argument(
        "--delete-original",
        action="store_true",
        help="Smazat originální HF model po transformaci (šetří místo)"
    )
    
    args = parser.parse_args()
    
    # Nastavení konfigurace
    config["model_id"] = args.model
    config["compression"] = args.compression if args.compression != "none" else None
    config["max_length"] = args.max_length
    config["delete_original"] = args.delete_original
    config["dtype"] = args.dtype
    config["use_kv_cache"] = args.kv_cache
    
    print("=" * 60)
    print("  AirLLM Server pro Shumilek VS Code Extension")
    print("=" * 60)
    print(f"  Model:     {config['model_id']}")
    print(f"  Komprese:  {config['compression'] or 'žádná'}")
    print(f"  DType:     {config['dtype']}")
    print(f"  KV cache:  {'on' if config['use_kv_cache'] else 'off'}")
    print(f"  Port:      {args.port}")
    print(f"  Max délka: {config['max_length']}")
    print("=" * 60)
    
    if args.preload:
        print("\n[AirLLM] Přednačítám model...")
        load_model()
    else:
        print("\n[AirLLM] Model bude načten při prvním požadavku")
    
    print(f"\n[AirLLM] Server běží na http://{args.host}:{args.port}")
    print("[AirLLM] Pro Shumilek nastav: shumilek.baseUrl = http://localhost:11435")
    print()
    
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
