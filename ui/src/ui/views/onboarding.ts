/**
 * Onboarding — guided web-based setup wizard.
 *
 * Mirrors the terminal `openclaw onboard` flow but in a friendly,
 * step-by-step web UI.  Each step uses the same Quick Setup definitions
 * so Configure → buttons and this tab share the same guided experience.
 */
import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import { runBuilderSetupAction, updateBuilderSetupInput } from "../controllers/builder.ts";
import { updateConfigFormValue, saveConfig, applyConfig } from "../controllers/config.ts";
import { titleForTab, type Tab } from "../navigation.ts";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

type OnboardingField = {
  label: string;
  path: Array<string | number>;
  placeholder: string;
  type: "text" | "secret" | "select";
  options?: Array<{ value: string; label: string }>;
  help?: string;
};

type OnboardingCategory = "ai" | "channels" | "search" | "features";

type OnboardingStep = {
  id: string;
  category: OnboardingCategory;
  title: string;
  subtitle: string;
  icon: string;
  difficulty: "easy" | "moderate" | "advanced";
  timeEstimate: string;
  /** Guide steps for non-technical users. */
  guide: Array<{ instruction: string; link?: string; linkLabel?: string }>;
  fields: OnboardingField[];
  docsLink?: string;
  /** If true, this step has no fields and is considered done if the user just reviews it. */
  infoOnly?: boolean;
  /** Config path to check if this step is already configured. */
  configCheck?: Array<string | number>;
  /** Navigate to this tab + section for advanced config. */
  advancedTarget?: { tab: Tab; section?: string };
};

function providerPath(providerId: string, ...segments: Array<string | number>) {
  return ["models", "providers", providerId, ...segments];
}

function providerCheck(providerId: string, ...segments: Array<string | number>) {
  return providerPath(providerId, ...segments);
}

