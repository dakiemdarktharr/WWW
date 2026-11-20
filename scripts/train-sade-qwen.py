"""Fine-tune Qwen3 for offline evaluation of Shared Groups intent."""

import argparse
import gc
import hashlib
import json
from pathlib import Path
import random
import struct
import time

import torch
import torch.nn.functional as functional
from accelerate import init_empty_weights
from accelerate.utils import set_module_tensor_to_device
from peft import LoraConfig, PeftModel, TaskType, get_peft_model
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer


ROUTES = ("general", "mac", "handoff", "review", "scope", "chat")
LABELS = tuple("ABCDEF")
PROMPT = """Classify the main intent of the group message.
A: General work request or help with access, limits or connectivity.
B: Requires a real macOS or Mac test.
C: One teammate must use another's output or wait for their handoff.
D: A separate reviewer should verify code or a patch before integration.
E: Avoid duplicate edits or simultaneous work on the same files.
F: The message explicitly asks for no AI action.
Ignore project names, AI plans and message formatting. Reply with one letter only."""
ACTION_ROUTES = ("work", "chat")
ACTION_LABELS = ("A", "F")
ACTION_PROMPT = """Decide whether this group message asks Sade to do work now.
A: Requests a concrete action from Sade, even if phrased informally or as a question.
F: A status update, a quote, a message for teammates only, or an explicit request to wait.
Judge the speaker's current request. Past actions, quoted requests, tool names and AI plans
do not establish a new request. Reply with one letter only."""


def read_rows(file):
    return [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines()]


def input_ids(tokenizer, message, prompt=PROMPT):
    return tokenizer.apply_chat_template(
        [{"role": "system", "content": prompt}, {"role": "user", "content": message}],
        tokenize=True,
        add_generation_prompt=True,
        enable_thinking=False,
    )


def prepare(tokenizer, rows, *, routes=ROUTES, prompt=PROMPT):
    result = []
    for row in rows:
        ids = input_ids(tokenizer, row["message"], prompt)
        if len(ids) > 320:
            raise ValueError(f"{row['id']} exceeds the 320-token limit.")
        route = row["route"]
        if routes == ACTION_ROUTES and route in ROUTES and route != "chat":
            route = "work"
        result.append((row, ids, routes.index(route)))
    return result


