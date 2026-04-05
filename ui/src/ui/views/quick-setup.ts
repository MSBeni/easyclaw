/**
 * Quick Setup — streamlined inline config for Builder "Configure →" flow.
 *
 * Shows only the 1-3 essential fields for a given integration instead of
 * the full settings page.  Renders inside the builder-setup-banner so
 * the user never has to hunt through advanced options.
 */
import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import {
  loadBuilderPlan,
  runBuilderSetupAction,
  updateBuilderSetupInput,
} from "../controllers/builder.ts";
import { updateConfigFormValue, saveConfig, applyConfig } from "../controllers/config.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";

// ---------------------------------------------------------------------------
// Essential field definitions per integration
// ---------------------------------------------------------------------------

type QuickField = {
  label: string;
  path: Array<string | number>;
  placeholder: string;
  type: "text" | "secret" | "select";
  options?: Array<{ value: string; label: string }>;
  help?: string;
};

type SetupStep = {
  instruction: string;
  /** Optional link the user should open for this step. */
  link?: string;
  linkLabel?: string;
};

type QuickAssistField = {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "secret";
  required?: boolean;
  help?: string;
  configPath?: Array<string | number>;
};

type QuickAssistAction = {
  connectorId: string;
  title: string;
  description: string;
  runLabel: string;
  runningLabel: string;
  fields: QuickAssistField[];
};

type QuickSetupDef = {
  title: string;
  subtitle: string;
  fields: QuickField[];
  docsHint?: string;
  /** Step-by-step guide for non-technical users. */
  steps?: SetupStep[];
  /** Difficulty: "easy" (~1 min), "moderate" (~5 min), "advanced" (requires dev setup). */
  difficulty?: "easy" | "moderate" | "advanced";
  /** Estimated time to complete setup. */
  timeEstimate?: string;
  stepsTitle?: string;
  assist?: QuickAssistAction;
};

type BuilderSetupFocus = NonNullable<AppViewState["builderSetupFocus"]>;

