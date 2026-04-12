import { listChannelPluginCatalogEntries } from "../../channels/plugins/catalog.js";
import { listChatChannels } from "../../channels/registry.js";
import { getChannelOnboardingAdapter } from "../../commands/onboarding/registry.js";
import { listCoreToolSections } from "../tool-catalog.js";
import { buildCapabilityRegistry } from "./registry.js";
import type {
  CapabilityContract,
  CapabilityRegistry,
  ConnectorDefinition,
  VerificationProbe,
} from "./schema.js";

type OpenClawCapabilityRegistryOptions = {
  includeCatalog?: boolean;
  workspaceDir?: string;
  catalogPaths?: string[];
  env?: NodeJS.ProcessEnv;
  extraContracts?: CapabilityContract[];
  extraConnectors?: ConnectorDefinition[];
};

const STATUS_PROBE: VerificationProbe = {
  kind: "status",
  label: "Status probe",
  successDescription: "The connector reports a healthy status probe.",
};

const SEND_TEST_PROBE: VerificationProbe = {
  kind: "send_test",
  label: "Send test",
  successDescription: "The connector can send a scoped delivery test successfully.",
};

const READ_TEST_PROBE: VerificationProbe = {
  kind: "read_test",
  label: "Read test",
  successDescription: "The connector can read or ingest the expected source successfully.",
};

const BROWSER_SESSION_PROBE: VerificationProbe = {
  kind: "browser_session",
  label: "Browser session",
  successDescription: "The browser-backed session is active and usable.",
};

function createPlatformConnector(params: {
  id: string;
  label: string;
  summary: string;
  contracts: string[];
  riskClasses: ConnectorDefinition["riskClasses"];
  setup: ConnectorDefinition["setup"];
  verification: ConnectorDefinition["verification"];
}): ConnectorDefinition {
  return {
    id: `platform:${params.id}`,
    label: params.label,
    kind: "integration",
    summary: params.summary,
    contracts: params.contracts,
    riskClasses: params.riskClasses,
    source: {
      kind: "core_platform",
      id: params.id,
    },
    install: {
      required: false,
      strategy: "none",
    },
    setup: params.setup,
    verification: params.verification,
    metadata: {},
  };
}

