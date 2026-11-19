"""Fine-tune Qwen3-1.7B for offline evaluation of Shared Groups intent."""

import argparse
import gc
import hashlib
import json
from pathlib import Path
import random
import time

import torch
import torch.nn.functional as functional
from accelerate import init_empty_weights
from accelerate.utils import set_module_tensor_to_device
from peft import LoraConfig, PeftModel, TaskType, get_peft_model
from safetensors import safe_open
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


def read_rows(file):
    return [json.loads(line) for line in file.read_text(encoding="utf-8").splitlines()]


def input_ids(tokenizer, message):
    return tokenizer.apply_chat_template(
        [{"role": "system", "content": PROMPT}, {"role": "user", "content": message}],
        tokenize=True,
        add_generation_prompt=True,
        enable_thinking=False,
    )


def prepare(tokenizer, rows):
    result = []
    for row in rows:
        ids = input_ids(tokenizer, row["message"])
        if len(ids) > 320:
            raise ValueError(f"{row['id']} exceeds the 320-token limit.")
        result.append((row, ids, ROUTES.index(row["route"])))
    return result


def load_base(directory):
    config = AutoConfig.from_pretrained(directory, local_files_only=True)
    with init_empty_weights():
        model = AutoModelForCausalLM.from_config(
            config, dtype=torch.bfloat16, attn_implementation="sdpa"
        )

    # Reading each tensor directly avoids the memory-mapped storage slice used
    # by the Transformers loader, which crashed on this Windows/PyTorch setup.
    for shard in sorted(directory.glob("model-*-of-*.safetensors")):
        with safe_open(shard, framework="pt", device="cpu") as source:
            for name in source.keys():
                set_module_tensor_to_device(
                    model, name, "cuda:0", value=source.get_tensor(name)
                )
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
def evaluate(model, examples, pad_id, option_tokens):
    model.eval()
    counts = {route: {"total": 0, "correct": 0, "predicted": 0} for route in ROUTES}
    styles = {}
    errors = []
    for start in range(0, len(examples), 6):
        batch = examples[start : start + 6]
        predictions = logits_for(model, batch, pad_id, option_tokens).argmax(dim=1).tolist()
        for (row, _, expected), predicted in zip(batch, predictions, strict=True):
            match = expected == predicted
            counts[ROUTES[expected]]["total"] += 1
            counts[ROUTES[expected]]["correct"] += int(match)
            counts[ROUTES[predicted]]["predicted"] += 1
            style = styles.setdefault(row["style"], {"total": 0, "correct": 0})
            style["total"] += 1
            style["correct"] += int(match)
            if not match:
                errors.append({
                    "id": row["id"],
                    "expected": ROUTES[expected],
                    "predicted": ROUTES[predicted],
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
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, help="Evaluate a saved LoRA checkpoint.")
    parser.add_argument("--epochs", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--batch", type=int, choices=(1, 2, 4), default=4)
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("This run requires a CUDA GPU.")
    free, total = torch.cuda.mem_get_info()
    if free < 5 * 1024**3:
        raise RuntimeError(f"Need at least 5 GiB of free VRAM at startup. Found {free / 1024**3:.2f} GiB.")

    random.seed(7013)
    torch.manual_seed(7013)
    torch.set_num_threads(2)
    started = time.monotonic()
    model_name = "Qwen/Qwen3-1.7B"
    revision = "70d244cc86ccca08cf5af4e1e306ecf908b1ad5e"
    train_file, holdout_file = (args.root / name for name in ("train.jsonl", "holdout.jsonl"))
    train_rows, holdout_rows = read_rows(train_file), read_rows(holdout_file)
    if {row["message"] for row in train_rows} & {row["message"] for row in holdout_rows}:
        raise ValueError("Training examples appear in the evaluation set.")
    random.shuffle(train_rows)
    balanced_rows = []
    for route in ROUTES:
        matching = [row for row in train_rows if row["route"] == route]
        balanced_rows.extend(matching[:60])
    tokenizer = AutoTokenizer.from_pretrained(args.root / "base", local_files_only=True)
    option_ids = [tokenizer.encode(letter, add_special_tokens=False) for letter in LABELS]
    if any(len(ids) != 1 for ids in option_ids):
        raise ValueError("Each label must be exactly one token.")
    option_tokens = torch.tensor([ids[0] for ids in option_ids], device="cuda")
    training = prepare(tokenizer, balanced_rows)
    holdout = prepare(tokenizer, holdout_rows)
    args.output.mkdir(parents=True, exist_ok=False)
    model = load_base(args.root / "base")
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter, local_files_only=True)
        restored = evaluate(model, holdout, tokenizer.pad_token_id, option_tokens)
        (args.output / "reloaded.json").write_text(json.dumps(restored, indent=2), encoding="utf-8")
        print(json.dumps({
            "stage": "reloaded",
            "correct": restored["correct"],
            "total": restored["total"],
        }), flush=True)
        return
    baseline = evaluate(model, holdout, tokenizer.pad_token_id, option_tokens)
    (args.output / "baseline.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    print(json.dumps({
        "stage": "baseline",
        "total": baseline["total"],
        "correct": baseline["correct"],
        "train": len(training),
    }), flush=True)

    model = get_peft_model(model, LoraConfig(
        task_type=TaskType.CAUSAL_LM, r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"],
    ))
    model.peft_config["default"].base_model_name_or_path = model_name
    model.peft_config["default"].revision = revision
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(parameters, lr=0.0002)
    model.train()
    step = 0
    for epoch in range(args.epochs):
        random.shuffle(training)
        loss_total = 0.0
        for offset in range(0, len(training), args.batch):
            batch = training[offset : offset + args.batch]
            labels = torch.tensor([label for _, _, label in batch], device="cuda")
            optimizer.zero_grad(set_to_none=True)
            logits = logits_for(model, batch, tokenizer.pad_token_id, option_tokens)
            loss = functional.cross_entropy(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(parameters, 1.0)
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
    tuned = evaluate(model, holdout, tokenizer.pad_token_id, option_tokens)
    metrics = {
        "model": model_name, "revision": revision, "seed": 7013, "epochs": args.epochs,
        "batch": args.batch, "training_rows": len(training), "training_steps": step,
        "peak_vram_mib": round(torch.cuda.max_memory_reserved() / 1024**2),
        "total_vram_mib": round(total / 1024**2), "gpu": torch.cuda.get_device_name(),
        "seconds": round(time.monotonic() - started, 1),
        "datasets": {
            file.name: hashlib.sha256(file.read_bytes()).hexdigest()
            for file in (train_file, holdout_file)
        },
        "prompt_sha256": hashlib.sha256(PROMPT.encode()).hexdigest(), "baseline": baseline, "tuned": tuned,
    }
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