function docsUrlFromPath(path: string | null | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://docs.openclaw.ai${normalized}`;
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function connectorSetupLabel(focus: BuilderSetupFocus): string {
  return (
    focus.connectorLabel?.trim() ||
    focus.connectorSelectionLabel?.trim() ||
    (focus.connectorId
      ? titleCaseWords(focus.connectorId.split(":").at(-1) ?? focus.connectorId)
      : "")
  );
}

function connectorSetupSubtitle(focus: BuilderSetupFocus): string {
  const detail = focus.connectorDetailLabel?.trim();
  if (detail) {
    return detail.endsWith(".") ? detail : `${detail}.`;
  }
  const label = connectorSetupLabel(focus);
  if (focus.connectorKind === "channel") {
    return `Connect ${label} so this workflow can send or receive messages there.`;
  }
  if (focus.connectorKind === "plugin") {
    return `Install or enable ${label}, then finish its setup details below.`;
  }
  return `Configure ${label} so this workflow can use it safely.`;
}

function buildGenericChannelQuickSetup(focus: BuilderSetupFocus): QuickSetupDef {
  const label = connectorSetupLabel(focus);
  const connectorId = focus.connectorId?.trim() ?? "";
  const requiresInstall = Boolean(focus.connectorInstallRequired);
  const requiresAuth = Boolean(focus.connectorRequiresAuth);
  const docsHint = docsUrlFromPath(focus.connectorDocsPath);
  const steps: SetupStep[] = [];

  if (requiresInstall) {
    steps.push({
      instruction:
        focus.connectorInstallStrategy === "npm"
          ? `Install the ${label} channel plugin first. Once it is available, the channel card below will expose the rest of the setup.`
          : `Enable or install the ${label} channel integration first, then return here to finish connecting it.`,
    });
  }
  steps.push({
    instruction: focus.connectorOnboarding
      ? `Use the guided onboarding controls in the ${label} channel card below to connect the account, scan a QR code, or paste the token this channel needs.`
      : `Open the focused ${label} channel card below and enter the account, token, destination, or webhook details it asks for.`,
  });
  if (requiresAuth) {
    steps.push({
      instruction:
        "If the channel asks you to sign in or authorize access, complete that step before returning to Builder.",
    });
  }
  steps.push({
    instruction:
      "Save or apply the channel changes, then return to Builder and run verification again so EasyClaw can confirm the channel is ready.",
  });

  return {
    title: `Set up ${label}`,
    subtitle: connectorSetupSubtitle(focus),
    difficulty: requiresInstall || focus.connectorOnboarding ? "moderate" : "easy",
    timeEstimate: requiresInstall
      ? "5-10 minutes"
      : focus.connectorOnboarding
        ? "2-5 minutes"
        : "1-3 minutes",
    steps,
    docsHint,
    fields: [],
    ...(connectorId
      ? {
          assist: {
            connectorId,
            title: `Check ${label} setup status`,
            description:
              "Run a safe readiness check for this connector and get the next step if setup is still incomplete.",
            runLabel: "Check setup status",
            runningLabel: "Checking setup...",
            fields: [],
          } satisfies QuickAssistAction,
        }
      : {}),
  };
}

function buildGenericConnectorQuickSetup(focus: BuilderSetupFocus): QuickSetupDef {
  const label = connectorSetupLabel(focus);
  const connectorId = focus.connectorId?.trim() ?? "";
  const docsHint = docsUrlFromPath(focus.connectorDocsPath);
  const steps: SetupStep[] = [];

  if (focus.connectorInstallRequired) {
    steps.push({
      instruction:
        focus.connectorInstallStrategy === "npm"
          ? `Install the ${label} integration first so OpenClaw can load it for this workflow.`
          : `Install or enable ${label} before continuing with the rest of the setup.`,
    });
  }

  if (focus.connectorRequiresAuth) {
    steps.push({
      instruction:
        "Complete the required sign-in, API key, or credential flow in the focused settings below before returning to Builder.",
    });
  }

  if (focus.connectorRequiresConfig !== false) {
    steps.push({
      instruction:
        "Use the focused settings below to enter the minimum configuration this connector needs for the workflow, then save or apply the change.",
    });
  }

  steps.push({
    instruction:
      "Return to Builder after the connector is configured so EasyClaw can rebuild the plan and re-run verification.",
  });

  return {
    title: `Configure ${label}`,
    subtitle: connectorSetupSubtitle(focus),
    difficulty: focus.connectorRequiresAuth || focus.connectorInstallRequired ? "moderate" : "easy",
    timeEstimate:
      focus.connectorRequiresAuth || focus.connectorInstallRequired
        ? "3-10 minutes"
        : "1-3 minutes",
    steps,
    docsHint,
    fields: [],
    ...(connectorId
      ? {
          assist: {
            connectorId,
            title: `Check ${label} setup status`,
            description:
              "Run a safe readiness check for this connector and get the next step if setup is still incomplete.",
            runLabel: "Check setup status",
            runningLabel: "Checking setup...",
            fields: [],
          } satisfies QuickAssistAction,
        }
      : {}),
  };
}

/** Map connector metadata and config refs to a quick-setup definition. */
export function resolveQuickSetupForFocus(focus: BuilderSetupFocus): QuickSetupDef | null {
  const refKey = focus.refs[0] ?? "";
  const id = focus.connectorId ?? "";

  // Telegram
  if (id.includes("telegram") || refKey.startsWith("channels.telegram")) {
    return {
      title: "Set up Telegram",
      subtitle:
        "Paste your bot token from @BotFather and set a default target for scheduled delivery.",
      difficulty: "easy",
      timeEstimate: "3 minutes",
      steps: [
        {
          instruction: "Open Telegram and search for @BotFather, then start a chat with it.",
          link: "https://t.me/BotFather",
          linkLabel: "Open @BotFather",
        },
        {
          instruction:
            "Send the command /newbot and follow the prompts to choose a name and username for your bot.",
        },
        {
          instruction:
            "BotFather will reply with a bot token (a long string like 123456:ABC-DEF...). Copy it.",
        },
        {
          instruction:
            "Find your destination chat ID by sending a message where you want deliveries, then read chat.id from getUpdates or openclaw logs.",
        },
        {
          instruction:
            "Paste the token into Bot Token, optionally set Default Target, then click Save.",
        },
      ],
      fields: [
        {
          label: "Bot Token",
          path: ["channels", "telegram", "botToken"],
          placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
          type: "secret",
          help: "Get this from @BotFather on Telegram.",
        },
        {
          label: "DM Policy",
          path: ["channels", "telegram", "dmPolicy"],
          placeholder: "pairing",
          type: "select",
          options: [
            { value: "pairing", label: "Pairing (default)" },
            { value: "open", label: "Open" },
            { value: "allowlist", label: "Allowlist" },
            { value: "disabled", label: "Disabled" },
          ],
          help: "Who can DM the bot. 'Pairing' requires a code to start chatting.",
        },
        {
          label: "Default Target (recommended)",
          path: ["channels", "telegram", "defaultTo"],
          placeholder: "123456789 or -1001234567890:topic:42",
          type: "text",
          help: "Used for @me and scheduled deliveries when no explicit target is set.",
        },
      ],
      assist: {
        connectorId: "channel:telegram:auto-default-target",
        title: "Auto-detect Telegram default target",
        description:
          "EasyClaw can read the bot's recent updates and set defaultTo automatically. Send one message to the bot in your destination chat first, then run this.",
        runLabel: "Auto-detect default target",
        runningLabel: "Detecting target...",
        fields: [],
      },
      docsHint: "https://docs.openclaw.ai/channels/telegram",
    };
  }

  // Discord
  if (id.includes("discord") || refKey.startsWith("channels.discord")) {
    return {
      title: "Set up Discord",
      subtitle: "Paste your bot token from the Discord Developer Portal.",
      difficulty: "easy",
      timeEstimate: "3 minutes",
      steps: [
        {
          instruction: "Go to the Discord Developer Portal and sign in with your Discord account.",
          link: "https://discord.com/developers/applications",
          linkLabel: "Open Developer Portal",
        },
        {
          instruction: 'Click "New Application", give it a name, and click Create.',
        },
        {
          instruction:
            'In the left sidebar, click "Bot". Then click "Reset Token" and copy the token it shows.',
        },
        {
          instruction: "Paste the token into the Bot Token field below.",
        },
        {
          instruction:
            'To add the bot to your server: go to OAuth2 → URL Generator, check "bot" scope, pick the permissions you want, then open the generated URL in your browser.',
        },
      ],
      fields: [
        {
          label: "Bot Token",
          path: ["channels", "discord", "token"],
          placeholder: "MTAxNjQ5...",
          type: "secret",
          help: "Copy from discord.com/developers → Bot → Token.",
        },
        {
          label: "DM Policy",
          path: ["channels", "discord", "dmPolicy"],
          placeholder: "pairing",
          type: "select",
          options: [
            { value: "pairing", label: "Pairing (default)" },
            { value: "open", label: "Open" },
            { value: "allowlist", label: "Allowlist" },
            { value: "disabled", label: "Disabled" },
          ],
        },
      ],
      assist: {
        connectorId: "channel:discord:verify-token",
        title: "Verify Discord bot token",
        description:
          "Run a live Discord API check (`GET /users/@me`) to confirm this token can authenticate the bot.",
        runLabel: "Verify Discord token",
        runningLabel: "Verifying token...",
        fields: [
          {
            key: "discord.accountId",
            label: "Account ID (optional)",
            placeholder: "default",
            type: "text",
            help: "Leave blank for the default Discord account.",
          },
          {
            key: "discord.token",
            label: "Bot Token (optional override)",
            placeholder: "MTAxNjQ5...",
            type: "secret",
            help: "Uses the saved token if left blank.",
            configPath: ["channels", "discord", "token"],
          },
        ],
      },
      docsHint: "https://docs.openclaw.ai/channels/discord",
    };
  }

  // Slack
  if (id.includes("slack") || refKey.startsWith("channels.slack")) {
    return {
      title: "Set up Slack",
      subtitle: "Connect your Slack workspace using Socket Mode (no public URL needed).",
      difficulty: "moderate",
      timeEstimate: "5 minutes",
      steps: [
        {
          instruction:
            'Go to the Slack API portal and click "Create New App". Choose "From scratch" and pick your workspace.',
          link: "https://api.slack.com/apps",
          linkLabel: "Open Slack API",
        },
        {
          instruction:
            'In your new app, go to "Socket Mode" in the left sidebar and enable it. You will be prompted to create an App-Level Token — name it anything (e.g. "openclaw") and add the scope connections:write. Copy the token (starts with xapp-).',
        },
        {
          instruction: "Paste the App Token (xapp-...) into the App Token field below.",
        },
        {
          instruction:
            'Go to "OAuth & Permissions", scroll to Scopes, and add the bot scopes you need (at minimum: chat:write, app_mentions:read, im:history, im:read, im:write). Then click "Install to Workspace" and copy the Bot User OAuth Token (starts with xoxb-).',
        },
        {
          instruction:
            "Paste the Bot Token (xoxb-...) into the Bot Token field below and click Save.",
        },
      ],
      fields: [
        {
          label: "App Token",
          path: ["channels", "slack", "appToken"],
          placeholder: "xapp-1-...",
          type: "secret",
          help: "Socket Mode app-level token. From api.slack.com → Your App → Socket Mode.",
        },
        {
          label: "Bot Token",
          path: ["channels", "slack", "botToken"],
          placeholder: "xoxb-...",
          type: "secret",
          help: "From api.slack.com → OAuth & Permissions → Bot User OAuth Token.",
        },
      ],
      assist: {
        connectorId: "channel:slack:verify-credentials",
        title: "Verify Slack credentials",
        description:
          "Runs `auth.test` for the bot token and checks Socket Mode app-token connectivity when enabled.",
        runLabel: "Verify Slack credentials",
        runningLabel: "Verifying credentials...",
        fields: [
          {
            key: "slack.accountId",
            label: "Account ID (optional)",
            placeholder: "default",
            type: "text",
            help: "Leave blank for the default Slack account.",
          },
          {
            key: "slack.botToken",
            label: "Bot Token (optional override)",
            placeholder: "xoxb-...",
            type: "secret",
            help: "Uses the saved bot token if left blank.",
            configPath: ["channels", "slack", "botToken"],
          },
          {
            key: "slack.appToken",
            label: "App Token (optional override)",
            placeholder: "xapp-1-...",
            type: "secret",
            help: "Needed for Socket Mode checks; uses saved token if left blank.",
            configPath: ["channels", "slack", "appToken"],
          },
        ],
      },
      docsHint: "https://docs.openclaw.ai/channels/slack",
    };
  }

  // Signal
  if (id.includes("signal") || refKey.startsWith("channels.signal")) {
    return {
      title: "Set up Signal",
      subtitle: "Connect Signal via the linked device flow.",
      difficulty: "moderate",
      timeEstimate: "5 minutes",
      steps: [
        {
          instruction:
            "You need signal-cli installed on the server where OpenClaw runs. Install it via your package manager or download it from GitHub.",
          link: "https://github.com/AsamK/signal-cli",
          linkLabel: "signal-cli on GitHub",
        },
        {
          instruction:
            'Register or link a phone number with signal-cli. If you already have Signal on your phone, use the "link" command to add this as a linked device.',
        },
        {
          instruction:
            "Enter the phone number (with country code, e.g. +1234567890) in the field below.",
        },
        {
          instruction:
            "Click Save. OpenClaw will use signal-cli to send and receive messages on this number.",
        },
      ],
      fields: [
        {
          label: "Signal Account",
          path: ["channels", "signal", "account"],
          placeholder: "+1234567890",
          type: "text",
          help: "The phone number registered with Signal.",
        },
      ],
      assist: {
        connectorId: "channel:signal:verify-transport",
        title: "Verify Signal transport",
        description:
          "Checks whether the configured signal-cli HTTP endpoint is reachable and ready for this account.",
        runLabel: "Verify Signal transport",
        runningLabel: "Verifying transport...",
        fields: [
          {
            key: "signal.accountId",
            label: "Account ID (optional)",
            placeholder: "default",
            type: "text",
            help: "Leave blank for the default Signal account.",
          },
          {
            key: "signal.account",
            label: "Signal Account (optional override)",
            placeholder: "+1234567890",
            type: "text",
            help: "Uses saved account/accountUuid if left blank.",
            configPath: ["channels", "signal", "account"],
          },
          {
            key: "signal.httpUrl",
            label: "signal-cli HTTP URL (optional override)",
            placeholder: "http://127.0.0.1:8080",
            type: "text",
            help: "Uses the saved Signal endpoint if left blank.",
            configPath: ["channels", "signal", "httpUrl"],
          },
        ],
      },
      docsHint: "https://docs.openclaw.ai/channels/signal",
    };
  }

  // WhatsApp (Web)
  if (id.includes("whatsapp") || refKey.startsWith("channels.whatsapp")) {
    return {
      title: "Set up WhatsApp",
      subtitle: "Connect WhatsApp by scanning a QR code — no tokens or APIs needed.",
      difficulty: "easy",
      timeEstimate: "1 minute",
      steps: [
        {
          instruction:
            "Make sure you have WhatsApp installed on your phone with an active account.",
        },
        {
          instruction:
            'Click the "Start QR Scan" button below (or in the WhatsApp channel settings). A QR code will appear on screen.',
        },
        {
          instruction:
            "On your phone, open WhatsApp → Settings → Linked Devices → Link a Device, then scan the QR code shown here.",
        },
        {
          instruction:
            "Once scanned, the connection will be established automatically. You are all set!",
        },
      ],
      fields: [],
      docsHint: "https://docs.openclaw.ai/channels/whatsapp",
    };
  }

  // Gmail hooks
  if (
    id === "platform:gmail-hook" ||
    id.startsWith("platform:gmail-hook:") ||
    refKey.startsWith("hooks.gmail")
  ) {
    return {
      title: "Set up Gmail Hook",
      subtitle:
        "Connect Gmail push notifications via Google Cloud Pub/Sub. EasyClaw can run the OpenClaw setup helper for you and fill the hard parts automatically.",
      difficulty: "advanced",
      timeEstimate: "15-20 minutes",
      stepsTitle: "Manual fallback",
      assist: {
        connectorId: "platform:gmail-hook",
        title: "Let EasyClaw do the hard setup",
        description:
          "This runs the same OpenClaw Gmail helper command used in the terminal. It can enable the APIs, create or update the topic and subscription, configure the webhook endpoint, and start Gmail watch().",
        runLabel: "Auto-configure Gmail hook",
        runningLabel: "Configuring Gmail hook...",
        fields: [
          {
            key: "gmail.account",
            label: "Gmail Account",
            placeholder: "automation@example.com",
            type: "text",
            required: true,
            help: "The Google account that owns the mailbox you want EasyClaw to watch.",
            configPath: ["hooks", "gmail", "account"],
          },
          {
            key: "gmail.project",
            label: "GCP Project ID",
            placeholder: "my-gcp-project",
            type: "text",
            help: "Optional. If left blank, OpenClaw will try to infer the project from your current gcloud or gog auth context.",
          },
          {
            key: "gmail.topic",
            label: "Pub/Sub Topic",
            placeholder: "gog-gmail-watch or projects/my-project/topics/gmail-push",
            type: "text",
            help: "Optional. You can enter either a topic name or a full Pub/Sub topic path.",
            configPath: ["hooks", "gmail", "topic"],
          },
          {
            key: "gmail.subscription",
            label: "Pub/Sub Subscription",
            placeholder: "gog-gmail-watch-push",
            type: "text",
            help: "Optional. EasyClaw will create or update this subscription for Gmail push delivery.",
            configPath: ["hooks", "gmail", "subscription"],
          },
          {
            key: "gmail.pushEndpoint",
            label: "Public Push Endpoint",
            placeholder: "https://your-public-host.example/hooks/gmail-pubsub?token=...",
            type: "text",
            help: "Optional. If blank, EasyClaw will create a public push endpoint with Tailscale Funnel/Serve. Set this only if you already have a full public HTTPS URL. A raw IP address will not work.",
          },
        ],
      },
      steps: [
        {
          instruction:
            "Create a Google Cloud project (or use an existing one) and enable the Gmail API and Pub/Sub API.",
          link: "https://console.cloud.google.com/apis/library",
          linkLabel: "Google Cloud Console",
        },
        {
          instruction:
            'In the Google Cloud Console, go to Pub/Sub → Topics and create a new topic (e.g. "gmail-push"). Note the full topic name (projects/YOUR_PROJECT/topics/gmail-push).',
        },
        {
          instruction:
            "Grant publish permissions on that topic to gmail-api-push@system.gserviceaccount.com so Gmail can send notifications to it.",
        },
        {
          instruction:
            "Create a Pub/Sub subscription that pushes to your OpenClaw gateway's webhook endpoint. Set a shared secret token for authentication.",
        },
        {
          instruction:
            "Enter the Gmail account, the Pub/Sub topic path, and the push token in the fields below, then click Save.",
        },
        {
          instruction:
            "OpenClaw will call Gmail's watch() API to start receiving push notifications for new emails.",
        },
      ],
      fields: [
        {
          label: "Gmail Account",
          path: ["hooks", "gmail", "account"],
          placeholder: "automation@example.com",
          type: "text",
          help: "The Google account that owns the Gmail mailbox.",
        },
        {
          label: "Pub/Sub Topic",
          path: ["hooks", "gmail", "topic"],
          placeholder: "projects/my-project/topics/gmail-push",
          type: "text",
          help: "Full Google Cloud Pub/Sub topic path.",
        },
        {
          label: "Push Token",
          path: ["hooks", "gmail", "pushToken"],
          placeholder: "",
          type: "secret",
          help: "Shared secret for authenticating push callbacks.",
        },
      ],
      docsHint: "https://docs.openclaw.ai/automation/hooks",
    };
  }

  // Models / AI config
  if (id === "platform:core-model" || refKey === "models") {
    return {
      title: "Configure AI Model",
      subtitle: "Set up your preferred AI provider API key.",
      difficulty: "easy",
      timeEstimate: "1 minute",
      steps: [
        {
          instruction:
            "Choose your AI provider from the dropdown below. OpenAI and Anthropic are the most popular choices.",
        },
        {
          instruction:
            "Get an API key from your provider's dashboard. For OpenAI, go to platform.openai.com → API Keys. For Anthropic, go to console.anthropic.com → API Keys.",
          link: "https://platform.openai.com/api-keys",
          linkLabel: "OpenAI API Keys",
        },
        {
          instruction:
            "Enter the API key in the configuration section below (scroll down to the AI/Models section if needed), then click Save.",
        },
      ],
      fields: [
        {
          label: "Default Model",
          path: ["agents", "defaults", "model"],
          placeholder: "openai/gpt-4o",
          type: "select",
          options: [
            { value: "openai/gpt-4o", label: "OpenAI (GPT-4o)" },
            { value: "anthropic/claude-sonnet-4-6", label: "Anthropic (Claude Sonnet 4.6)" },
            { value: "google/gemini-2.5-pro", label: "Google (Gemini 2.5 Pro)" },
            { value: "ollama/llama3.3:8b", label: "Ollama (llama3.3:8b)" },
            { value: "groq/llama-3.3-70b-versatile", label: "Groq (Llama 3.3 70B)" },
          ],
          help: "Choose a provider/model pair used by default for new chat sessions.",
        },
      ],
      docsHint: "https://docs.openclaw.ai/configuration#models",
    };
  }

  // Memory tools
  if (id === "tools:memory" || refKey === "memory") {
    return {
      title: "Configure Memory",
      subtitle: "Enable or configure the memory store for your agent.",
      difficulty: "easy",
      timeEstimate: "30 seconds",
      steps: [
        {
          instruction:
            'Toggle Memory to "Enabled" below. This lets your agent remember information across conversations.',
        },
        {
          instruction:
            "Click Save. No additional setup is needed — OpenClaw handles storage automatically.",
        },
      ],
      fields: [
        {
          label: "Memory Enabled",
          path: ["memory", "enabled"],
          placeholder: "",
          type: "select",
          options: [
            { value: "true", label: "Enabled" },
            { value: "false", label: "Disabled" },
          ],
        },
      ],
      docsHint: "https://docs.openclaw.ai/configuration#memory",
    };
  }

  // Web tools
  if (id === "tools:web" || refKey === "web") {
    return {
      title: "Configure Web Tools",
      subtitle: "Set up web browsing and fetch capabilities.",
      difficulty: "easy",
      timeEstimate: "30 seconds",
      steps: [
        {
          instruction:
            'Toggle Web to "Enabled" below. This lets your agent browse the web and fetch content from URLs.',
        },
        {
          instruction: "Click Save. No additional setup is needed.",
        },
      ],
      fields: [
        {
          label: "Web Enabled",
          path: ["web", "enabled"],
          placeholder: "",
          type: "select",
          options: [
            { value: "true", label: "Enabled" },
            { value: "false", label: "Disabled" },
          ],
        },
      ],
      docsHint: "https://docs.openclaw.ai/configuration#web",
    };
  }

  if (id.startsWith("channel:")) {
    return buildGenericChannelQuickSetup(focus);
  }

  if (id || focus.refs.length > 0) {
    return buildGenericConnectorQuickSetup(focus);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Read current config value at a nested path
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
  if (typeof cursor === "string" || typeof cursor === "number" || typeof cursor === "boolean") {
    return String(cursor);
  }
  return "";
}

function readAssistValue(
  state: AppViewState,
  form: Record<string, unknown> | null,
  field: QuickAssistField,
): string {
  const current = state.builderSetupInputs[field.key];
  if (typeof current === "string") {
    return current;
  }
  if (field.configPath) {
    return readConfigValue(form, field.configPath);
  }
  return "";
}

function mapAssistInputs(
  assist: QuickAssistAction,
  inputs: Record<string, string>,
): Record<string, string> {
  if (assist.connectorId.startsWith("platform:gmail-hook")) {
    return {
      account: inputs["gmail.account"] ?? "",
      project: inputs["gmail.project"] ?? "",
      topic: inputs["gmail.topic"] ?? "",
      subscription: inputs["gmail.subscription"] ?? "",
      pushEndpoint: inputs["gmail.pushEndpoint"] ?? "",
    };
  }
  return { ...inputs };
}

function renderAssistSetup(
  state: AppViewState,
  def: QuickSetupDef,
  configForm: Record<string, unknown> | null,
): unknown {
  const assist = def.assist;
  if (!assist) {
    return nothing;
  }
  const running = state.builderSetupRunningConnectorId === assist.connectorId;
  const result =
    state.builderSetupResult &&
    (state.builderSetupResult.connectorId === assist.connectorId ||
      state.builderSetupResult.connectorId.startsWith(`${assist.connectorId}:`))
      ? state.builderSetupResult
      : null;
  const hasMissingRequired = assist.fields.some((field) => {
    if (!field.required) {
      return false;
    }
    return !readAssistValue(state, configForm, field).trim();
  });
  const inputs = Object.fromEntries(
    assist.fields.map((field) => [field.key, readAssistValue(state, configForm, field)]),
  );
  const oauthFilename = state.builderSetupInputs["gmail.credentialsFilename"] ?? "";
  const oauthJson = state.builderSetupInputs["gmail.credentialsJson"] ?? "";
  const credentialImport = result?.credentialImport ?? null;
  const resumeAction = result?.resume ?? null;

  return html`
    <div class="quick-setup__assist">
      <div class="quick-setup__assist-header">
        <div>
          <div class="quick-setup__assist-title">${assist.title}</div>
          <div class="quick-setup__assist-description">${assist.description}</div>
        </div>
      </div>

      <div class="quick-setup__fields">
        ${assist.fields.map(
          (field) => html`
            <label class="quick-setup__field">
              <span class="quick-setup__field-label">${field.label}</span>
              <input
                class="quick-setup__input"
                type=${field.type === "secret" ? "password" : "text"}
                .value=${readAssistValue(state, configForm, field)}
                placeholder=${field.placeholder}
                @input=${(e: Event) => {
                  updateBuilderSetupInput(state, field.key, (e.target as HTMLInputElement).value);
                }}
              />
              ${field.help ? html`<span class="quick-setup__help">${field.help}</span>` : nothing}
            </label>
          `,
        )}
      </div>

      <div class="quick-setup__actions">
        <div class="quick-setup__actions-left">
          <button
            class="btn btn--sm primary"
            ?disabled=${running || hasMissingRequired}
            @click=${() =>
              void runBuilderSetupAction(state, {
                connectorId: assist.connectorId,
                inputs: mapAssistInputs(assist, inputs),
              })}
          >
            ${running ? assist.runningLabel : assist.runLabel}
          </button>
          <span class="quick-setup__dirty-hint">
            ${
              hasMissingRequired
                ? "Fill in the required fields first."
                : "OpenClaw will run the setup helper and refresh the Builder plan afterward."
            }
          </span>
        </div>
      </div>

      ${
        state.builderSetupError
          ? html`<div class="callout danger" style="margin-top:12px;">${state.builderSetupError}</div>`
          : nothing
      }

      ${
        result
          ? html`
              <div class="callout success" style="margin-top:12px;">
                <div><strong>${result.message}</strong></div>
                ${
                  (result.status === "needs_auth" ||
                    result.status === "needs_credentials" ||
                    result.status === "needs_setup") &&
                  result.authSteps?.length
                    ? html`
                        <div style="margin-top:8px;">
                          ${result.authSteps.map(
                            (step) => html`
                              <div style="margin-top:10px;">
                                <div><strong>${step.label}</strong></div>
                                <div>${step.detail}</div>
                                <div style="margin-top:4px;"><code>${step.command}</code></div>
                                <div style="margin-top:8px;">
                                  <button
                                    class="btn btn--sm"
                                    ?disabled=${state.builderSetupRunningConnectorId === step.connectorId}
                                    @click=${() =>
                                      void runBuilderSetupAction(state, {
                                        connectorId: step.connectorId,
                                        inputs: step.inputs,
                                      })}
                                  >
                                    ${
                                      state.builderSetupRunningConnectorId === step.connectorId
                                        ? "Opening…"
                                        : step.label
                                    }
                                  </button>
                                </div>
                              </div>
                            `,
                          )}
                        </div>
                      `
                    : nothing
                }
                ${
                  result.status === "started" && result.authSteps?.length
                    ? html`
                        <div style="margin-top:8px;">
                          ${result.authSteps.map(
                            (step) => html`
                              <div style="margin-top:10px;">
                                <div><strong>${step.label}</strong></div>
                                <div>${step.detail}</div>
                                <div style="margin-top:4px;"><code>${step.command}</code></div>
                                <div style="margin-top:8px;">
                                  <button
                                    class="btn btn--sm"
                                    ?disabled=${state.builderSetupRunningConnectorId === step.connectorId}
                                    @click=${() =>
                                      void runBuilderSetupAction(state, {
                                        connectorId: step.connectorId,
                                        inputs: step.inputs,
                                      })}
                                  >
                                    ${
                                      state.builderSetupRunningConnectorId === step.connectorId
                                        ? "Opening…"
                                        : step.label
                                    }
                                  </button>
                                </div>
                              </div>
                            `,
                          )}
                        </div>
                      `
                    : nothing
                }
                ${
                  result.status === "needs_credentials" && credentialImport
                    ? html`
                        <div style="margin-top:12px;">
                          <div><strong>Create Google OAuth client</strong></div>
                          <div style="margin-top:4px;">
                            Google still requires creating the Desktop app OAuth client in the Google Cloud console once. After you download the JSON, EasyClaw can import it and continue automatically.
                          </div>
                          <div style="margin-top:8px;">
                            <button
                              class="btn btn--sm"
                              @click=${() => {
                                openExternalUrlSafe(credentialImport.consoleUrl);
                              }}
                            >
                              Open Google Cloud credentials
                            </button>
                          </div>
                          ${
                            credentialImport.autoDetect
                              ? html`
                                  <div style="margin-top:12px;">
                                    <div><strong>${credentialImport.autoDetect.label}</strong></div>
                                    <div style="margin-top:4px;">
                                      ${credentialImport.autoDetect.detail}
                                    </div>
                                    <div style="margin-top:10px;">
                                      <button
                                        class="btn btn--sm primary"
                                        ?disabled=${
                                          state.builderSetupRunningConnectorId ===
                                          credentialImport.autoDetect.connectorId
                                        }
                                        @click=${() =>
                                          void runBuilderSetupAction(state, {
                                            connectorId: credentialImport.autoDetect!.connectorId,
                                            inputs: {
                                              account: inputs["gmail.account"] ?? "",
                                              project: inputs["gmail.project"] ?? "",
                                              topic: inputs["gmail.topic"] ?? "",
                                              subscription: inputs["gmail.subscription"] ?? "",
                                              pushEndpoint: inputs["gmail.pushEndpoint"] ?? "",
                                            },
                                          })}
                                      >
                                        ${
                                          state.builderSetupRunningConnectorId ===
                                          credentialImport.autoDetect.connectorId
                                            ? "Importing…"
                                            : credentialImport.autoDetect.label
                                        }
                                      </button>
                                    </div>
                                  </div>
                                `
                              : nothing
                          }
                          <div style="margin-top:12px;">
                            <div><strong>${credentialImport.label}</strong></div>
                            <div style="margin-top:4px;">${credentialImport.detail}</div>
                            <div style="margin-top:10px;">
                              <input
                                type="file"
                                accept=".json,application/json"
                                @change=${async (e: Event) => {
                                  const file = (e.target as HTMLInputElement).files?.[0] ?? null;
                                  if (!file) {
                                    updateBuilderSetupInput(state, "gmail.credentialsFilename", "");
                                    updateBuilderSetupInput(state, "gmail.credentialsJson", "");
                                    return;
                                  }
                                  updateBuilderSetupInput(
                                    state,
                                    "gmail.credentialsFilename",
                                    file.name,
                                  );
                                  const text = await file.text();
                                  updateBuilderSetupInput(state, "gmail.credentialsJson", text);
                                }}
                              />
                            </div>
                            ${
                              oauthFilename
                                ? html`<div style="margin-top:6px;"><code>${oauthFilename}</code></div>`
                                : nothing
                            }
                            <div style="margin-top:10px;">
                              <button
                                class="btn btn--sm"
                                ?disabled=${
                                  !oauthJson.trim() ||
                                  state.builderSetupRunningConnectorId ===
                                    credentialImport.connectorId
                                }
                                @click=${() =>
                                  void runBuilderSetupAction(state, {
                                    connectorId: credentialImport.connectorId,
                                    inputs: {
                                      account: inputs["gmail.account"] ?? "",
                                      project: inputs["gmail.project"] ?? "",
                                      topic: inputs["gmail.topic"] ?? "",
                                      subscription: inputs["gmail.subscription"] ?? "",
                                      pushEndpoint: inputs["gmail.pushEndpoint"] ?? "",
                                      filename: oauthFilename,
                                      credentialsJson: oauthJson,
                                    },
                                  })}
                              >
                                ${
                                  state.builderSetupRunningConnectorId ===
                                  credentialImport.connectorId
                                    ? "Importing…"
                                    : credentialImport.label
                                }
                              </button>
                            </div>
                          </div>
                        </div>
                      `
                    : nothing
                }
                ${
                  result.summary
                    ? html`
                        <div style="margin-top:8px;">
                          ${
                            result.summary.projectId
                              ? html`<div><code>project</code>: ${result.summary.projectId}</div>`
                              : nothing
                          }
                          ${
                            result.summary.topic
                              ? html`<div><code>topic</code>: ${result.summary.topic}</div>`
                              : nothing
                          }
                          ${
                            result.summary.subscription
                              ? html`<div><code>subscription</code>: ${result.summary.subscription}</div>`
                              : nothing
                          }
                          ${
                            result.summary.pushEndpoint
                              ? html`<div><code>push endpoint</code>: ${result.summary.pushEndpoint}</div>`
                              : nothing
                          }
                          ${
                            result.summary.command
                              ? html`<div><code>command</code>: ${result.summary.command}</div>`
                              : nothing
                          }
                        </div>
                      `
                    : nothing
                }
                ${
                  resumeAction
                    ? html`
                        <div style="margin-top:12px;">
                          <div>${resumeAction.detail}</div>
                          <div style="margin-top:8px;">
                            <button
                              class="btn btn--sm"
                              ?disabled=${state.builderSetupRunningConnectorId === resumeAction.connectorId}
                              @click=${() =>
                                void runBuilderSetupAction(state, {
                                  connectorId: resumeAction.connectorId,
                                  inputs: resumeAction.inputs,
                                })}
                            >
                              ${
                                state.builderSetupRunningConnectorId === resumeAction.connectorId
                                  ? "Retrying…"
                                  : resumeAction.label
                              }
                            </button>
                          </div>
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render the quick-setup card if there's a matching definition for
 * the current builderSetupFocus.  Returns `nothing` if no match.
 */
export function renderQuickSetup(state: AppViewState): unknown {
  const focus = state.builderSetupFocus;
  if (!focus) {
    return nothing;
  }

  const def = resolveQuickSetupForFocus(focus);
  if (!def) {
    return nothing;
  }

  const configForm = state.configForm ?? null;

  const difficultyLabel =
    def.difficulty === "easy"
      ? "Easy"
      : def.difficulty === "moderate"
        ? "Moderate"
        : def.difficulty === "advanced"
          ? "Advanced"
          : null;

  return html`
    <div class="quick-setup">
      <div class="quick-setup__header">
        <div>
          <div class="quick-setup__title-row">
            <span class="quick-setup__title">${def.title}</span>
            ${
              difficultyLabel
                ? html`<span class="quick-setup__badge quick-setup__badge--${def.difficulty}"
                    >${difficultyLabel}</span
                  >`
                : nothing
            }
            ${
              def.timeEstimate
                ? html`<span class="quick-setup__time">${def.timeEstimate}</span>`
                : nothing
            }
          </div>
          <div class="quick-setup__subtitle">${def.subtitle}</div>
        </div>
        <div class="quick-setup__nav">
          <button
            class="builder-config-link"
            @click=${() => {
              state.setTab("builder");
              void loadBuilderPlan(state);
            }}
          >
            Return to Builder
          </button>
          <button
            class="btn btn--sm"
            @click=${() => {
              state.builderSetupFocus = null;
            }}
          >
            Dismiss
          </button>
        </div>
      </div>

      ${def.assist ? renderAssistSetup(state, def, configForm) : nothing}

      ${
        def.steps && def.steps.length > 0
          ? html`
              <div class="quick-setup__guide">
                <div class="quick-setup__guide-title">${def.stepsTitle ?? "How to connect"}</div>
                <ol class="quick-setup__steps">
                  ${def.steps.map(
                    (step) => html`
                      <li class="quick-setup__step">
                        <span class="quick-setup__step-text">${step.instruction}</span>
                        ${
                          step.link
                            ? html`<a
                                class="quick-setup__step-link"
                                href=${step.link}
                                target="_blank"
                                rel="noopener"
                                >${step.linkLabel ?? "Open"}</a
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

      ${
        def.fields.length > 0
          ? html`
              <div class="quick-setup__fields">
                ${def.fields.map((field) => {
                  const value = readConfigValue(configForm, field.path);
                  return html`
                    <label class="quick-setup__field">
                      <span class="quick-setup__field-label">${field.label}</span>
                      ${
                        field.type === "select" && field.options
                          ? html`
                              <select
                                class="quick-setup__input"
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
                                <option value="">— select —</option>
                                ${field.options.map(
                                  (opt) =>
                                    html`<option value=${opt.value} ?selected=${value === opt.value}>
                                      ${opt.label}
                                    </option>`,
                                )}
                              </select>
                            `
                          : html`
                              <input
                                class="quick-setup__input"
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
                      ${field.help ? html`<span class="quick-setup__help">${field.help}</span>` : nothing}
                    </label>
                  `;
                })}
              </div>
              <div class="quick-setup__actions">
                <div class="quick-setup__actions-left">
                  <button
                    class="btn btn--sm primary"
                    ?disabled=${!state.configFormDirty || state.configSaving}
                    @click=${() => saveConfig(state as Parameters<typeof saveConfig>[0])}
                  >
                    ${state.configSaving ? "Saving\u2026" : "Save"}
                  </button>
                  <button
                    class="btn btn--sm"
                    ?disabled=${!state.configFormDirty || state.configApplying}
                    @click=${() => applyConfig(state as Parameters<typeof applyConfig>[0])}
                  >
                    ${state.configApplying ? "Applying\u2026" : "Save & Apply"}
                  </button>
                  <span class="quick-setup__dirty-hint">
                    ${
                      state.configFormDirty
                        ? html`
                            You have unsaved changes.
                          `
                        : html`
                            Fill in the fields above, then save.
                          `
                    }
                  </span>
                </div>
                ${
                  def.docsHint
                    ? html`<a
                        class="quick-setup__docs-link"
                        href=${def.docsHint}
                        target="_blank"
                        rel="noopener"
                      >
                        Full Documentation
                      </a>`
                    : nothing
                }
              </div>
            `
          : html`
              <div class="quick-setup__empty">
                This integration is configured via the settings below or through the channel UI.
                ${
                  def.docsHint
                    ? html`<a href=${def.docsHint} target="_blank" rel="noopener">Read the docs</a>`
                    : nothing
                }
              </div>
            `
      }
    </div>
  `;
}