export const OPENCLAW_CAPABILITY_CONTRACTS: CapabilityContract[] = [
  {
    id: "browser.operate",
    label: "Browser Operate",
    summary: "Control a browser-backed surface for navigation and interaction.",
    family: "action",
    semanticVerbs: ["open", "browse", "click", "submit", "interact"],
    requiredInputs: ["target surface", "goal"],
    producedOutputs: ["browser state", "interaction result"],
    requiresTools: ["browser"],
    requiresToolSections: ["ui"],
    configRequirements: [],
    authRequirements: ["interactive session when required"],
    setupHints: ["Ensure the relevant browser-backed session is connected first."],
    risk: "operator",
    verification: [BROWSER_SESSION_PROBE],
  },
  {
    id: "canvas.operate",
    label: "Canvas Operate",
    summary: "Control canvas-backed surfaces for diagrams and visual layouts.",
    family: "action",
    semanticVerbs: ["draw", "diagram", "render", "arrange"],
    requiredInputs: ["canvas target", "visual task"],
    producedOutputs: ["canvas state", "visual artifact"],
    requiresTools: ["canvas"],
    requiresToolSections: ["ui"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use when the workflow needs a canvas rather than browser navigation."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "agent.inspect",
    label: "Agent Inspect",
    summary: "Inspect existing OpenClaw agents and their runtime posture.",
    family: "agent",
    semanticVerbs: ["list", "inspect", "review"],
    requiredInputs: ["agent selector"],
    producedOutputs: ["agent state"],
    requiresTools: ["agents_list"],
    requiresToolSections: ["agents"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use to discover or inspect existing agent definitions."],
    risk: "read_only",
    verification: [STATUS_PROBE],
  },
  {
    id: "agent.manage",
    label: "Agent Manage",
    summary: "Create, update, and configure OpenClaw agents and their runtime shape.",
    family: "agent",
    semanticVerbs: ["create", "update", "configure"],
    requiredInputs: ["agent definition"],
    producedOutputs: ["agent runtime state"],
    requiresTools: ["agents_list"],
    requiresToolSections: ["agents"],
    configRequirements: ["agent config write access"],
    authRequirements: [],
    setupHints: ["Use this when materializing or mutating agent configuration."],
    risk: "config_mutating",
    verification: [STATUS_PROBE],
  },
  {
    id: "automation.control",
    label: "Automation Control",
    summary: "Inspect or control automation runtime surfaces such as cron and gateway health.",
    family: "action",
    semanticVerbs: ["start", "stop", "restart", "probe", "inspect"],
    requiredInputs: ["automation surface"],
    producedOutputs: ["automation state"],
    requiresTools: ["cron", "gateway"],
    requiresToolSections: ["automation"],
    configRequirements: ["automation runtime access"],
    authRequirements: [],
    setupHints: ["Use for automation health checks and runtime control flows."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "approval.request",
    label: "Approval Request",
    summary: "Request human approval before risky execution continues.",
    family: "approval",
    semanticVerbs: ["approve", "confirm", "gate"],
    requiredInputs: ["approval policy", "pending action"],
    producedOutputs: ["approval decision"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use for externally mutating or sensitive actions."],
    risk: "operator",
    verification: [],
  },
  {
    id: "delivery.chat",
    label: "Chat Delivery",
    summary: "Deliver a result to a chat or messaging surface.",
    family: "delivery",
    semanticVerbs: ["deliver", "post", "send"],
    requiredInputs: ["target destination", "message payload"],
    producedOutputs: ["delivered message"],
    requiresTools: ["message"],
    requiresToolSections: ["messaging"],
    configRequirements: ["routing target"],
    authRequirements: ["authenticated outbound connector"],
    setupHints: ["Use when the workflow terminates in a channel or DM."],
    risk: "communicative",
    verification: [SEND_TEST_PROBE],
  },
  {
    id: "delivery.report",
    label: "Report Delivery",
    summary: "Deliver a structured brief, digest, or report.",
    family: "delivery",
    semanticVerbs: ["report", "brief", "digest"],
    requiredInputs: ["formatted report", "delivery destination"],
    producedOutputs: ["delivered report"],
    requiresTools: ["message"],
    requiresToolSections: ["messaging"],
    configRequirements: ["report destination"],
    authRequirements: ["authenticated outbound connector"],
    setupHints: ["Pair with a delivery connector such as chat or session delivery."],
    risk: "communicative",
    verification: [SEND_TEST_PROBE],
  },
  {
    id: "fetch.web",
    label: "Web Fetch",
    summary: "Fetch or search web content as a workflow input.",
    family: "fetch",
    semanticVerbs: ["fetch", "search", "read"],
    requiredInputs: ["url or query"],
    producedOutputs: ["web content"],
    requiresTools: ["web_fetch", "web_search"],
    requiresToolSections: ["web"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use when content must be discovered or pulled from the web."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "fs.read",
    label: "File Read",
    summary: "Read files from the local or workspace filesystem.",
    family: "read",
    semanticVerbs: ["read", "inspect"],
    requiredInputs: ["path"],
    producedOutputs: ["file contents"],
    requiresTools: ["read"],
    requiresToolSections: ["fs"],
    configRequirements: ["filesystem access policy"],
    authRequirements: [],
    setupHints: ["Use for local knowledge and workspace context."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "fs.write",
    label: "File Write",
    summary: "Write or patch files in the local or workspace filesystem.",
    family: "action",
    semanticVerbs: ["write", "edit", "patch"],
    requiredInputs: ["path", "content or patch"],
    producedOutputs: ["updated file"],
    requiresTools: ["write", "edit", "apply_patch"],
    requiresToolSections: ["fs"],
    configRequirements: ["filesystem write policy"],
    authRequirements: [],
    setupHints: ["Use for generated artifacts or code changes."],
    risk: "config_mutating",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "ingest.email",
    label: "Email Ingestion",
    summary: "Read inbound email as a source for workflow execution.",
    family: "ingest",
    semanticVerbs: ["ingest", "read", "watch"],
    requiredInputs: ["mail source", "filter or selector"],
    producedOutputs: ["email content"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: ["email source configuration"],
    authRequirements: ["authenticated email or hook connector"],
    setupHints: ["Use with Gmail hooks or future email-backed connectors."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "ingest.feed",
    label: "Feed Ingestion",
    summary: "Read a feed, newsletter, or regularly polled source.",
    family: "ingest",
    semanticVerbs: ["ingest", "poll", "watch"],
    requiredInputs: ["feed source", "selection filter"],
    producedOutputs: ["feed entries"],
    requiresTools: ["web_fetch"],
    requiresToolSections: ["web"],
    configRequirements: ["source selector"],
    authRequirements: [],
    setupHints: ["Use for newsletters, rss-like feeds, or periodic fetch sources."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "ingress.chat",
    label: "Chat Ingress",
    summary: "Receive messages from a chat surface.",
    family: "ingress",
    semanticVerbs: ["listen", "watch", "receive"],
    requiredInputs: ["channel binding"],
    producedOutputs: ["inbound chat event"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: ["channel binding"],
    authRequirements: ["authenticated channel connector"],
    setupHints: ["Use for direct or bound-channel interaction modes."],
    risk: "communicative",
    verification: [STATUS_PROBE, READ_TEST_PROBE],
  },
  {
    id: "ingress.webhook",
    label: "Webhook Ingress",
    summary: "Receive structured events over an HTTP or webhook surface.",
    family: "ingress",
    semanticVerbs: ["listen", "receive", "trigger"],
    requiredInputs: ["webhook endpoint"],
    producedOutputs: ["inbound event payload"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: ["exposed webhook route"],
    authRequirements: ["validated source when required"],
    setupHints: ["Use for webhook-backed connectors and external event triggers."],
    risk: "communicative",
    verification: [STATUS_PROBE],
  },
  {
    id: "memory.search",
    label: "Memory Search",
    summary: "Search or retrieve stored memory and session context.",
    family: "memory",
    semanticVerbs: ["search", "recall", "lookup"],
    requiredInputs: ["query"],
    producedOutputs: ["memory result"],
    requiresTools: ["memory_search", "memory_get"],
    requiresToolSections: ["memory"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use for durable memory and retrieval-augmented context."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "message.send",
    label: "Message Send",
    summary: "Send a message through a supported outbound surface.",
    family: "message",
    semanticVerbs: ["send", "reply", "post"],
    requiredInputs: ["target", "message"],
    producedOutputs: ["sent message"],
    requiresTools: ["message"],
    requiresToolSections: ["messaging"],
    configRequirements: ["resolved target"],
    authRequirements: ["authenticated messaging connector"],
    setupHints: ["Use for direct outbound messaging actions."],
    risk: "communicative",
    verification: [SEND_TEST_PROBE],
  },
  {
    id: "node.operate",
    label: "Node Operate",
    summary: "Inspect or control nodes, devices, and attached runtime endpoints.",
    family: "action",
    semanticVerbs: ["inspect", "list", "probe", "control"],
    requiredInputs: ["node selector"],
    producedOutputs: ["node state"],
    requiresTools: ["nodes"],
    requiresToolSections: ["nodes"],
    configRequirements: ["node access configuration"],
    authRequirements: [],
    setupHints: ["Use for hardware, device, or remote-node aware workflows."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "observability.trace",
    label: "Execution Trace",
    summary: "Record and expose workflow execution traces and run state.",
    family: "observability",
    semanticVerbs: ["trace", "inspect", "debug"],
    requiredInputs: ["run context"],
    producedOutputs: ["trace events"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use for post-activation debugging and operator trust."],
    risk: "read_only",
    verification: [],
  },
  {
    id: "runtime.exec",
    label: "Runtime Exec",
    summary: "Execute local commands or runtime steps inside the allowed sandbox.",
    family: "action",
    semanticVerbs: ["run", "execute", "invoke"],
    requiredInputs: ["command"],
    producedOutputs: ["runtime output"],
    requiresTools: ["exec", "process"],
    requiresToolSections: ["runtime"],
    configRequirements: ["runtime execution policy"],
    authRequirements: [],
    setupHints: ["Use for local execution and tool-backed workflows."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "schedule.trigger",
    label: "Scheduled Trigger",
    summary: "Run work on a schedule or recurring cadence.",
    family: "schedule",
    semanticVerbs: ["schedule", "repeat", "run daily"],
    requiredInputs: ["schedule expression"],
    producedOutputs: ["scheduled execution"],
    requiresTools: ["cron"],
    requiresToolSections: ["automation"],
    configRequirements: ["cron enabled"],
    authRequirements: [],
    setupHints: ["Use for recurring digests and background jobs."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "session.spawn",
    label: "Session Spawn",
    summary: "Spawn and coordinate a subagent or child session.",
    family: "session",
    semanticVerbs: ["spawn", "delegate", "parallelize"],
    requiredInputs: ["subtask"],
    producedOutputs: ["child session"],
    requiresTools: ["sessions_spawn", "sessions_yield", "subagents"],
    requiresToolSections: ["sessions"],
    configRequirements: ["subagent policy"],
    authRequirements: [],
    setupHints: ["Use for decomposition and orchestrated multi-agent work."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "session.inspect",
    label: "Session Inspect",
    summary: "Inspect existing sessions, history, and runtime session status.",
    family: "session",
    semanticVerbs: ["list", "inspect", "review", "status"],
    requiredInputs: ["session selector"],
    producedOutputs: ["session state"],
    requiresTools: ["sessions_list", "sessions_history", "session_status"],
    requiresToolSections: ["sessions"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use to review conversation state and ongoing background work."],
    risk: "read_only",
    verification: [STATUS_PROBE],
  },
  {
    id: "session.message",
    label: "Session Message",
    summary: "Send work or follow-up messages into an existing session.",
    family: "session",
    semanticVerbs: ["send", "continue", "handoff"],
    requiredInputs: ["session selector", "message"],
    producedOutputs: ["session update"],
    requiresTools: ["sessions_send"],
    requiresToolSections: ["sessions"],
    configRequirements: [],
    authRequirements: [],
    setupHints: ["Use when the workflow needs to push work into an existing session."],
    risk: "operator",
    verification: [STATUS_PROBE],
  },
  {
    id: "transform.summarize",
    label: "Summarize",
    summary: "Transform source content into a concise structured summary.",
    family: "transform",
    semanticVerbs: ["summarize", "condense", "digest"],
    requiredInputs: ["source content"],
    producedOutputs: ["summary"],
    requiresTools: [],
    requiresToolSections: [],
    configRequirements: ["model selection"],
    authRequirements: ["working model provider"],
    setupHints: ["Use for digests, briefings, and compressed output."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "transform.image_understand",
    label: "Image Understand",
    summary: "Extract useful meaning from screenshots, photos, and other images.",
    family: "transform",
    semanticVerbs: ["inspect", "describe", "read"],
    requiredInputs: ["image input"],
    producedOutputs: ["image understanding"],
    requiresTools: ["image"],
    requiresToolSections: ["media"],
    configRequirements: ["media pipeline"],
    authRequirements: ["working vision-capable provider when required"],
    setupHints: ["Use for screenshot analysis and image-backed workflows."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "transform.synthesize_speech",
    label: "Synthesize Speech",
    summary: "Generate spoken audio from text output.",
    family: "transform",
    semanticVerbs: ["speak", "read aloud", "voice"],
    requiredInputs: ["text input"],
    producedOutputs: ["speech audio"],
    requiresTools: ["tts"],
    requiresToolSections: ["media"],
    configRequirements: ["media pipeline"],
    authRequirements: ["working speech-capable provider when required"],
    setupHints: ["Use for voice delivery and spoken summaries."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
  {
    id: "transform.transcribe",
    label: "Transcribe",
    summary: "Convert audio or speech content into text.",
    family: "transform",
    semanticVerbs: ["transcribe", "listen"],
    requiredInputs: ["audio input"],
    producedOutputs: ["transcript"],
    requiresTools: ["tts", "image"],
    requiresToolSections: ["media"],
    configRequirements: ["media pipeline"],
    authRequirements: ["working media-capable provider when required"],
    setupHints: ["Use for voice, media, and audio-backed workflows."],
    risk: "read_only",
    verification: [READ_TEST_PROBE],
  },
];

const TOOL_SECTION_CONTRACTS: Record<string, string[]> = {
  agents: ["agent.inspect", "agent.manage"],
  automation: ["automation.control", "schedule.trigger"],
  fs: ["fs.read", "fs.write"],
  media: ["transform.image_understand", "transform.synthesize_speech", "transform.transcribe"],
  memory: ["memory.search"],
  messaging: ["message.send", "delivery.chat", "delivery.report"],
  nodes: ["node.operate"],
  runtime: ["runtime.exec"],
  sessions: ["session.inspect", "session.message", "session.spawn"],
  ui: ["browser.operate", "canvas.operate"],
  web: ["fetch.web", "ingest.feed"],
};

const CONTRACTS_BY_ID = new Map(
  OPENCLAW_CAPABILITY_CONTRACTS.map((contract) => [contract.id, contract] as const),
);

function riskClassesForContracts(contractIds: string[]): ConnectorDefinition["riskClasses"] {
  const riskClasses = new Set<ConnectorDefinition["riskClasses"][number]>();
  for (const contractId of contractIds) {
    const contract = CONTRACTS_BY_ID.get(contractId);
    if (contract) {
      riskClasses.add(contract.risk);
    }
  }
  return Array.from(riskClasses.values()).toSorted();
}

function listToolConnectorDefinitions(): ConnectorDefinition[] {
  const connectors: ConnectorDefinition[] = [];
  for (const section of listCoreToolSections()) {
    const contracts = TOOL_SECTION_CONTRACTS[section.id];
    if (!contracts || contracts.length === 0) {
      continue;
    }
    const verification =
      section.id === "messaging"
        ? { supported: true, probes: [SEND_TEST_PROBE] }
        : section.id === "ui"
          ? { supported: true, probes: [BROWSER_SESSION_PROBE] }
          : { supported: true, probes: [STATUS_PROBE] };
    const requiresWebSearchSetup = section.id === "web";
    connectors.push({
      id: `tools:${section.id}`,
      label: `OpenClaw ${section.label} Tools`,
      kind: "tooling" as const,
      summary: `Core OpenClaw ${section.label.toLowerCase()} surface.`,
      contracts,
      riskClasses: riskClassesForContracts(contracts),
      source: {
        kind: "core_tool_section" as const,
        id: section.id,
      },
      install: {
        required: false,
        strategy: "none" as const,
      },
      setup: {
        onboarding: false,
        requiresConfig: requiresWebSearchSetup,
        requiresAuth: requiresWebSearchSetup,
      },
      verification,
      metadata: {
        toolSectionId: section.id,
        toolIds: section.tools.map((tool) => tool.id),
      },
    });
  }
  return connectors;
}

function listPlatformConnectorDefinitions(): ConnectorDefinition[] {
  return [
    createPlatformConnector({
      id: "core-model",
      label: "OpenClaw Core Model Runtime",
      summary: "Model-backed reasoning and summarization surface.",
      contracts: ["transform.summarize"],
      riskClasses: ["read_only"],
      setup: {
        onboarding: false,
        requiresConfig: true,
        requiresAuth: true,
      },
      verification: {
        supported: true,
        probes: [STATUS_PROBE],
      },
    }),
    createPlatformConnector({
      id: "exec-approvals",
      label: "OpenClaw Exec Approvals",
      summary: "Approval routing for risky or externally mutating actions.",
      contracts: ["approval.request"],
      riskClasses: ["operator"],
      setup: {
        onboarding: false,
        requiresConfig: true,
        requiresAuth: false,
      },
      verification: {
        supported: true,
        probes: [STATUS_PROBE],
      },
    }),
    createPlatformConnector({
      id: "gmail-hook",
      label: "Gmail Hook",
      summary: "Built-in Gmail watch and webhook ingestion surface.",
      contracts: ["ingest.email", "ingress.webhook"],
      riskClasses: ["read_only"],
      setup: {
        onboarding: true,
        requiresConfig: true,
        requiresAuth: true,
      },
      verification: {
        supported: true,
        probes: [STATUS_PROBE, READ_TEST_PROBE],
      },
    }),
    createPlatformConnector({
      id: "observability",
      label: "OpenClaw Observability",
      summary: "Built-in trace, status, and execution visibility surface.",
      contracts: ["observability.trace"],
      riskClasses: ["read_only"],
      setup: {
        onboarding: false,
        requiresConfig: false,
        requiresAuth: false,
      },
      verification: {
        supported: true,
        probes: [],
      },
    }),
    createPlatformConnector({
      id: "webhook-runtime",
      label: "OpenClaw Webhook Runtime",
      summary: "Generic webhook and hook ingestion surface.",
      contracts: ["ingress.webhook"],
      riskClasses: ["communicative"],
      setup: {
        onboarding: false,
        requiresConfig: true,
        requiresAuth: true,
      },
      verification: {
        supported: true,
        probes: [STATUS_PROBE],
      },
    }),
  ];
}

function buildChannelConnectorDefinition(params: {
  id: string;
  label: string;
  summary: string;
  docsPath?: string;
  selectionLabel?: string;
  detailLabel?: string;
  aliases?: string[];
  systemImage?: string;
  onboarding: boolean;
  installRequired: boolean;
  installStrategy: "none" | "bundled" | "npm" | "local" | "external";
  defaultChoice?: "npm" | "local";
  sourceKind: ConnectorDefinition["source"]["kind"];
  contracts?: string[];
  riskClasses?: ConnectorDefinition["riskClasses"];
  setup?: Partial<ConnectorDefinition["setup"]>;
  verification?: Partial<ConnectorDefinition["verification"]>;
  plannerAliases?: string[];
}): ConnectorDefinition {
  const aliases = Array.from(
    new Set([...(params.aliases ?? []), ...(params.plannerAliases ?? [])].filter(Boolean)),
  );
  return {
    id: `channel:${params.id}`,
    label: params.label,
    kind: "channel",
    summary: params.summary,
    contracts: params.contracts ?? ["ingress.chat", "delivery.chat", "message.send"],
    riskClasses: params.riskClasses ?? ["communicative"],
    source: {
      kind: params.sourceKind,
      id: params.id,
    },
    install: {
      required: params.installRequired,
      strategy: params.installStrategy,
      ...(params.defaultChoice ? { defaultChoice: params.defaultChoice } : {}),
    },
    setup: {
      onboarding: params.setup?.onboarding ?? params.onboarding,
      requiresConfig: params.setup?.requiresConfig ?? true,
      requiresAuth: params.setup?.requiresAuth ?? true,
    },
    verification: {
      supported: params.verification?.supported ?? true,
      probes: params.verification?.probes ?? [STATUS_PROBE, SEND_TEST_PROBE],
    },
    metadata: {
      ...(params.docsPath ? { docsPath: params.docsPath } : {}),
      ...(params.selectionLabel ? { selectionLabel: params.selectionLabel } : {}),
      ...(params.detailLabel ? { detailLabel: params.detailLabel } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(params.systemImage ? { systemImage: params.systemImage } : {}),
    },
  };
}

function listBuiltInChannelConnectorDefinitions(): ConnectorDefinition[] {
  return listChatChannels().map((channel) =>
    buildChannelConnectorDefinition({
      id: channel.id,
      label: channel.label,
      summary: channel.blurb,
      docsPath: channel.docsPath,
      selectionLabel: channel.selectionLabel,
      detailLabel: channel.detailLabel,
      aliases: channel.aliases,
      systemImage: channel.systemImage,
      onboarding: Boolean(getChannelOnboardingAdapter(channel.id)),
      installRequired: false,
      installStrategy: "none",
      sourceKind: "builtin_channel",
    }),
  );
}

function listCatalogChannelConnectorDefinitions(
  options: Pick<OpenClawCapabilityRegistryOptions, "workspaceDir" | "catalogPaths" | "env">,
): ConnectorDefinition[] {
  return listChannelPluginCatalogEntries({
    workspaceDir: options.workspaceDir,
    catalogPaths: options.catalogPaths,
    env: options.env,
  }).map((entry) =>
    buildChannelConnectorDefinition({
      id: entry.id,
      label: entry.meta.label,
      summary: entry.meta.blurb,
      docsPath: entry.meta.docsPath,
      selectionLabel: entry.meta.selectionLabel,
      detailLabel: entry.meta.detailLabel,
      aliases: entry.meta.aliases,
      systemImage: entry.meta.systemImage,
      onboarding: Boolean(getChannelOnboardingAdapter(entry.id)),
      installRequired: true,
      installStrategy: entry.install.localPath ? "bundled" : "npm",
      defaultChoice: entry.install.defaultChoice,
      sourceKind: "channel_catalog",
      contracts: entry.builder?.channelConnector?.contracts,
      riskClasses: entry.builder?.channelConnector?.riskClasses,
      setup: entry.builder?.channelConnector?.setup,
      verification: entry.builder?.channelConnector?.verification,
      plannerAliases: entry.builder?.channelConnector?.plannerHints?.aliases,
    }),
  );
}

export function listOpenClawCapabilityContracts(
  options: OpenClawCapabilityRegistryOptions = {},
): CapabilityContract[] {
  const catalogContracts =
    options.includeCatalog === false
      ? []
      : Array.from(
          new Map(
            listChannelPluginCatalogEntries({
              workspaceDir: options.workspaceDir,
              catalogPaths: options.catalogPaths,
              env: options.env,
            })
              .flatMap((entry) => entry.builder?.capabilityContracts ?? [])
              .map((contract) => [contract.id, contract] as const),
          ).values(),
        );
  return [...OPENCLAW_CAPABILITY_CONTRACTS, ...catalogContracts, ...(options.extraContracts ?? [])];
}

export function listOpenClawConnectorDefinitions(
  options: OpenClawCapabilityRegistryOptions = {},
): ConnectorDefinition[] {
  const deduped = new Map<string, ConnectorDefinition>();
  const built = [
    ...listToolConnectorDefinitions(),
    ...listPlatformConnectorDefinitions(),
    ...listBuiltInChannelConnectorDefinitions(),
    ...(options.includeCatalog === false
      ? []
      : listCatalogChannelConnectorDefinitions({
          workspaceDir: options.workspaceDir,
          catalogPaths: options.catalogPaths,
          env: options.env,
        })),
    ...(options.extraConnectors ?? []),
  ];

  for (const connector of built) {
    if (!deduped.has(connector.id)) {
      deduped.set(connector.id, connector);
    }
  }

  return Array.from(deduped.values()).toSorted((a, b) => a.label.localeCompare(b.label));
}

export function buildOpenClawCapabilityRegistry(
  options: OpenClawCapabilityRegistryOptions = {},
): CapabilityRegistry {
  return buildCapabilityRegistry({
    contracts: listOpenClawCapabilityContracts(options),
    connectors: listOpenClawConnectorDefinitions(options),
  });
}
