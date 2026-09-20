#!/usr/bin/env python3
"""Call gpt-5.6-sol via the Futu llm-proxy Responses API.

Usage:
  python3 scripts/gpt56.py "你的问题"
  echo "你的问题" | python3 scripts/gpt56.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from openai import OpenAI


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def extract_text(response) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text
    parts: list[str] = []
    for item in getattr(response, "output", None) or []:
        for content in getattr(item, "content", None) or []:
            text = getattr(content, "text", None)
            if text:
                parts.append(text)
    return "\n".join(parts)


def read_prompt(argv: list[str]) -> str:
    if argv:
        return " ".join(argv).strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ""


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")

    prompt = read_prompt(sys.argv[1:])
    if not prompt:
        print('用法: python3 scripts/gpt56.py "你的问题"', file=sys.stderr)
        return 2

    api_key = os.getenv("LLM_PROXY_API_KEY", "").strip()
    if not api_key:
        print("缺少 LLM_PROXY_API_KEY，请写在项目根目录 .env 里。", file=sys.stderr)
        return 2

    timeout = float(os.getenv("MODEL_REQUEST_TIMEOUT_SECONDS", "60"))
    base_url = os.getenv("LLM_PROXY_BASE_URL", "https://llm-proxy.futuoa.com").rstrip("/")
    model = os.getenv("LLM_PROXY_MODEL", "gpt-5.6-sol")

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        stream=False,
    )
    text = extract_text(response)
    if not text:
        print(response.model_dump_json(indent=2) if hasattr(response, "model_dump_json") else response)
        return 1
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