const CATEGORY_META: Record<OnboardingCategory, { label: string; description: string }> = {
  ai: { label: "AI Providers", description: "Connect an LLM so your agents can think." },
  channels: {
    label: "Messaging Channels",
    description: "Where your agent sends and receives messages.",
  },
  search: { label: "Web Search", description: "Let your agent search the web for answers." },
  features: { label: "Features & Tools", description: "Extra capabilities for your agent." },
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  // ===== AI PROVIDERS =====
  {
    id: "openai",
    category: "ai",
    title: "OpenAI",
    subtitle: "GPT-4o, GPT-4.1, o3, and more.",
    icon: "\u{1F7E2}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the OpenAI platform and sign in (or create an account).",
        link: "https://platform.openai.com/api-keys",
        linkLabel: "OpenAI Platform",
      },
      {
        instruction: 'Click "Create new secret key", name it, and copy the key (starts with sk-).',
      },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("openai", "apiKey"),
        placeholder: "sk-...",
        type: "secret",
        help: "From platform.openai.com \u2192 API Keys.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/configuration#models",
    configCheck: providerCheck("openai", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "anthropic",
    category: "ai",
    title: "Anthropic",
    subtitle: "Claude Opus, Sonnet, and Haiku.",
    icon: "\u{1F7E0}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Anthropic Console and sign in.",
        link: "https://console.anthropic.com/settings/keys",
        linkLabel: "Anthropic Console",
      },
      { instruction: 'Click "Create Key", name it, and copy the key.' },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("anthropic", "apiKey"),
        placeholder: "sk-ant-...",
        type: "secret",
        help: "From console.anthropic.com \u2192 API Keys.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/configuration#models",
    configCheck: providerCheck("anthropic", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "google-gemini",
    category: "ai",
    title: "Google Gemini",
    subtitle: "Gemini 2.5 Pro, Flash, and more.",
    icon: "\u{1F535}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to Google AI Studio and sign in.",
        link: "https://aistudio.google.com/apikey",
        linkLabel: "AI Studio",
      },
      { instruction: 'Click "Create API Key", select a project, and copy the key.' },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("google", "apiKey"),
        placeholder: "AI...",
        type: "secret",
        help: "From aistudio.google.com.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/configuration#models",
    configCheck: providerCheck("google", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "xai-grok",
    category: "ai",
    title: "xAI (Grok)",
    subtitle: "Grok 3, Grok 3 Mini.",
    icon: "\u{26A1}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the xAI console and sign in.",
        link: "https://console.x.ai",
        linkLabel: "xAI Console",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("xai", "apiKey"),
        placeholder: "xai-...",
        type: "secret",
        help: "From console.x.ai.",
      },
    ],
    configCheck: providerCheck("xai", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "mistral",
    category: "ai",
    title: "Mistral AI",
    subtitle: "Mistral Large, Codestral, and more.",
    icon: "\u{1F7E3}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Mistral console and sign in.",
        link: "https://console.mistral.ai/api-keys",
        linkLabel: "Mistral Console",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("mistral", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From console.mistral.ai.",
      },
    ],
    configCheck: providerCheck("mistral", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "groq",
    category: "ai",
    title: "Groq",
    subtitle: "Ultra-fast inference for Llama, Mixtral, and Gemma.",
    icon: "\u{1F680}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Groq console and sign in.",
        link: "https://console.groq.com/keys",
        linkLabel: "Groq Console",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("groq", "apiKey"),
        placeholder: "gsk_...",
        type: "secret",
        help: "From console.groq.com.",
      },
    ],
    configCheck: providerCheck("groq", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "openrouter",
    category: "ai",
    title: "OpenRouter",
    subtitle: "Access 200+ models through a single API key.",
    icon: "\u{1F500}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to OpenRouter and sign in.",
        link: "https://openrouter.ai/keys",
        linkLabel: "OpenRouter",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below. You can then pick any model from the OpenRouter catalog." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("openrouter", "apiKey"),
        placeholder: "sk-or-...",
        type: "secret",
        help: "From openrouter.ai/keys.",
      },
    ],
    configCheck: providerCheck("openrouter", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "ollama",
    category: "ai",
    title: "Ollama (Local)",
    subtitle: "Run open-source models locally \u2014 free and private.",
    icon: "\u{1F4BB}",
    difficulty: "moderate",
    timeEstimate: "5 minutes",
    guide: [
      {
        instruction: "Install Ollama on your machine.",
        link: "https://ollama.com/download",
        linkLabel: "Download Ollama",
      },
      { instruction: "Run a model: ollama run llama3.2 (or any model you prefer)." },
      {
        instruction:
          "Ollama serves on localhost:11434 by default \u2014 no API key needed. Just enter the URL below.",
      },
    ],
    fields: [
      {
        label: "Ollama URL",
        path: providerPath("ollama", "baseUrl"),
        placeholder: "http://localhost:11434",
        type: "text",
        help: "Default is http://localhost:11434.",
      },
    ],
    configCheck: providerCheck("ollama", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "custom-provider",
    category: "ai",
    title: "Custom Provider",
    subtitle: "Any OpenAI or Anthropic-compatible API endpoint.",
    icon: "\u{1F527}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      { instruction: "Enter your custom API base URL (must be OpenAI or Anthropic-compatible)." },
      { instruction: "Enter the API key for that endpoint." },
      { instruction: "Click Save Step. Set the model name in Advanced Settings." },
    ],
    fields: [
      {
        label: "Base URL",
        path: providerPath("custom", "baseUrl"),
        placeholder: "https://api.example.com/v1",
        type: "text",
        help: "OpenAI or Anthropic-compatible endpoint.",
      },
      {
        label: "API Key",
        path: providerPath("custom", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "API key for your custom endpoint.",
      },
    ],
    configCheck: providerCheck("custom", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- ChatGPT OAuth (OpenAI Codex) ---
  {
    id: "openai-codex",
    category: "ai",
    title: "ChatGPT Login (OAuth)",
    subtitle: "Use your ChatGPT Plus/Team subscription instead of an API key.",
    icon: "\u{1F513}",
    difficulty: "easy",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Open AI Agents and start the ChatGPT / OpenAI Codex sign-in flow there.",
      },
      {
        instruction: "Sign in with your ChatGPT account and allow access when prompted.",
      },
      { instruction: "Return here after login. EasyClaw will detect the saved OAuth profile." },
    ],
    fields: [],
    infoOnly: true,
    docsLink: "https://docs.openclaw.ai/concepts/oauth",
    configCheck: ["auth", "order", "openai-codex", 0],
    advancedTarget: { tab: "aiAgents" },
  },
  // --- GitHub Copilot ---
  {
    id: "github-copilot",
    category: "ai",
    title: "GitHub Copilot",
    subtitle: "Use your Copilot subscription for completions.",
    icon: "\u{1F4BB}",
    difficulty: "easy",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction:
          "You need an active GitHub Copilot subscription (Individual, Business, or Enterprise).",
        link: "https://github.com/settings/copilot",
        linkLabel: "Copilot Settings",
      },
      {
        instruction:
          "Open AI Agents and start the GitHub device login flow there. GitHub will show a one-time code to authorize.",
      },
      {
        instruction:
          "Return here after login. EasyClaw will detect the Copilot profile automatically.",
      },
    ],
    fields: [],
    infoOnly: true,
    docsLink: "https://docs.openclaw.ai/providers/github-copilot",
    configCheck: ["auth", "order", "github-copilot", 0],
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Copilot Proxy (local VS Code) ---
  {
    id: "copilot-proxy",
    category: "ai",
    title: "Copilot Proxy (Local)",
    subtitle: "Route through your local VS Code Copilot proxy.",
    icon: "\u{1F4E1}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      { instruction: "Make sure VS Code with the GitHub Copilot extension is running." },
      {
        instruction:
          "The Copilot extension exposes a local proxy. Enter its URL below (usually localhost with a dynamic port).",
      },
      { instruction: "Optionally enter the proxy token if required." },
    ],
    fields: [
      {
        label: "Proxy URL",
        path: providerPath("copilot-proxy", "baseUrl"),
        placeholder: "http://localhost:1234",
        type: "text",
        help: "Local VS Code Copilot proxy endpoint.",
      },
      {
        label: "Token",
        path: providerPath("copilot-proxy", "token"),
        placeholder: "",
        type: "secret",
        help: "Optional proxy auth token.",
      },
    ],
    configCheck: providerCheck("copilot-proxy", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Together AI ---
  {
    id: "together",
    category: "ai",
    title: "Together AI",
    subtitle: "Fast inference for Llama, Qwen, DeepSeek, and more.",
    icon: "\u{1F91D}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Together AI dashboard and sign in.",
        link: "https://api.together.xyz/settings/api-keys",
        linkLabel: "Together AI",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below and click Save Step." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("together", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From api.together.xyz.",
      },
    ],
    configCheck: providerCheck("together", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Hugging Face ---
  {
    id: "huggingface",
    category: "ai",
    title: "Hugging Face",
    subtitle: "Inference API for thousands of open models.",
    icon: "\u{1F917}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Hugging Face settings and create an access token.",
        link: "https://huggingface.co/settings/tokens",
        linkLabel: "HF Tokens",
      },
      { instruction: "Copy the token and paste it below." },
    ],
    fields: [
      {
        label: "API Token",
        path: providerPath("huggingface", "apiKey"),
        placeholder: "hf_...",
        type: "secret",
        help: "From huggingface.co/settings/tokens.",
      },
    ],
    configCheck: providerCheck("huggingface", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Venice AI ---
  {
    id: "venice",
    category: "ai",
    title: "Venice AI",
    subtitle: "Privacy-focused AI inference.",
    icon: "\u{1F3AD}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to Venice AI and sign up.",
        link: "https://venice.ai",
        linkLabel: "Venice AI",
      },
      { instruction: "Create an API key from your account settings." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("venice", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From venice.ai account settings.",
      },
    ],
    configCheck: providerCheck("venice", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- LiteLLM ---
  {
    id: "litellm",
    category: "ai",
    title: "LiteLLM Proxy",
    subtitle: "Unified proxy for 100+ LLMs with load balancing.",
    icon: "\u{1F4A1}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      {
        instruction: "Deploy a LiteLLM proxy or use an existing one.",
        link: "https://docs.litellm.ai",
        linkLabel: "LiteLLM Docs",
      },
      { instruction: "Enter the proxy base URL and optional API key below." },
    ],
    fields: [
      {
        label: "Base URL",
        path: providerPath("litellm", "baseUrl"),
        placeholder: "http://localhost:4000",
        type: "text",
        help: "LiteLLM proxy URL.",
      },
      {
        label: "API Key",
        path: providerPath("litellm", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "Optional proxy master key.",
      },
    ],
    configCheck: providerCheck("litellm", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Cloudflare AI Gateway ---
  {
    id: "cloudflare-ai-gateway",
    category: "ai",
    title: "Cloudflare AI Gateway",
    subtitle: "Route AI requests through Cloudflare for caching and analytics.",
    icon: "\u{2601}\u{FE0F}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      {
        instruction: "Go to the Cloudflare dashboard and enable AI Gateway.",
        link: "https://dash.cloudflare.com",
        linkLabel: "Cloudflare Dashboard",
      },
      {
        instruction:
          "Copy your gateway endpoint URL (e.g. https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY_NAME/openai).",
      },
      { instruction: "Enter the URL and your upstream API key below." },
    ],
    fields: [
      {
        label: "Gateway URL",
        path: providerPath("cloudflare-ai-gateway", "baseUrl"),
        placeholder: "https://gateway.ai.cloudflare.com/v1/...",
        type: "text",
        help: "Your Cloudflare AI Gateway endpoint.",
      },
      {
        label: "API Key",
        path: providerPath("cloudflare-ai-gateway", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "Upstream provider API key.",
      },
    ],
    configCheck: providerCheck("cloudflare-ai-gateway", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Vercel AI Gateway ---
  {
    id: "vercel-ai-gateway",
    category: "ai",
    title: "Vercel AI Gateway",
    subtitle: "Unified API gateway from the Vercel AI SDK.",
    icon: "\u{25B2}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Set up Vercel AI Gateway in your Vercel project.",
        link: "https://vercel.com/docs/ai",
        linkLabel: "Vercel AI Docs",
      },
      { instruction: "Copy the gateway endpoint URL." },
      { instruction: "Enter the URL and API key below." },
    ],
    fields: [
      {
        label: "Gateway URL",
        path: providerPath("vercel-ai-gateway", "baseUrl"),
        placeholder: "https://...",
        type: "text",
        help: "Vercel AI Gateway endpoint.",
      },
      {
        label: "API Key",
        path: providerPath("vercel-ai-gateway", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "Gateway API key.",
      },
    ],
    configCheck: providerCheck("vercel-ai-gateway", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- DeepSeek ---
  {
    id: "deepseek",
    category: "ai",
    title: "DeepSeek",
    subtitle: "DeepSeek V3, R1, and Coder models.",
    icon: "\u{1F52D}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the DeepSeek platform and sign in.",
        link: "https://platform.deepseek.com/api_keys",
        linkLabel: "DeepSeek Platform",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("deepseek", "apiKey"),
        placeholder: "sk-...",
        type: "secret",
        help: "From platform.deepseek.com.",
      },
    ],
    configCheck: providerCheck("deepseek", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Volcano Engine (ByteDance) ---
  {
    id: "volcengine",
    category: "ai",
    title: "Volcano Engine",
    subtitle: "ByteDance cloud AI (Doubao, Skylark models).",
    icon: "\u{1F30B}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Go to the Volcano Engine console.",
        link: "https://console.volcengine.com",
        linkLabel: "Volcano Console",
      },
      { instruction: "Navigate to the Model Service and create an API key." },
      { instruction: "Paste the key below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("volcengine", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From Volcano Engine console.",
      },
      {
        label: "Base URL",
        path: providerPath("volcengine", "baseUrl"),
        placeholder: "https://ark.cn-beijing.volces.com/api/v3",
        type: "text",
        help: "Volcano Engine endpoint.",
      },
    ],
    configCheck: providerCheck("volcengine", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- BytePlus (Volcano International) ---
  {
    id: "byteplus",
    category: "ai",
    title: "BytePlus (Intl.)",
    subtitle: "ByteDance international cloud AI endpoint.",
    icon: "\u{1F30F}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Go to the BytePlus console.",
        link: "https://console.byteplus.com",
        linkLabel: "BytePlus Console",
      },
      { instruction: "Create an API key under the model service." },
      { instruction: "Paste the key below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("byteplus", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From BytePlus console.",
      },
      {
        label: "Base URL",
        path: providerPath("byteplus", "baseUrl"),
        placeholder: "https://ark.ap-southeast.bytepluses.com/api/v3",
        type: "text",
        help: "BytePlus international endpoint.",
      },
    ],
    configCheck: providerCheck("byteplus", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Z.AI ---
  {
    id: "zai",
    category: "ai",
    title: "Z.AI (01.ai)",
    subtitle: "Yi models from 01.ai.",
    icon: "\u{1F9E0}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Z.AI platform.",
        link: "https://platform.lingyiwanwu.com",
        linkLabel: "Z.AI Platform",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("zai", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From Z.AI / 01.ai platform.",
      },
    ],
    configCheck: providerCheck("zai", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Alibaba Model Studio (Qwen) ---
  {
    id: "modelstudio",
    category: "ai",
    title: "Alibaba / Qwen",
    subtitle: "Qwen models via Alibaba Cloud Model Studio.",
    icon: "\u{1F3EF}",
    difficulty: "easy",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Go to Alibaba Cloud Model Studio (DashScope).",
        link: "https://dashscope.console.aliyun.com",
        linkLabel: "DashScope Console",
      },
      { instruction: "Create an API key from the dashboard." },
      { instruction: "Paste it below. The default base URL works for most cases." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("modelstudio", "apiKey"),
        placeholder: "sk-...",
        type: "secret",
        help: "From DashScope console.",
      },
      {
        label: "Base URL",
        path: providerPath("modelstudio", "baseUrl"),
        placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        type: "text",
        help: "DashScope OpenAI-compatible endpoint.",
      },
    ],
    configCheck: providerCheck("modelstudio", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Baidu Qianfan ---
  {
    id: "qianfan",
    category: "ai",
    title: "Baidu Qianfan",
    subtitle: "ERNIE and other models from Baidu.",
    icon: "\u{1F43B}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      {
        instruction: "Go to the Baidu Qianfan console.",
        link: "https://console.bce.baidu.com/qianfan",
        linkLabel: "Qianfan Console",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("qianfan", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From Qianfan console.",
      },
    ],
    configCheck: providerCheck("qianfan", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- MiniMax ---
  {
    id: "minimax",
    category: "ai",
    title: "MiniMax",
    subtitle: "MiniMax models (abab series).",
    icon: "\u{1F538}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the MiniMax platform.",
        link: "https://www.minimaxi.com",
        linkLabel: "MiniMax Platform",
      },
      { instruction: "Create an API key from the developer console." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("minimax", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From MiniMax platform.",
      },
    ],
    configCheck: providerCheck("minimax", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Moonshot / Kimi ---
  {
    id: "moonshot",
    category: "ai",
    title: "Moonshot / Kimi",
    subtitle: "Kimi-series models from Moonshot AI.",
    icon: "\u{1F319}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Moonshot AI platform.",
        link: "https://platform.moonshot.cn",
        linkLabel: "Moonshot Platform",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("moonshot", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From platform.moonshot.cn.",
      },
    ],
    configCheck: providerCheck("moonshot", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Xiaomi ---
  {
    id: "xiaomi",
    category: "ai",
    title: "Xiaomi MiLM",
    subtitle: "Xiaomi large language models.",
    icon: "\u{1F4F1}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      { instruction: "Go to the Xiaomi AI developer portal." },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: providerPath("xiaomi", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "From Xiaomi AI developer portal.",
      },
    ],
    configCheck: providerCheck("xiaomi", "apiKey"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Chutes ---
  {
    id: "chutes",
    category: "ai",
    title: "Chutes",
    subtitle: "GPU-optimized inference platform.",
    icon: "\u{1F3BF}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Open AI Agents and start the Chutes OAuth sign-in flow there.",
        link: "https://chutes.ai/docs/sign-in-with-chutes/overview",
        linkLabel: "Chutes OAuth docs",
      },
      { instruction: "Authorize the browser flow when prompted." },
      { instruction: "Return here after login. EasyClaw will detect the saved OAuth profile." },
    ],
    fields: [],
    infoOnly: true,
    configCheck: ["auth", "order", "chutes", 0],
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Synthetic (OpenCode Zen/Go) ---
  {
    id: "opencode",
    category: "ai",
    title: "OpenCode / Synthetic",
    subtitle: "Zen and Go model catalogs.",
    icon: "\u{1F4D6}",
    difficulty: "moderate",
    timeEstimate: "2 minutes",
    guide: [
      { instruction: "Enter the OpenCode API endpoint and key." },
      { instruction: "Select between the Zen and Go catalogs in Advanced Settings." },
    ],
    fields: [
      {
        label: "Base URL",
        path: providerPath("opencode", "baseUrl"),
        placeholder: "https://api.opencode.ai/v1",
        type: "text",
        help: "OpenCode API endpoint.",
      },
      {
        label: "API Key",
        path: providerPath("opencode", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "OpenCode API key.",
      },
    ],
    configCheck: providerCheck("opencode", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },
  // --- Kilo Gateway ---
  {
    id: "kilocode",
    category: "ai",
    title: "Kilo Gateway",
    subtitle: "Self-hosted model routing gateway.",
    icon: "\u{2699}\u{FE0F}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      { instruction: "Deploy a Kilo Gateway instance or use an existing one." },
      { instruction: "Enter the base URL and optional API key below." },
    ],
    fields: [
      {
        label: "Base URL",
        path: providerPath("kilocode", "baseUrl"),
        placeholder: "http://localhost:8080",
        type: "text",
        help: "Kilo Gateway endpoint.",
      },
      {
        label: "API Key",
        path: providerPath("kilocode", "apiKey"),
        placeholder: "",
        type: "secret",
        help: "Optional Kilo API key.",
      },
    ],
    configCheck: providerCheck("kilocode", "baseUrl"),
    advancedTarget: { tab: "aiAgents" },
  },

  // ===== MESSAGING CHANNELS =====
  {
    id: "telegram",
    category: "channels",
    title: "Telegram",
    subtitle: "The fastest way to message your agent and deliver scheduled updates.",
    icon: "\u{1F4AC}",
    difficulty: "easy",
    timeEstimate: "3 minutes",
    guide: [
      {
        instruction: "Open Telegram and search for @BotFather, then start a chat.",
        link: "https://t.me/BotFather",
        linkLabel: "Open @BotFather",
      },
      { instruction: "Send /newbot and follow the prompts to pick a name and username." },
      { instruction: "BotFather replies with a bot token (like 123456:ABC-DEF...). Copy it." },
      {
        instruction:
          "Optional but recommended: find your destination chat ID and set Default Target so cron deliveries and @me resolve automatically.",
      },
      {
        instruction:
          "Paste the token below, click Verify Bot Token to confirm the selected account/bot, then click Auto-detect Target (or enter target manually), then Save Step.",
      },
    ],
    fields: [
      {
        label: "Bot Token",
        path: ["channels", "telegram", "botToken"],
        placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        type: "secret",
        help: "From @BotFather on Telegram.",
      },
      {
        label: "Default Target (optional)",
        path: ["channels", "telegram", "defaultTo"],
        placeholder: "123456789 or -1001234567890:topic:42",
        type: "text",
        help: "Recommended for scheduled delivery. You can set this later in Channels → Telegram.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/telegram",
    configCheck: ["channels", "telegram", "botToken"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "discord",
    category: "channels",
    title: "Discord",
    subtitle: "Add your agent to any Discord server.",
    icon: "\u{1F3AE}",
    difficulty: "easy",
    timeEstimate: "3 minutes",
    guide: [
      {
        instruction: "Go to the Discord Developer Portal and sign in.",
        link: "https://discord.com/developers/applications",
        linkLabel: "Developer Portal",
      },
      { instruction: 'Click "New Application", name it, and Create.' },
      { instruction: 'In the sidebar click "Bot", then "Reset Token" and copy the token.' },
      { instruction: "Paste it below." },
      {
        instruction:
          'To invite the bot: OAuth2 \u2192 URL Generator, check "bot", pick permissions, open the URL.',
      },
    ],
    fields: [
      {
        label: "Bot Token",
        path: ["channels", "discord", "token"],
        placeholder: "MTAxNjQ5...",
        type: "secret",
        help: "From discord.com/developers \u2192 Bot \u2192 Token.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/discord",
    configCheck: ["channels", "discord", "token"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "whatsapp",
    category: "channels",
    title: "WhatsApp",
    subtitle: "Scan a QR code \u2014 no tokens or APIs needed.",
    icon: "\u{1F4F1}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      { instruction: "Make sure WhatsApp is installed on your phone with an active account." },
      { instruction: 'Click "Show QR" below to start secure pairing.' },
      {
        instruction:
          "On your phone: WhatsApp \u2192 Settings \u2192 Linked Devices \u2192 Link a Device, scan the code.",
      },
      { instruction: "Done! The connection is automatic." },
    ],
    fields: [],
    docsLink: "https://docs.openclaw.ai/channels/whatsapp",
    advancedTarget: { tab: "channels" },
  },
  {
    id: "slack",
    category: "channels",
    title: "Slack",
    subtitle: "Connect via Socket Mode (no public URL needed).",
    icon: "\u{1F4BC}",
    difficulty: "moderate",
    timeEstimate: "5 minutes",
    guide: [
      {
        instruction:
          'Go to the Slack API portal, click "Create New App" \u2192 "From scratch", pick your workspace.',
        link: "https://api.slack.com/apps",
        linkLabel: "Slack API",
      },
      {
        instruction:
          'Enable "Socket Mode". Create an App-Level Token with scope connections:write. Copy the token (xapp-...).',
      },
      { instruction: "Paste the App Token below." },
      {
        instruction:
          'Go to "OAuth & Permissions", add bot scopes (chat:write, app_mentions:read, im:history, im:read, im:write), install to workspace, copy the Bot Token (xoxb-...).',
      },
      { instruction: "Paste the Bot Token below and click Save Step." },
    ],
    fields: [
      {
        label: "App Token",
        path: ["channels", "slack", "appToken"],
        placeholder: "xapp-1-...",
        type: "secret",
        help: "Socket Mode app-level token.",
      },
      {
        label: "Bot Token",
        path: ["channels", "slack", "botToken"],
        placeholder: "xoxb-...",
        type: "secret",
        help: "Bot User OAuth Token.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/slack",
    configCheck: ["channels", "slack", "botToken"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "signal",
    category: "channels",
    title: "Signal",
    subtitle: "Private messaging via signal-cli.",
    icon: "\u{1F510}",
    difficulty: "moderate",
    timeEstimate: "5 minutes",
    guide: [
      {
        instruction: "Install signal-cli on the machine running OpenClaw.",
        link: "https://github.com/AsamK/signal-cli",
        linkLabel: "signal-cli",
      },
      {
        instruction:
          'Register or link a phone number with signal-cli (use the "link" command if you already have Signal on your phone).',
      },
      { instruction: "Enter the phone number with country code below." },
    ],
    fields: [
      {
        label: "Signal Account",
        path: ["channels", "signal", "account"],
        placeholder: "+1234567890",
        type: "text",
        help: "Signal account identifier (E.164 phone number or UUID).",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/signal",
    configCheck: ["channels", "signal", "account"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "imessage",
    category: "channels",
    title: "iMessage",
    subtitle: "Chat with your agent from iMessage (macOS only).",
    icon: "\u{1F34E}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      { instruction: "This requires macOS with Messages.app signed into your Apple ID." },
      {
        instruction:
          "OpenClaw uses AppleScript to read and send iMessages. Enable Full Disk Access for the gateway process in System Settings \u2192 Privacy.",
      },
      { instruction: "Enable the iMessage channel in Advanced Settings and click Save Step." },
    ],
    fields: [
      {
        label: "Enabled",
        path: ["channels", "imessage", "enabled"],
        placeholder: "",
        type: "select",
        options: [
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ],
        help: "Requires macOS with Messages.app.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/imessage",
    configCheck: ["channels", "imessage", "enabled"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "google-chat",
    category: "channels",
    title: "Google Chat",
    subtitle: "Connect to Google Workspace Chat.",
    icon: "\u{1F4E8}",
    difficulty: "moderate",
    timeEstimate: "10 minutes",
    guide: [
      {
        instruction: "Create a Google Cloud project and enable the Google Chat API.",
        link: "https://console.cloud.google.com/apis/library/chat.googleapis.com",
        linkLabel: "GCP Console",
      },
      {
        instruction:
          "Configure a Chat App in the Google Chat API settings with your gateway webhook URL.",
      },
      { instruction: "Create a service account key and paste the credentials below." },
    ],
    fields: [
      {
        label: "Service Account JSON",
        path: ["channels", "googlechat", "credentials"],
        placeholder: '{"type":"service_account",...}',
        type: "secret",
        help: "Service account key JSON from GCP.",
      },
    ],
    docsLink: "https://docs.openclaw.ai/channels/google-chat",
    configCheck: ["channels", "googlechat", "credentials"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "msteams",
    category: "channels",
    title: "Microsoft Teams",
    subtitle: "Deploy your agent as a Teams bot (extension plugin).",
    icon: "\u{1F4CD}",
    difficulty: "advanced",
    timeEstimate: "15 minutes",
    guide: [
      { instruction: "Install the MS Teams extension: openclaw plugin install @openclaw/msteams" },
      {
        instruction: "Register a bot in the Azure Bot Service portal.",
        link: "https://portal.azure.com/#create/Microsoft.AzureBot",
        linkLabel: "Azure Portal",
      },
      { instruction: "Copy the App ID and App Secret from Azure, paste them below." },
      { instruction: "Upload the Teams app manifest to your Teams organization." },
    ],
    fields: [
      {
        label: "App ID",
        path: ["channels", "msteams", "appId"],
        placeholder: "",
        type: "text",
        help: "Azure Bot registration App ID.",
      },
      {
        label: "App Secret",
        path: ["channels", "msteams", "appSecret"],
        placeholder: "",
        type: "secret",
        help: "Azure Bot registration secret.",
      },
    ],
    configCheck: ["channels", "msteams", "appId"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "matrix",
    category: "channels",
    title: "Matrix",
    subtitle: "Decentralized chat via Matrix/Element (extension plugin).",
    icon: "\u{1F30D}",
    difficulty: "moderate",
    timeEstimate: "5 minutes",
    guide: [
      { instruction: "Install the Matrix extension: openclaw plugin install @openclaw/matrix" },
      { instruction: "Create a Matrix account for your bot on any homeserver (e.g. matrix.org)." },
      { instruction: "Enter the homeserver URL, user ID, and access token below." },
    ],
    fields: [
      {
        label: "Homeserver",
        path: ["channels", "matrix", "homeserver"],
        placeholder: "https://matrix.org",
        type: "text",
      },
      {
        label: "User ID",
        path: ["channels", "matrix", "userId"],
        placeholder: "@bot:matrix.org",
        type: "text",
      },
      {
        label: "Access Token",
        path: ["channels", "matrix", "accessToken"],
        placeholder: "",
        type: "secret",
      },
    ],
    configCheck: ["channels", "matrix", "accessToken"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "nostr",
    category: "channels",
    title: "Nostr",
    subtitle: "Decentralized social protocol (extension plugin).",
    icon: "\u{1F4E1}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      { instruction: "Install the Nostr extension: openclaw plugin install @openclaw/nostr" },
      { instruction: "Generate or use an existing Nostr private key (nsec). Keep it safe!" },
      {
        instruction: "Paste your nsec below. Your public key (npub) will be derived automatically.",
      },
    ],
    fields: [
      {
        label: "Private Key (nsec)",
        path: ["channels", "nostr", "nsec"],
        placeholder: "nsec1...",
        type: "secret",
        help: "Your Nostr identity private key.",
      },
    ],
    configCheck: ["channels", "nostr", "nsec"],
    advancedTarget: { tab: "channels" },
  },
  {
    id: "irc",
    category: "channels",
    title: "IRC",
    subtitle: "Classic Internet Relay Chat.",
    icon: "\u{1F4DF}",
    difficulty: "moderate",
    timeEstimate: "3 minutes",
    guide: [
      { instruction: "Enter the IRC server address and port." },
      { instruction: "Choose a nickname for the bot and optionally a channel to auto-join." },
    ],
    fields: [
      {
        label: "Server",
        path: ["channels", "irc", "server"],
        placeholder: "irc.libera.chat",
        type: "text",
      },
      { label: "Port", path: ["channels", "irc", "port"], placeholder: "6697", type: "text" },
      { label: "Nickname", path: ["channels", "irc", "nick"], placeholder: "mybot", type: "text" },
    ],
    configCheck: ["channels", "irc", "server"],
    advancedTarget: { tab: "channels" },
  },

  // ===== WEB SEARCH =====
  {
    id: "brave-search",
    category: "search",
    title: "Brave Search",
    subtitle: "Privacy-focused web search for your agent.",
    icon: "\u{1F981}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Brave Search API portal and sign up.",
        link: "https://brave.com/search/api/",
        linkLabel: "Brave Search API",
      },
      { instruction: "Create an API key from the dashboard." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: ["tools", "web", "search", "apiKey"],
        placeholder: "BSA...",
        type: "secret",
        help: "From brave.com/search/api.",
      },
    ],
    configCheck: ["tools", "web", "search", "apiKey"],
    advancedTarget: { tab: "infrastructure" },
  },
  {
    id: "perplexity-search",
    category: "search",
    title: "Perplexity",
    subtitle: "AI-powered web search with citations.",
    icon: "\u{1F50D}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      {
        instruction: "Go to the Perplexity API settings.",
        link: "https://www.perplexity.ai/settings/api",
        linkLabel: "Perplexity API",
      },
      { instruction: "Create an API key and copy it." },
      { instruction: "Paste it below." },
    ],
    fields: [
      {
        label: "API Key",
        path: ["tools", "web", "search", "perplexity", "apiKey"],
        placeholder: "pplx-...",
        type: "secret",
        help: "From perplexity.ai/settings/api.",
      },
    ],
    configCheck: ["tools", "web", "search", "perplexity", "apiKey"],
    advancedTarget: { tab: "infrastructure" },
  },
  {
    id: "gemini-search",
    category: "search",
    title: "Gemini Search",
    subtitle: "Google Gemini grounding with Search.",
    icon: "\u{1F535}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      { instruction: "Use the same Gemini API key from the AI Providers section above." },
      {
        instruction:
          "Gemini Search grounding is enabled automatically when a Gemini key is configured.",
      },
      {
        instruction:
          "Enter the key below if you want it specifically for search, or skip if already set.",
      },
    ],
    fields: [
      {
        label: "API Key",
        path: ["tools", "web", "search", "gemini", "apiKey"],
        placeholder: "AI...",
        type: "secret",
        help: "Same key from aistudio.google.com.",
      },
    ],
    configCheck: ["tools", "web", "search", "gemini", "apiKey"],
    advancedTarget: { tab: "infrastructure" },
  },
  {
    id: "grok-search",
    category: "search",
    title: "Grok Search",
    subtitle: "xAI Grok live web search grounding.",
    icon: "\u{26A1}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      { instruction: "Use the same xAI API key from the AI Providers section above." },
      {
        instruction:
          "Grok search grounding is enabled automatically when an xAI key is configured.",
      },
      {
        instruction:
          "Enter the key below if you want it specifically for search, or skip if already set.",
      },
    ],
    fields: [
      {
        label: "API Key",
        path: ["tools", "web", "search", "grok", "apiKey"],
        placeholder: "xai-...",
        type: "secret",
        help: "Same key from console.x.ai.",
      },
    ],
    configCheck: ["tools", "web", "search", "grok", "apiKey"],
    advancedTarget: { tab: "infrastructure" },
  },
  {
    id: "kimi-search",
    category: "search",
    title: "Kimi Search",
    subtitle: "Moonshot Kimi web search grounding.",
    icon: "\u{1F319}",
    difficulty: "easy",
    timeEstimate: "1 minute",
    guide: [
      { instruction: "Use the same Moonshot API key from the AI Providers section above." },
      { instruction: "Kimi search is enabled when a Moonshot key is configured." },
      {
        instruction:
          "Enter the key below if you want it specifically for search, or skip if already set.",
      },
    ],
    fields: [
      {
        label: "API Key",
        path: ["tools", "web", "search", "kimi", "apiKey"],
        placeholder: "",
        type: "secret",
        help: "Same key from platform.moonshot.cn.",
      },
    ],
    configCheck: ["tools", "web", "search", "kimi", "apiKey"],
    advancedTarget: { tab: "infrastructure" },
  },

  // ===== FEATURES & TOOLS =====
  {
    id: "gmail-hook",
    category: "features",
    title: "Gmail Hook",
    subtitle: "Trigger agents on incoming email via Google Cloud Pub/Sub.",
    icon: "\u{1F4E7}",
    difficulty: "advanced",
    timeEstimate: "15\u201320 minutes",
    guide: [
      {
        instruction: "Create a Google Cloud project and enable the Gmail API + Pub/Sub API.",
        link: "https://console.cloud.google.com/apis/library",
        linkLabel: "GCP Console",
      },
      {
        instruction:
          'Go to Pub/Sub \u2192 Topics, create a topic (e.g. "gmail-push"). Note the full path.',
      },
      {
        instruction:
          "Grant publish permissions to gmail-api-push@system.gserviceaccount.com on that topic.",
      },
      {
        instruction:
          "Create a subscription pointing to your OpenClaw gateway's webhook endpoint with a shared secret.",
      },
      { instruction: "Fill in the fields below, then Save Step." },
    ],
    fields: [
      {
        label: "Gmail Account",
        path: ["hooks", "gmail", "account"],
        placeholder: "automation@example.com",
        type: "text",
      },
      {
        label: "Pub/Sub Topic",
        path: ["hooks", "gmail", "topic"],
        placeholder: "projects/my-project/topics/gmail-push",
        type: "text",
      },
      {
        label: "Push Token",
        path: ["hooks", "gmail", "pushToken"],
        placeholder: "",
        type: "secret",
      },
    ],
    docsLink: "https://docs.openclaw.ai/automation/hooks",
    configCheck: ["hooks", "gmail", "account"],
    advancedTarget: { tab: "automation" },
  },
  {
    id: "memory",
    category: "features",
    title: "Memory",
    subtitle: "Let your agent remember context across conversations.",
    icon: "\u{1F4BE}",
    difficulty: "easy",
    timeEstimate: "30 seconds",
    guide: [
      { instruction: 'Toggle Memory to "Enabled" below.' },
      { instruction: "Click Save Step. No other setup needed." },
    ],
    fields: [
      {
        label: "Memory",
        path: ["memory", "enabled"],
        placeholder: "",
        type: "select",
        options: [
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ],
      },
    ],
    docsLink: "https://docs.openclaw.ai/configuration#memory",
    configCheck: ["memory", "enabled"],
    advancedTarget: { tab: "aiAgents" },
  },
  {
    id: "web-tools",
    category: "features",
    title: "Web Browsing",
    subtitle: "Let your agent fetch and browse the web.",
    icon: "\u{1F310}",
    difficulty: "easy",
    timeEstimate: "30 seconds",
    guide: [
      { instruction: 'Toggle Web to "Enabled" below.' },
      { instruction: "Click Save Step. No other setup needed." },
    ],
    fields: [
      {
        label: "Web",
        path: ["web", "enabled"],
        placeholder: "",
        type: "select",
        options: [
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ],
      },
    ],
    docsLink: "https://docs.openclaw.ai/configuration#web",
    configCheck: ["web", "enabled"],
    advancedTarget: { tab: "infrastructure" },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readConfigValue(
  form: Record<string, unknown> | null,
  path: Array<string | number>,
): string {
  if (!form) {
    return "";
  }
  let cursor: unknown = form;
  for (const segment of path) {
    if (cursor == null || typeof cursor !== "object") {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  if (cursor == null) {
    return "";
  }
  if (typeof cursor === "string") {
    return cursor;
  }
  if (typeof cursor === "number" || typeof cursor === "boolean" || typeof cursor === "bigint") {
    return `${cursor}`;
  }
  return "";
}

function readConfigObject(
  form: Record<string, unknown> | null,
  path: Array<string | number>,
): Record<string, unknown> | null {
  if (!form) {
    return null;
  }
  let cursor: unknown = form;
  for (const segment of path) {
    if (cursor == null || typeof cursor !== "object") {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
    return null;
  }
  return cursor as Record<string, unknown>;
}

function readObjectStringValue(record: Record<string, unknown> | null, key: string): string {
  if (!record) {
    return "";
  }
  const value = record[key];
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${value}`;
  }
  return "";
}

function normalizeOnboardingAccountId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "")
    .slice(0, 64);
}

const TELEGRAM_TOKEN_DASH_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

function normalizeTelegramBotTokenForOnboarding(raw: string): string {
  return raw.replace(TELEGRAM_TOKEN_DASH_RE, "-").replace(/\s+/g, "").trim();
}

function isRedactedToken(raw: string): boolean {
  return raw.trim() === REDACTED_SENTINEL;
}

function looksLikeTelegramBotToken(raw: string): boolean {
  const token = normalizeTelegramBotTokenForOnboarding(raw);
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

function findNormalizedAccountObject(
  accounts: Record<string, unknown> | null,
  normalizedAccountId: string,
): Record<string, unknown> | null {
  if (!accounts || !normalizedAccountId) {
    return null;
  }
  const direct = asObject(accounts[normalizedAccountId]);
  if (direct) {
    return direct;
  }
  for (const [key, value] of Object.entries(accounts)) {
    if (normalizeOnboardingAccountId(key) === normalizedAccountId) {
      return asObject(value);
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isStepConfigured(form: Record<string, unknown> | null, step: OnboardingStep): boolean {
  if (!step.configCheck) {
    return false;
  }
  const val = readConfigValue(form, step.configCheck);
  return val !== "" && val !== "false" && val !== "undefined";
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderOnboarding(state: AppViewState): unknown {
  const form = state.configForm ?? null;
  const currentStepId = state.onboardingStep;

  // If no step selected, show the overview/checklist
  if (!currentStepId) {
    return renderOnboardingOverview(state, form);
  }

  const step = ONBOARDING_STEPS.find((s) => s.id === currentStepId);
  if (!step) {
    return renderOnboardingOverview(state, form);
  }

  return renderOnboardingStepDetail(state, form, step);
}

// ---------------------------------------------------------------------------
// Overview (checklist)
// ---------------------------------------------------------------------------

function renderStepCard(
  state: AppViewState,
  form: Record<string, unknown> | null,
  step: OnboardingStep,
): unknown {
  const done = isStepConfigured(form, step);
  return html`
    <button
      class="onboarding__card ${done ? "onboarding__card--done" : "onboarding__card--pending"}"
      @click=${() => {
        state.onboardingStep = step.id;
      }}
    >
      <div class="onboarding__card-icon">${step.icon}</div>
      <div class="onboarding__card-body">
        <div class="onboarding__card-title-row">
          <span class="onboarding__card-title">${step.title}</span>
              ${
                done
                  ? html`
                      <span class="onboarding__card-status onboarding__card-status--ready">\u2713 Added</span>
                    `
                  : html`
                      <span class="onboarding__card-status onboarding__card-status--setup">Set up</span>
                    `
              }
        </div>
        <div class="onboarding__card-subtitle">${step.subtitle}</div>
        <div class="onboarding__card-meta">
          ${
            done
              ? html`
                  <span class="onboarding__card-meta--ready">Credential saved</span>
                `
              : html`<span>${step.timeEstimate} \u00B7 ${step.difficulty}</span>`
          }
        </div>
      </div>
    </button>
  `;
}

function renderOnboardingOverview(
  state: AppViewState,
  form: Record<string, unknown> | null,
): unknown {
  const configuredCount = ONBOARDING_STEPS.filter((s) => isStepConfigured(form, s)).length;
  const totalSteps = ONBOARDING_STEPS.length;
  const pct = totalSteps > 0 ? Math.round((configuredCount / totalSteps) * 100) : 0;

  const categories: OnboardingCategory[] = ["ai", "channels", "search", "features"];

  // Collect all configured AI providers for the quick-pick strip
  const readyAiSteps = ONBOARDING_STEPS.filter(
    (s) => s.category === "ai" && isStepConfigured(form, s),
  );

  return html`
    <div class="onboarding">
      <div class="onboarding__hero">
        <div class="onboarding__hero-text">
          <h2 class="onboarding__headline">Welcome to EasyClaw</h2>
          <p class="onboarding__tagline">
            Set up your AI agent step by step. Each card walks you through
            exactly what to do \u2014 no terminal needed.
          </p>
        </div>
        <div class="onboarding__progress">
          <div class="onboarding__progress-bar">
            <div
              class="onboarding__progress-fill"
              style="width: ${pct}%"
            ></div>
          </div>
          <span class="onboarding__progress-label"
            >${configuredCount} / ${totalSteps} saved</span
          >
        </div>
      </div>

      <!-- Ready-to-use providers strip -->
      ${
        readyAiSteps.length > 0
          ? html`
          <div class="onboarding__ready-strip">
            <div class="onboarding__ready-strip-header">
              <span class="onboarding__ready-strip-dot"></span>
              <span class="onboarding__ready-strip-title">Credentials saved</span>
              <span class="onboarding__ready-strip-count">${readyAiSteps.length} provider credential${readyAiSteps.length === 1 ? "" : "s"} saved</span>
            </div>
            <div class="onboarding__ready-strip-chips">
              ${readyAiSteps.map(
                (step) => html`
                  <button
                    class="onboarding__ready-chip"
                    @click=${() => {
                      state.onboardingStep = step.id;
                    }}
                  >
                    <span class="onboarding__ready-chip-icon">${step.icon}</span>
                    <span class="onboarding__ready-chip-label">${step.title}</span>
                    <span class="onboarding__ready-chip-check">\u2713</span>
                  </button>
                `,
              )}
            </div>
          </div>
        `
          : html`
              <div class="onboarding__ready-strip onboarding__ready-strip--empty">
                <div class="onboarding__ready-strip-header">
                  <span class="onboarding__ready-strip-title">No AI credentials saved yet</span>
                </div>
                <p class="onboarding__ready-strip-hint">
                  Set up at least one AI provider below to get your agent thinking.
                </p>
              </div>
            `
      }

      ${categories.map((cat) => {
        const meta = CATEGORY_META[cat];
        const steps = ONBOARDING_STEPS.filter((s) => s.category === cat);
        if (steps.length === 0) {
          return nothing;
        }
        const catConfigured = steps.filter((s) => isStepConfigured(form, s)).length;
        // Show configured first, then pending
        const sortedSteps = [
          ...steps.filter((s) => isStepConfigured(form, s)),
          ...steps.filter((s) => !isStepConfigured(form, s)),
        ];
        return html`
          <section class="onboarding__section">
            <div class="onboarding__section-header">
              <div>
                <h3 class="onboarding__section-title">${meta.label}</h3>
                <p class="onboarding__section-desc">${meta.description}</p>
              </div>
              <span class="onboarding__section-count"
                >${catConfigured} / ${steps.length}</span
              >
            </div>
            <div class="onboarding__grid">
              ${sortedSteps.map((step) => renderStepCard(state, form, step))}
            </div>
          </section>
        `;
      })}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Step detail
// ---------------------------------------------------------------------------

function renderOnboardingStepDetail(
  state: AppViewState,
  form: Record<string, unknown> | null,
  step: OnboardingStep,
): unknown {
  const telegramAutoDetectConnectorId = "channel:telegram:auto-default-target";
  const telegramVerifyConnectorId = "channel:telegram:verify-token";
  const slackVerifyConnectorId = "channel:slack:verify-credentials";
  const discordVerifyConnectorId = "channel:discord:verify-token";
  const signalVerifyConnectorId = "channel:signal:verify-transport";
  const telegramAccountIdDraftKey = "onboarding.telegram.accountId";
  const telegramAccountTokenDraftKey = "onboarding.telegram.accountBotToken";
  const telegramAccountTargetDraftKey = "onboarding.telegram.accountDefaultTo";
  const telegramAccountStatusKey = "onboarding.telegram.accountStatus";
  const done = isStepConfigured(form, step);
  const configReady = Boolean(state.configSnapshot?.hash);
  const configLoading = state.configLoading || state.configSchemaLoading;
  const saveDisabled = !state.configFormDirty || state.configSaving || configLoading;
  const applyDisabled = !state.configFormDirty || state.configApplying || configLoading;
  const isTelegramStep = step.id === "telegram";
  const isSlackStep = step.id === "slack";
  const isDiscordStep = step.id === "discord";
  const isSignalStep = step.id === "signal";
  const isWhatsAppStep = step.id === "whatsapp";
  const showInlineSetup = step.fields.length > 0 || isWhatsAppStep;
  const telegramBotToken = isTelegramStep
    ? readConfigValue(form, ["channels", "telegram", "botToken"]).trim()
    : "";
  const telegramAccountIdDraft = isTelegramStep
    ? (state.builderSetupInputs[telegramAccountIdDraftKey] ?? "").trim()
    : "";
  const telegramAccountId = isTelegramStep
    ? normalizeOnboardingAccountId(telegramAccountIdDraft)
    : "";
  const telegramAccountTokenDraft = isTelegramStep
    ? (state.builderSetupInputs[telegramAccountTokenDraftKey] ?? "")
    : "";
  const telegramAccountToken = isTelegramStep
    ? normalizeTelegramBotTokenForOnboarding(telegramAccountTokenDraft)
    : "";
  const telegramAccountTargetDraft = isTelegramStep
    ? (state.builderSetupInputs[telegramAccountTargetDraftKey] ?? "")
    : "";
  const telegramAccountStatus = isTelegramStep
    ? (state.builderSetupInputs[telegramAccountStatusKey] ?? "").trim()
    : "";
  const telegramDefaultAccountId = isTelegramStep
    ? normalizeOnboardingAccountId(
        readConfigValue(form, ["channels", "telegram", "defaultAccount"]),
      ) || "default"
    : "default";
  const telegramAccountsRecord = isTelegramStep
    ? readConfigObject(form, ["channels", "telegram", "accounts"])
    : null;
  const telegramKnownAccountIds = isTelegramStep
    ? Array.from(
        new Set([
          "default",
          ...Object.keys(telegramAccountsRecord ?? {})
            .map((accountId) => normalizeOnboardingAccountId(accountId))
            .filter(Boolean),
        ]),
      ).toSorted((a, b) => a.localeCompare(b))
    : [];
  const telegramSelectedAccountId = telegramAccountId || telegramDefaultAccountId;
  const telegramSelectedAccountConfig =
    isTelegramStep && telegramSelectedAccountId !== "default"
      ? findNormalizedAccountObject(telegramAccountsRecord, telegramSelectedAccountId)
      : null;
  const telegramSelectedTokenRawFromConfig = isTelegramStep
    ? telegramSelectedAccountId === "default"
      ? telegramBotToken
      : readObjectStringValue(telegramSelectedAccountConfig, "botToken")
    : "";
  const telegramSelectedTokenFromConfig = isTelegramStep
    ? normalizeTelegramBotTokenForOnboarding(telegramSelectedTokenRawFromConfig)
    : "";
  const telegramSelectedTokenFromConfigIsRedacted =
    isTelegramStep && isRedactedToken(telegramSelectedTokenRawFromConfig);
  const telegramDraftAccountConfig =
    isTelegramStep && telegramAccountId
      ? findNormalizedAccountObject(telegramAccountsRecord, telegramAccountId)
      : null;
  const telegramSavedAccountTokenRaw = isTelegramStep
    ? readObjectStringValue(telegramDraftAccountConfig, "botToken")
    : "";
  const telegramSavedAccountToken = isTelegramStep
    ? normalizeTelegramBotTokenForOnboarding(telegramSavedAccountTokenRaw)
    : "";
  const telegramSavedAccountTokenIsRedacted =
    isTelegramStep && isRedactedToken(telegramSavedAccountTokenRaw);
  const telegramAccountIdInvalid =
    isTelegramStep && telegramAccountIdDraft.length > 0 && !telegramAccountId;
  const telegramAccountTokenInvalid =
    isTelegramStep &&
    telegramAccountId.length > 0 &&
    telegramAccountTokenDraft.trim().length > 0 &&
    !looksLikeTelegramBotToken(telegramAccountToken);
  const telegramAutoDetectRunning =
    state.builderSetupRunningConnectorId === telegramAutoDetectConnectorId;
  const telegramVerifyRunning = state.builderSetupRunningConnectorId === telegramVerifyConnectorId;
  const telegramActionTokenPresent = telegramAccountId
    ? Boolean(
        telegramAccountToken || telegramSavedAccountToken || telegramSavedAccountTokenIsRedacted,
      )
    : Boolean(telegramSelectedTokenFromConfig || telegramSelectedTokenFromConfigIsRedacted);
  const telegramSelectedTokenPath =
    telegramSelectedAccountId === "default"
      ? "channels.telegram.botToken"
      : `channels.telegram.accounts.${telegramSelectedAccountId}.botToken`;
  const telegramActionsUsingDraftToken =
    isTelegramStep && Boolean(telegramAccountId && telegramAccountToken);
  const telegramMainFieldOffTarget =
    isTelegramStep && telegramSelectedAccountId !== "default" && !telegramAccountId;
  const telegramAutoDetectDisabled =
    !isTelegramStep ||
    !telegramActionTokenPresent ||
    telegramAccountIdInvalid ||
    telegramAccountTokenInvalid ||
    telegramAutoDetectRunning ||
    telegramVerifyRunning ||
    configLoading ||
    state.configSaving;
  const telegramVerifyDisabled =
    !isTelegramStep ||
    !telegramActionTokenPresent ||
    telegramAccountIdInvalid ||
    telegramAccountTokenInvalid ||
    telegramVerifyRunning ||
    telegramAutoDetectRunning ||
    configLoading ||
    state.configSaving;
  const telegramAutoDetectResult =
    isTelegramStep &&
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === telegramAutoDetectConnectorId ||
      state.builderSetupResult.connectorId.startsWith(`${telegramAutoDetectConnectorId}:`))
      ? state.builderSetupResult
      : null;
  const telegramVerifyResult =
    isTelegramStep &&
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === telegramVerifyConnectorId ||
      state.builderSetupResult.connectorId.startsWith(`${telegramVerifyConnectorId}:`))
      ? state.builderSetupResult
      : null;
  const telegramSetupError =
    isTelegramStep &&
    !telegramAutoDetectRunning &&
    !telegramVerifyRunning &&
    state.builderSetupError &&
    !telegramAutoDetectResult &&
    !telegramVerifyResult
      ? state.builderSetupError
      : null;
  const slackVerifyRunning =
    isSlackStep && state.builderSetupRunningConnectorId === slackVerifyConnectorId;
  const discordVerifyRunning =
    isDiscordStep && state.builderSetupRunningConnectorId === discordVerifyConnectorId;
  const signalVerifyRunning =
    isSignalStep && state.builderSetupRunningConnectorId === signalVerifyConnectorId;
  const slackVerifyResult =
    isSlackStep &&
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === slackVerifyConnectorId ||
      state.builderSetupResult.connectorId.startsWith(`${slackVerifyConnectorId}:`))
      ? state.builderSetupResult
      : null;
  const discordVerifyResult =
    isDiscordStep &&
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === discordVerifyConnectorId ||
      state.builderSetupResult.connectorId.startsWith(`${discordVerifyConnectorId}:`))
      ? state.builderSetupResult
      : null;
  const signalVerifyResult =
    isSignalStep &&
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === signalVerifyConnectorId ||
      state.builderSetupResult.connectorId.startsWith(`${signalVerifyConnectorId}:`))
      ? state.builderSetupResult
      : null;
  const slackSetupError =
    isSlackStep && !slackVerifyRunning && state.builderSetupError && !slackVerifyResult
      ? state.builderSetupError
      : null;
  const discordSetupError =
    isDiscordStep && !discordVerifyRunning && state.builderSetupError && !discordVerifyResult
      ? state.builderSetupError
      : null;
  const signalSetupError =
    isSignalStep && !signalVerifyRunning && state.builderSetupError && !signalVerifyResult
      ? state.builderSetupError
      : null;
  const connectorVerifyDisabled =
    !showInlineSetup || configLoading || state.configSaving || state.configApplying;
  const telegramCreateOrUpdateAccountDisabled =
    !isTelegramStep ||
    !telegramAccountId ||
    !telegramAccountToken ||
    telegramAccountTokenInvalid ||
    telegramAccountIdInvalid ||
    state.configSaving ||
    configLoading;
  const telegramSetDefaultAccountDisabled =
    !isTelegramStep ||
    !telegramAccountId ||
    telegramAccountIdInvalid ||
    telegramDefaultAccountId === telegramAccountId ||
    state.configSaving ||
    configLoading;
  const telegramCreateOrUpdateMissingFields =
    isTelegramStep &&
    (telegramAccountIdDraft.length > 0 ||
      telegramAccountTokenDraft.trim().length > 0 ||
      telegramAccountTargetDraft.trim().length > 0) &&
    (!telegramAccountId || !telegramAccountToken);
  const diffLabel =
    step.difficulty === "easy" ? "Easy" : step.difficulty === "moderate" ? "Moderate" : "Advanced";
  const advancedTitle = step.advancedTarget ? titleForTab(step.advancedTarget.tab) : "Settings";

  // Find index for prev/next
  const idx = ONBOARDING_STEPS.findIndex((s) => s.id === step.id);
  const prevStep = idx > 0 ? ONBOARDING_STEPS[idx - 1] : null;
  const nextStep = idx < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[idx + 1] : null;

  return html`
    <div class="onboarding">
      <!-- Breadcrumb nav -->
      <div class="onboarding__breadcrumb">
        <button
          class="onboarding__back"
          @click=${() => {
            state.onboardingStep = null;
          }}
        >
          \u2190 All Steps
        </button>
        <span class="onboarding__step-pos">
          Step ${idx + 1} of ${ONBOARDING_STEPS.length}
        </span>
      </div>

      <!-- Step card -->
      <div class="onboarding__detail">
        <div class="onboarding__detail-header">
          <div class="onboarding__detail-icon">${step.icon}</div>
          <div>
            <div class="onboarding__detail-title-row">
              <h2 class="onboarding__detail-title">${step.title}</h2>
              <span class="onboarding__card-badge onboarding__card-badge--${step.difficulty}"
                >${diffLabel}</span
              >
              <span class="onboarding__detail-time">${step.timeEstimate}</span>
              ${
                done
                  ? html`
                      <span class="onboarding__detail-done">\u2713 Saved</span>
                    `
                  : nothing
              }
            </div>
            <p class="onboarding__detail-subtitle">${step.subtitle}</p>
          </div>
        </div>

        <!-- Guide -->
        ${
          step.guide.length > 0
            ? html`
                <div class="onboarding__guide">
                  <div class="onboarding__guide-title">How to set up</div>
                  <ol class="onboarding__steps">
                    ${step.guide.map(
                      (g) => html`
                        <li class="onboarding__step-item">
                          <span>${g.instruction}</span>
                          ${
                            g.link
                              ? html`<a
                                  class="onboarding__step-link"
                                  href=${g.link}
                                  target="_blank"
                                  rel="noopener"
                                  >${g.linkLabel ?? "Open"}</a
                                >`
                              : nothing
                          }
                        </li>
                      `,
                    )}
                  </ol>
                </div>
              `
            : nothing
        }

        <!-- Fields -->
        ${
          showInlineSetup
            ? html`
                ${
                  step.fields.length > 0
                    ? html`
                        <div class="onboarding__fields">
                          ${step.fields.map((field) => {
                            const value = readConfigValue(form, field.path);
                            return html`
                              <label class="onboarding__field">
                                <span class="onboarding__field-label">${field.label}</span>
                                ${
                                  field.type === "select" && field.options
                                    ? html`
                                        <select
                                          class="onboarding__input"
                                          .value=${value || ""}
                                          @change=${(e: Event) => {
                                            const val = (e.target as HTMLSelectElement).value;
                                            updateConfigFormValue(
                                              state as Parameters<typeof updateConfigFormValue>[0],
                                              field.path,
                                              val === "true" ? true : val === "false" ? false : val,
                                            );
                                          }}
                                        >
                                          <option value="">\u2014 select \u2014</option>
                                          ${field.options.map(
                                            (opt) =>
                                              html`<option
                                                value=${opt.value}
                                                ?selected=${value === opt.value}
                                              >
                                                ${opt.label}
                                              </option>`,
                                          )}
                                        </select>
                                      `
                                    : html`
                                        <input
                                          class="onboarding__input"
                                          type=${field.type === "secret" ? "password" : "text"}
                                          .value=${value}
                                          placeholder=${field.placeholder}
                                          @input=${(e: Event) => {
                                            updateConfigFormValue(
                                              state as Parameters<typeof updateConfigFormValue>[0],
                                              field.path,
                                              (e.target as HTMLInputElement).value,
                                            );
                                          }}
                                        />
                                      `
                                }
                                ${
                                  field.help
                                    ? html`<span class="onboarding__field-help">${field.help}</span>`
                                    : nothing
                                }
                              </label>
                            `;
                          })}
                        </div>
                      `
                    : nothing
                }
                ${
                  isTelegramStep
                    ? html`
                        <div class="onboarding__fields" style="margin-top: 12px;">
                          <label class="onboarding__field">
                            <span class="onboarding__field-label">
                              Bot Account ID For Verify/Detect (optional)
                            </span>
                            <input
                              class="onboarding__input"
                              type="text"
                              .value=${telegramAccountIdDraft}
                              placeholder="ops-bot"
                              @input=${(e: Event) => {
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountIdDraftKey,
                                  (e.target as HTMLInputElement).value,
                                );
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  "",
                                );
                              }}
                            />
                            <span class="onboarding__field-help">
                              Leave blank to use <code>defaultAccount</code>. Enter an account ID
                              to verify/detect for that bot, and optionally create/update it below.
                            </span>
                          </label>
                          <label class="onboarding__field">
                            <span class="onboarding__field-label">Additional Bot Token</span>
                            <input
                              class="onboarding__input"
                              type="password"
                              .value=${telegramAccountTokenDraft}
                              placeholder="123456:ABC-DEF..."
                              @input=${(e: Event) => {
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountTokenDraftKey,
                                  (e.target as HTMLInputElement).value,
                                );
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  "",
                                );
                              }}
                            />
                          </label>
                          <label class="onboarding__field">
                            <span class="onboarding__field-label">
                              Additional Bot Default Target (optional)
                            </span>
                            <input
                              class="onboarding__input"
                              type="text"
                              .value=${telegramAccountTargetDraft}
                              placeholder="123456789 or -1001234567890:topic:42"
                              @input=${(e: Event) => {
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountTargetDraftKey,
                                  (e.target as HTMLInputElement).value,
                                );
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  "",
                                );
                              }}
                            />
                            <span class="onboarding__field-help">
                              Saved under channels.telegram.accounts.&lt;accountId&gt;.defaultTo.
                            </span>
                          </label>
                        </div>
                      `
                    : nothing
                }

                <!-- Actions -->
                <div class="onboarding__actions">
                  <div class="onboarding__actions-left">
                    ${
                      step.fields.length > 0
                        ? html`
                            <button
                              class="btn primary"
                              ?disabled=${saveDisabled}
                              @click=${() => saveConfig(state as Parameters<typeof saveConfig>[0])}
                            >
                              ${state.configSaving ? "Saving\u2026" : "Save Step"}
                            </button>
                            <button
                              class="btn"
                              ?disabled=${applyDisabled}
                              @click=${() => applyConfig(state as Parameters<typeof applyConfig>[0])}
                            >
                              ${state.configApplying ? "Applying\u2026" : "Save & Apply"}
                            </button>
                          `
                        : nothing
                    }
                    ${
                      isTelegramStep
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${telegramCreateOrUpdateAccountDisabled}
                              @click=${async () => {
                                const accountId = telegramAccountId;
                                const accountToken = telegramAccountToken;
                                const accountDefaultTo = telegramAccountTargetDraft.trim();
                                if (!accountId || !accountToken) {
                                  return;
                                }
                                if (!looksLikeTelegramBotToken(accountToken)) {
                                  updateBuilderSetupInput(
                                    state as Parameters<typeof updateBuilderSetupInput>[0],
                                    telegramAccountStatusKey,
                                    `Could not save account "${accountId}". Bot token format looks invalid.`,
                                  );
                                  return;
                                }
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  "",
                                );
                                if (accountId !== telegramAccountIdDraft) {
                                  updateBuilderSetupInput(
                                    state as Parameters<typeof updateBuilderSetupInput>[0],
                                    telegramAccountIdDraftKey,
                                    accountId,
                                  );
                                }
                                updateConfigFormValue(
                                  state as Parameters<typeof updateConfigFormValue>[0],
                                  ["channels", "telegram", "accounts", accountId, "botToken"],
                                  accountToken,
                                );
                                if (accountDefaultTo) {
                                  updateConfigFormValue(
                                    state as Parameters<typeof updateConfigFormValue>[0],
                                    ["channels", "telegram", "accounts", accountId, "defaultTo"],
                                    accountDefaultTo,
                                  );
                                }
                                await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                if (state.lastError) {
                                  updateBuilderSetupInput(
                                    state as Parameters<typeof updateBuilderSetupInput>[0],
                                    telegramAccountStatusKey,
                                    `Could not save account "${accountId}". Check config errors and retry.`,
                                  );
                                  return;
                                }
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  `Saved account "${accountId}". You can now Verify Bot Token and run Auto-detect Target for it.`,
                                );
                              }}
                            >
                              ${state.configSaving ? "Saving\u2026" : "Create/Update Bot Account"}
                            </button>
                            <button
                              class="btn"
                              ?disabled=${telegramSetDefaultAccountDisabled}
                              @click=${async () => {
                                const accountId = telegramAccountId;
                                if (!accountId) {
                                  return;
                                }
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  "",
                                );
                                updateConfigFormValue(
                                  state as Parameters<typeof updateConfigFormValue>[0],
                                  ["channels", "telegram", "defaultAccount"],
                                  accountId,
                                );
                                await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                if (state.lastError) {
                                  updateBuilderSetupInput(
                                    state as Parameters<typeof updateBuilderSetupInput>[0],
                                    telegramAccountStatusKey,
                                    `Could not set "${accountId}" as default account. Check config errors and retry.`,
                                  );
                                  return;
                                }
                                updateBuilderSetupInput(
                                  state as Parameters<typeof updateBuilderSetupInput>[0],
                                  telegramAccountStatusKey,
                                  `Default Telegram account set to "${accountId}".`,
                                );
                              }}
                            >
                              ${state.configSaving ? "Saving\u2026" : "Set As Default Account"}
                            </button>
                            <button
                              class="btn"
                              ?disabled=${telegramVerifyDisabled}
                              @click=${async () => {
                                if (state.configFormDirty) {
                                  await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                  if (state.configFormDirty || state.lastError) {
                                    return;
                                  }
                                }
                                await runBuilderSetupAction(
                                  state as Parameters<typeof runBuilderSetupAction>[0],
                                  {
                                    connectorId: telegramVerifyConnectorId,
                                    inputs: {
                                      accountId: telegramSelectedAccountId,
                                      ...(telegramAccountId && telegramAccountToken
                                        ? { token: telegramAccountToken }
                                        : {}),
                                    },
                                  },
                                );
                              }}
                            >
                              ${telegramVerifyRunning ? "Verifying…" : "Verify Bot Token"}
                            </button>
                            <button
                              class="btn"
                              ?disabled=${telegramAutoDetectDisabled}
                              @click=${async () => {
                                // Persist current form edits first so setup actions read the same token/config
                                // the user sees in onboarding.
                                if (state.configFormDirty) {
                                  await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                  if (state.configFormDirty || state.lastError) {
                                    return;
                                  }
                                }
                                await runBuilderSetupAction(
                                  state as Parameters<typeof runBuilderSetupAction>[0],
                                  {
                                    connectorId: telegramAutoDetectConnectorId,
                                    inputs: {
                                      accountId: telegramSelectedAccountId,
                                      ...(telegramAccountId && telegramAccountToken
                                        ? { token: telegramAccountToken }
                                        : {}),
                                    },
                                  },
                                );
                              }}
                            >
                              ${telegramAutoDetectRunning ? "Detecting\u2026" : "Auto-detect Target"}
                            </button>
                            <span class="onboarding__dirty" style="margin-left: 4px;">
                              ${`Target account: ${telegramSelectedAccountId}`}
                            </span>
                          `
                        : nothing
                    }
                    ${
                      isSlackStep
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${connectorVerifyDisabled || slackVerifyRunning}
                              @click=${async () => {
                                if (state.configFormDirty) {
                                  await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                  if (state.configFormDirty || state.lastError) {
                                    return;
                                  }
                                }
                                await runBuilderSetupAction(
                                  state as Parameters<typeof runBuilderSetupAction>[0],
                                  {
                                    connectorId: slackVerifyConnectorId,
                                    inputs: {},
                                  },
                                );
                              }}
                            >
                              ${slackVerifyRunning ? "Verifying…" : "Verify Slack credentials"}
                            </button>
                          `
                        : nothing
                    }
                    ${
                      isDiscordStep
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${connectorVerifyDisabled || discordVerifyRunning}
                              @click=${async () => {
                                if (state.configFormDirty) {
                                  await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                  if (state.configFormDirty || state.lastError) {
                                    return;
                                  }
                                }
                                await runBuilderSetupAction(
                                  state as Parameters<typeof runBuilderSetupAction>[0],
                                  {
                                    connectorId: discordVerifyConnectorId,
                                    inputs: {},
                                  },
                                );
                              }}
                            >
                              ${discordVerifyRunning ? "Verifying…" : "Verify Discord token"}
                            </button>
                          `
                        : nothing
                    }
                    ${
                      isSignalStep
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${connectorVerifyDisabled || signalVerifyRunning}
                              @click=${async () => {
                                if (state.configFormDirty) {
                                  await saveConfig(state as Parameters<typeof saveConfig>[0]);
                                  if (state.configFormDirty || state.lastError) {
                                    return;
                                  }
                                }
                                await runBuilderSetupAction(
                                  state as Parameters<typeof runBuilderSetupAction>[0],
                                  {
                                    connectorId: signalVerifyConnectorId,
                                    inputs: {},
                                  },
                                );
                              }}
                            >
                              ${signalVerifyRunning ? "Verifying…" : "Verify Signal transport"}
                            </button>
                          `
                        : nothing
                    }
                    ${
                      isWhatsAppStep
                        ? html`
                            <button
                              class="btn primary"
                              ?disabled=${state.whatsappBusy || !state.connected}
                              @click=${() => void state.handleWhatsAppStart(false)}
                            >
                              ${state.whatsappBusy ? "Working…" : "Show QR"}
                            </button>
                            <button
                              class="btn"
                              ?disabled=${state.whatsappBusy || !state.connected}
                              @click=${() => void state.handleWhatsAppStart(true)}
                            >
                              Relink
                            </button>
                            <button
                              class="btn"
                              ?disabled=${state.whatsappBusy || !state.connected}
                              @click=${() => void state.handleWhatsAppWait()}
                            >
                              Wait for scan
                            </button>
                            <button
                              class="btn danger"
                              ?disabled=${state.whatsappBusy || !state.connected}
                              @click=${() => void state.handleWhatsAppLogout()}
                            >
                              Logout
                            </button>
                          `
                        : nothing
                    }
                    ${
                      configLoading
                        ? html`
                            <span class="onboarding__dirty">Loading current config\u2026</span>
                          `
                        : !configReady
                          ? html`
                              <span class="onboarding__dirty">Preparing setup state\u2026</span>
                            `
                          : state.configFormDirty
                            ? html`
                                <span class="onboarding__dirty">Unsaved changes</span>
                              `
                            : telegramAccountIdInvalid
                              ? html`
                                  <span class="onboarding__dirty">
                                    Bot Account ID can use letters, numbers, underscore, and dash.
                                  </span>
                                `
                              : telegramAccountTokenInvalid
                                ? html`
                                    <span class="onboarding__dirty">
                                      Bot Token format looks invalid. Paste it exactly from BotFather.
                                    </span>
                                  `
                                : telegramCreateOrUpdateMissingFields
                                  ? html`
                                      <span class="onboarding__dirty"> Enter Bot Account ID and Token to enable Create/Update </span>
                                    `
                                  : isTelegramStep && !telegramActionTokenPresent
                                    ? html`
                                        <span class="onboarding__dirty"> No token found for selected account. Save token first. </span>
                                      `
                                    : isTelegramStep
                                      ? html`
                                          <span class="onboarding__dirty">
                                            Verify Bot Token confirms the selected account. Auto-detect uses recent bot messages to fill
                                            Default Target.
                                          </span>
                                        `
                                      : isSlackStep
                                        ? html`
                                            <span class="onboarding__dirty">
                                              Verify Slack credentials checks bot + app tokens against Slack APIs.
                                            </span>
                                          `
                                        : isDiscordStep
                                          ? html`
                                              <span class="onboarding__dirty"> Verify Discord token runs a live bot identity check. </span>
                                            `
                                          : isSignalStep
                                            ? html`
                                                <span class="onboarding__dirty"> Verify Signal transport checks your signal-cli endpoint. </span>
                                              `
                                            : isWhatsAppStep
                                              ? html`
                                                  <span class="onboarding__dirty">
                                                    Show QR to start pairing, then click Wait for scan after scanning.
                                                  </span>
                                                `
                                              : nothing
                    }
                  </div>
                  <div class="onboarding__actions-right">
                    ${
                      step.docsLink
                        ? html`<a
                            class="onboarding__docs-link"
                            href=${step.docsLink}
                            target="_blank"
                            rel="noopener"
                            >Full Docs</a
                          >`
                        : nothing
                    }
                    ${
                      step.advancedTarget
                        ? html`<button
                            class="btn btn--sm btn--ghost"
                            @click=${() => {
                              if (step.advancedTarget) {
                                state.setTab(step.advancedTarget.tab);
                              }
                            }}
                          >
                            Advanced Settings
                          </button>`
                        : nothing
                    }
                  </div>
                </div>
                ${
                  isTelegramStep
                    ? html`
                        <div class="callout" style="margin-top: 12px;">
                          <div><strong>Telegram account routing</strong></div>
                          <div><code>defaultAccount</code>: ${telegramDefaultAccountId}</div>
                          <div>
                            <code>knownAccounts</code>: ${telegramKnownAccountIds.join(", ")}
                          </div>
                          <div><code>selectedForActions</code>: ${telegramSelectedAccountId}</div>
                          <div><code>tokenPathForSelected</code>: ${telegramSelectedTokenPath}</div>
                          ${
                            telegramActionsUsingDraftToken
                              ? html`<div>Using unsaved Bot Token draft for account "${telegramAccountId}".</div>`
                              : nothing
                          }
                          ${
                            telegramSelectedTokenFromConfigIsRedacted
                              ? html`
                                  <div>Saved token for selected account is present (hidden/redacted).</div>
                                `
                              : nothing
                          }
                          ${
                            telegramMainFieldOffTarget
                              ? html`<div>
                                  Main Bot Token field edits <code>channels.telegram.botToken</code>. To edit
                                  ${telegramSelectedAccountId}, use Bot Account ID + Bot Token and Create/Update.
                                </div>`
                              : nothing
                          }
                        </div>
                      `
                    : nothing
                }
                ${
                  telegramAccountStatus
                    ? html`
                        <div
                          class="callout ${
                            telegramAccountStatus.startsWith("Could not save")
                              ? "danger"
                              : "success"
                          }"
                          style="margin-top: 12px;"
                        >
                          ${telegramAccountStatus}
                        </div>
                      `
                    : nothing
                }
                ${
                  telegramSetupError
                    ? html`
                        <div class="callout danger" style="margin-top: 12px;">
                          ${telegramSetupError}
                        </div>
                      `
                    : nothing
                }
                ${
                  telegramVerifyResult
                    ? html`
                        <div
                          class="callout ${
                            telegramVerifyResult.status === "configured" ? "success" : "warn"
                          }"
                          style="margin-top: 12px;"
                        >
                          ${telegramVerifyResult.message}
                        </div>
                      `
                    : nothing
                }
                ${
                  telegramAutoDetectResult
                    ? html`
                        <div
                          class="callout ${
                            telegramAutoDetectResult.status === "configured" ? "success" : "warn"
                          }"
                          style="margin-top: 12px;"
                        >
                          ${telegramAutoDetectResult.message}
                        </div>
                      `
                    : nothing
                }
                ${
                  slackSetupError
                    ? html`
                        <div class="callout danger" style="margin-top: 12px;">
                          ${slackSetupError}
                        </div>
                      `
                    : nothing
                }
                ${
                  slackVerifyResult
                    ? html`
                        <div
                          class="callout ${slackVerifyResult.status === "configured" ? "success" : "warn"}"
                          style="margin-top: 12px;"
                        >
                          ${slackVerifyResult.message}
                        </div>
                      `
                    : nothing
                }
                ${
                  discordSetupError
                    ? html`
                        <div class="callout danger" style="margin-top: 12px;">
                          ${discordSetupError}
                        </div>
                      `
                    : nothing
                }
                ${
                  discordVerifyResult
                    ? html`
                        <div
                          class="callout ${discordVerifyResult.status === "configured" ? "success" : "warn"}"
                          style="margin-top: 12px;"
                        >
                          ${discordVerifyResult.message}
                        </div>
                      `
                    : nothing
                }
                ${
                  signalSetupError
                    ? html`
                        <div class="callout danger" style="margin-top: 12px;">
                          ${signalSetupError}
                        </div>
                      `
                    : nothing
                }
                ${
                  signalVerifyResult
                    ? html`
                        <div
                          class="callout ${signalVerifyResult.status === "configured" ? "success" : "warn"}"
                          style="margin-top: 12px;"
                        >
                          ${signalVerifyResult.message}
                        </div>
                      `
                    : nothing
                }
                ${
                  isWhatsAppStep && state.whatsappLoginMessage
                    ? html`
                        <div class="callout" style="margin-top: 12px;">
                          ${state.whatsappLoginMessage}
                        </div>
                      `
                    : nothing
                }
                ${
                  isWhatsAppStep && state.whatsappLoginConnected === true
                    ? html`
                        <div class="callout success" style="margin-top: 12px">
                          WhatsApp is connected. You can move to the next setup step.
                        </div>
                      `
                    : nothing
                }
                ${
                  isWhatsAppStep && state.whatsappLoginQrDataUrl
                    ? html`
                        <div class="qr-wrap" style="margin-top: 12px;">
                          <img src=${state.whatsappLoginQrDataUrl} alt="WhatsApp QR" />
                        </div>
                      `
                    : nothing
                }
              `
            : html`
                <div class="onboarding__info-only">
                  <p>
                    This setup uses a dedicated sign-in or pairing flow. Open ${advancedTitle} to
                    finish it, then come back here and refresh.
                  </p>
                  <button
                    class="btn primary"
                    @click=${() => {
                      if (step.advancedTarget) {
                        state.setTab(step.advancedTarget.tab);
                      }
                    }}
                  >
                    Open ${advancedTitle}
                  </button>
                </div>
              `
        }
      </div>

      <!-- Prev / Next navigation -->
      <div class="onboarding__nav-row">
        ${
          prevStep
            ? html`<button
                class="btn btn--sm"
                @click=${() => {
                  state.onboardingStep = prevStep.id;
                }}
              >
                \u2190 ${prevStep.title}
              </button>`
            : html`
                <span></span>
              `
        }
        ${
          nextStep
            ? html`<button
                class="btn btn--sm primary"
                @click=${() => {
                  state.onboardingStep = nextStep.id;
                }}
              >
                ${nextStep.title} \u2192
              </button>`
            : html`<button
                class="btn btn--sm primary"
                @click=${() => {
                  state.onboardingStep = null;
                }}
              >
                Finish Setup
              </button>`
        }
      </div>
    </div>
  `;
}