def load_checkpoint_shard(model, shard, buffer):
    with shard.open("rb") as source:
        prefix = source.read(8)
        if len(prefix) != 8:
            raise ValueError(f"{shard.name} has no Safetensors header length.")
        header_size = struct.unpack("<Q", prefix)[0]
        if not 2 <= header_size <= 100_000_000:
            raise ValueError(f"{shard.name} has an invalid Safetensors header length.")
        header = json.loads(source.read(header_size))
        header.pop("__metadata__", None)
        data_size = shard.stat().st_size - source.tell()
        cursor = 0
        for name, metadata in sorted(header.items(), key=lambda item: item[1]["data_offsets"][0]):
            parameter = model.get_parameter(name)
            start, end = metadata["data_offsets"]
            if (
                start != cursor or not start <= end <= data_size or not parameter.is_meta
                or metadata["dtype"] != "BF16" or tuple(metadata["shape"]) != parameter.shape
                or end - start != parameter.numel() * parameter.element_size()
            ):
                raise ValueError(f"{shard.name} has invalid checkpoint data for {name}.")
            cursor = end
            # Qwen stores an extra output matrix even when it ties it to the word embeddings.
            if model.config.tie_word_embeddings and name == "lm_head.weight":
                source.seek(end - start, 1)
                continue
            value = torch.empty(parameter.numel(), device="cuda:0", dtype=parameter.dtype)
            for offset in range(0, end - start, len(buffer)):
                chunk = buffer[: min(len(buffer), end - start - offset)]
                if source.readinto(chunk) != len(chunk):
                    raise ValueError(f"{shard.name} ended while reading {name}.")
                tensor = torch.frombuffer(chunk, dtype=parameter.dtype)
                value.narrow(0, offset // parameter.element_size(), tensor.numel()).copy_(tensor)
            set_module_tensor_to_device(model, name, "cuda:0", value=value.view(parameter.shape))
        if cursor != data_size:
            raise ValueError(f"{shard.name} has unindexed checkpoint data.")


def load_base(directory):
    config = AutoConfig.from_pretrained(directory, local_files_only=True)
    with init_empty_weights(include_buffers=True):
        model = AutoModelForCausalLM.from_config(
            config, dtype=torch.bfloat16, attn_implementation="sdpa"
        )
    # Qwen computes its nonpersistent rotary buffers from the model config.
    # Build these separately so even the temporary parameter tensors start on meta.
    model.model.rotary_emb = type(model.model.rotary_emb)(config)

    # CUDA streams each shard using a reusable 16 MiB CPU buffer.
    buffer = memoryview(bytearray(16 * 1024**2))
    single_file = directory / "model.safetensors"
    shards = [single_file] if single_file.is_file() else sorted(directory.glob("model-*-of-*.safetensors"))
    for shard in shards:
        load_checkpoint_shard(model, shard, buffer)
        print(json.dumps({"stage": "load", "shard": shard.name}), flush=True)
    model.tie_weights()
    if any(parameter.is_meta for parameter in model.parameters()):
        raise RuntimeError("The checkpoint is missing required weights.")
    return model.to("cuda:0")


def logits_for(model, batch, pad_id, option_tokens):
    length = max(len(ids) for _, ids, _ in batch)
    tokens = []
    masks = []
    for _, ids, _ in batch:
        padding = length - len(ids)
        tokens.append([pad_id] * padding + ids)
        masks.append([0] * padding + [1] * len(ids))
    mask = torch.tensor(masks, device="cuda")
    positions = (mask.cumsum(dim=1) - 1).clamp_min(0)
    result = model(
        input_ids=torch.tensor(tokens, device="cuda"),
        attention_mask=mask,
        position_ids=positions,
        use_cache=False,
        logits_to_keep=1,
    )
    return result.logits[:, -1, option_tokens].float()


@torch.inference_mode()
def evaluate(model, examples, pad_id, option_tokens, *, routes=ROUTES, batch_size=6):
    model.eval()
    counts = {route: {"total": 0, "correct": 0, "predicted": 0} for route in routes}
    styles = {}
    errors = []
    for start in range(0, len(examples), batch_size):
        batch = examples[start : start + batch_size]
        predictions = logits_for(model, batch, pad_id, option_tokens).argmax(dim=1).tolist()
        for (row, _, expected), predicted in zip(batch, predictions, strict=True):
            match = expected == predicted
            counts[routes[expected]]["total"] += 1
            counts[routes[expected]]["correct"] += int(match)
            counts[routes[predicted]]["predicted"] += 1
            style = styles.setdefault(row["style"], {"total": 0, "correct": 0})
            style["total"] += 1
            style["correct"] += int(match)
            if not match:
                errors.append({
                    "id": row["id"],
                    "expected": routes[expected],
                    "predicted": routes[predicted],
                })
    return {
        "total": len(examples),
        "correct": len(examples) - len(errors),
        "routes": counts,
        "styles": styles,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, help="Use a separate dataset with the same base model.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, help="Evaluate a saved LoRA checkpoint.")
    parser.add_argument("--size", choices=("1.7b", "0.6b"), default="1.7b")
    parser.add_argument("--challenge", type=Path, help="Evaluate a second, separate JSONL split.")
    parser.add_argument("--acceptance", type=Path, help="Evaluate a distinct final JSONL split.")
    parser.add_argument("--epochs", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--batch", type=int, choices=(1, 2, 4), default=4)
    parser.add_argument("--action-intent", action="store_true", help="Learn work vs. chat only.")
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("This run requires a CUDA GPU.")
    free, total = torch.cuda.mem_get_info()
    minimum_gib = 5 if args.size == "1.7b" else 2
    if free < minimum_gib * 1024**3:
        raise RuntimeError(
            f"Need at least {minimum_gib} GiB of free VRAM at startup. Found {free / 1024**3:.2f} GiB."
        )

    random.seed(7013)
    torch.manual_seed(7013)
    torch.set_num_threads(2)
    started = time.monotonic()
    if args.size == "1.7b":
        model_name = "Qwen/Qwen3-1.7B"
        revision = "70d244cc86ccca08cf5af4e1e306ecf908b1ad5e"
        base_dir = args.root / "base"
    else:
        model_name = "Qwen/Qwen3-0.6B"
        revision = "c1899de289a04d12100db370d81485cdf75e47ca"
        base_dir = args.root / "base-0.6b"
    data_dir = args.data_dir or args.root
    train_file, holdout_file = (data_dir / name for name in ("train.jsonl", "holdout.jsonl"))
    train_rows = read_rows(train_file)
    evaluation_files = {"holdout": holdout_file}
    for name in ("challenge", "acceptance"):
        file = getattr(args, name)
        if file:
            evaluation_files[name] = file
    evaluation_rows = {name: read_rows(file) for name, file in evaluation_files.items()}
    seen = {row["message"] for row in train_rows}
    for name, rows in evaluation_rows.items():
        messages = {row["message"] for row in rows}
        if seen & messages or len(messages) != len(rows):
            raise ValueError(f"Duplicate messages in evaluation split {name}.")
        seen |= messages
    random.shuffle(train_rows)
    by_route = {route: [row for row in train_rows if row["route"] == route] for route in ROUTES}
    if args.action_intent:
        # Represent each work type equally and match that total with chat examples.
        work_groups = [by_route[route] for route in ROUTES if route != "chat"]
        work_per_route = min(len(by_route["chat"]) // len(work_groups), *map(len, work_groups))
        if not work_per_route:
            raise ValueError("Action training requires examples of every route.")
        balanced_rows = [row for group in work_groups for row in group[:work_per_route]]
        balanced_rows.extend(by_route["chat"][:len(balanced_rows)])
        routes, labels, prompt = ACTION_ROUTES, ACTION_LABELS, ACTION_PROMPT
    else:
        balanced_rows = [row for group in by_route.values() for row in group[:60]]
        routes, labels, prompt = ROUTES, LABELS, PROMPT
    tokenizer = AutoTokenizer.from_pretrained(base_dir, local_files_only=True)
    option_ids = [tokenizer.encode(letter, add_special_tokens=False) for letter in labels]
    if any(len(ids) != 1 for ids in option_ids):
        raise ValueError("Each label must be exactly one token.")
    option_tokens = torch.tensor([ids[0] for ids in option_ids], device="cuda")
    training = prepare(tokenizer, balanced_rows, routes=routes, prompt=prompt)
    evaluation = {
        name: prepare(tokenizer, rows, routes=routes, prompt=prompt)
        for name, rows in evaluation_rows.items()
    }

    def scores(model):
        return {
            name: evaluate(
                model, examples, tokenizer.pad_token_id, option_tokens,
                routes=routes, batch_size=1 if args.batch == 1 else 6,
            )
            for name, examples in evaluation.items()
        }

    args.output.mkdir(parents=True, exist_ok=False)
    model = load_base(base_dir)
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter, local_files_only=True)
        results = scores(model)
        restored = results["holdout"]
        for name, result in results.items():
            filename = "reloaded.json" if name == "holdout" else f"{name}.json"
            (args.output / filename).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({
            "stage": "reloaded",
            "correct": restored["correct"],
            "total": restored["total"],
        }), flush=True)
        return
    baseline_scores = scores(model)
    baseline = baseline_scores["holdout"]
    (args.output / "baseline.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    print(json.dumps({
        "stage": "baseline",
        "total": baseline["total"],
        "correct": baseline["correct"],
        "train": len(training),
    }), flush=True)
    torch.cuda.empty_cache()

    model = get_peft_model(model, LoraConfig(
        task_type=TaskType.CAUSAL_LM, r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"],
    ))
    model.peft_config["default"].base_model_name_or_path = model_name
    model.peft_config["default"].revision = revision
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(parameters, lr=0.0002, foreach=False)
    model.train()
    step = 0
    for epoch in range(args.epochs):
        random.shuffle(training)
        loss_total = 0.0
        for offset in range(0, len(training), args.batch):
            batch = training[offset : offset + args.batch]
            targets = torch.tensor([label for _, _, label in batch], device="cuda")
            optimizer.zero_grad(set_to_none=True)
            logits = logits_for(model, batch, tokenizer.pad_token_id, option_tokens)
            loss = functional.cross_entropy(logits, targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(parameters, 1.0, foreach=False)
            optimizer.step()
            loss_total += loss.detach().item()
            step += 1
            if step % 10 == 0:
                print(json.dumps({
                    "epoch": epoch + 1,
                    "step": step,
                    "loss": round(loss_total / (offset // args.batch + 1), 4),
                    "peak_vram_mib": round(torch.cuda.max_memory_reserved() / 1024**2),
                }), flush=True)
        model.save_pretrained(args.output / f"epoch-{epoch + 1}", safe_serialization=True)
    del optimizer, parameters, logits, loss
    gc.collect()
    torch.cuda.empty_cache()
    tuned_scores = scores(model)
    tuned = tuned_scores["holdout"]
    metrics = {
        "model": model_name, "revision": revision, "seed": 7013, "epochs": args.epochs,
        "batch": args.batch, "training_rows": len(training), "training_steps": step,
        "routes": routes,
        "peak_vram_mib": round(torch.cuda.max_memory_reserved() / 1024**2),
        "total_vram_mib": round(total / 1024**2), "gpu": torch.cuda.get_device_name(),
        "seconds": round(time.monotonic() - started, 1),
        "datasets": {
            f"{name}.jsonl": hashlib.sha256(file.read_bytes()).hexdigest()
            for name, file in {"train": train_file, **evaluation_files}.items()
        },
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(), "baseline": baseline, "tuned": tuned,
    }
    for name in evaluation_files:
        if name == "holdout":
            continue
        metrics[name] = {"baseline": baseline_scores[name], "tuned": tuned_scores[name]}
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({
        "stage": "finished",
        "baseline": baseline["correct"],
        "tuned": tuned["correct"],
        "total": tuned["total"],
        "seconds": metrics["seconds"],
    }), flush=True)


if __name__ == "__main__":
    main()
