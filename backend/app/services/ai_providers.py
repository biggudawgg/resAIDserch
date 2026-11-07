from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
import anthropic
import openai
from groq import Groq
import httpx
from dataclasses import dataclass
import json


@dataclass
class AIResponse:
    content: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


class AIProviderAdapter(ABC):
    """Abstract base class for AI provider adapters."""

    @abstractmethod
    async def chat_completion(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> AIResponse:
        pass

    @abstractmethod
    async def is_available(self) -> bool:
        pass


class ClaudeAdapter(AIProviderAdapter):
    """Anthropic Claude API adapter."""

    def __init__(self, api_key: str, model: str = "claude-opus-4-1-20250805"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.provider = "claude"

        # Token pricing (as of knowledge cutoff)
        self.pricing = {
            "claude-opus-4-1-20250805": {"input": 0.003, "output": 0.015},
            "claude-3-5-sonnet-20241022": {"input": 0.003, "output": 0.015},
        }

    async def chat_completion(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> AIResponse:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=messages,
        )

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        pricing = self.pricing.get(self.model, {"input": 0.003, "output": 0.015})
        cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1000

        return AIResponse(
            content=response.content[0].text,
            provider=self.provider,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
        )

    async def is_available(self) -> bool:
        try:
            self.client.messages.create(
                model=self.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "ping"}],
            )
            return True
        except Exception:
            return False


class OpenAIAdapter(AIProviderAdapter):
    """OpenAI GPT API adapter."""

    def __init__(self, api_key: str, model: str = "gpt-4-turbo-preview"):
        self.client = openai.OpenAI(api_key=api_key)
        self.model = model
        self.provider = "openai"

        self.pricing = {
            "gpt-4-turbo-preview": {"input": 0.01, "output": 0.03},
            "gpt-4o": {"input": 0.005, "output": 0.015},
        }

    async def chat_completion(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> AIResponse:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        input_tokens = response.usage.prompt_tokens
        output_tokens = response.usage.completion_tokens

        pricing = self.pricing.get(self.model, {"input": 0.01, "output": 0.03})
        cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1000

        return AIResponse(
            content=response.choices[0].message.content,
            provider=self.provider,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
        )

    async def is_available(self) -> bool:
        try:
            self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=10,
            )
            return True
        except Exception:
            return False


class GroqAdapter(AIProviderAdapter):
    """Groq API adapter (free tier)."""

    def __init__(self, api_key: str, model: str = "mixtral-8x7b-32768"):
        self.client = Groq(api_key=api_key)
        self.model = model
        self.provider = "groq"
        self.pricing = {"mixtral-8x7b-32768": {"input": 0.0, "output": 0.0}}

    async def chat_completion(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> AIResponse:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        input_tokens = response.usage.prompt_tokens
        output_tokens = response.usage.completion_tokens
        cost = 0.0  # Groq free tier

        return AIResponse(
            content=response.choices[0].message.content,
            provider=self.provider,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
        )

    async def is_available(self) -> bool:
        try:
            self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=10,
            )
            return True
        except Exception:
            return False


class AIProviderRouter:
    """Routes tasks to the best AI provider based on requirements."""

    def __init__(
        self,
        claude_api_key: str,
        groq_api_key: str,
        openai_api_key: Optional[str] = None,
    ):
        self.providers = {
            "claude": ClaudeAdapter(claude_api_key),
            "groq": GroqAdapter(groq_api_key),
        }

        if openai_api_key:
            self.providers["openai"] = OpenAIAdapter(openai_api_key)

        self.task_routing = {
            "paper_search": ("groq", "claude"),
            "claim_extraction": ("claude", "openai"),
            "contradiction_detection": ("claude", "openai"),
            "confidence_scoring": ("claude", "groq"),
            "dead_end_proposal": ("claude", "openai"),
            "synthesis_briefing": ("claude", "openai"),
            "stance_extraction": ("claude", "openai"),
            "quote_verification": ("groq", "claude"),
        }

    async def select_provider(
        self,
        task_type: str,
        context_size: int = 0,
    ) -> str:
        """Select best provider for task based on requirements."""

        primary, fallback = self.task_routing.get(task_type, ("claude", "groq"))

        # Check if primary is available
        if await self.providers[primary].is_available():
            return primary

        # Fallback
        if fallback in self.providers and await self.providers[fallback].is_available():
            return fallback

        # Last resort
        return "claude"

    async def execute_task(
        self,
        task_type: str,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        force_provider: Optional[str] = None,
    ) -> AIResponse:
        """Execute a task with the best provider."""

        provider_name = force_provider or await self.select_provider(task_type)
        provider = self.providers[provider_name]

        response = await provider.chat_completion(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        return response
