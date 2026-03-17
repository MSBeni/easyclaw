import type { AgentBlueprintBundle } from "./schema.js";

export const STARTER_BLUEPRINT_TEMPLATE_IDS = [
  "personal-assistant",
  "daily-briefing",
  "support-responder",
  "research-agent",
] as const;

export const STRETCH_BLUEPRINT_TEMPLATE_IDS = [
  "project-operator",
  "team-standup-reporter",
] as const;

export const personalAssistantBlueprint = {
  manifest: {
    templateId: "personal-assistant",
    displayName: "Personal Assistant",
    version: "0.1.0",
    summary:
      "General owner-centric assistant for direct conversations and lightweight recurring help.",
    tags: ["starter", "personal", "generalist"],
  },
  agent: {
    agentId: "main",
    name: "Atlas",
    identity: {
      vibe: "calm, concise, capable",
      emoji: "compass",
    },
  },
  workspace: {
    template: "starter/personal-assistant",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "HEARTBEAT.md"],
    memoryMode: "personal",
    heartbeatInstructions:
      "Check recent activity, reminders, and outstanding tasks before deciding whether to reach out.",
  },
  runtime: {
    model: "user-selected",
    thinking: "medium",
    skills: ["personal-ops", "memory-hygiene"],
    tools: {
      profile: "messaging",
      alsoAllow: ["cron"],
    },
    subagents: {
      enabled: false,
    },
  },
  ingress: {
    interactionMode: "hybrid",
    bindings: [{ channel: "default" }],
  },
  delivery: {
    mode: "reply",
    format: "chat",
  },
  safety: {
    externalActionPolicy: "ask-first",
    configWritePolicy: "never",
    responseScope: "broad",
  },
  validation: {
    prerequisites: ["at least one owner-accessible channel is configured"],
    readinessChecks: ["workspace bootstrap files created", "routing resolves to this agent"],
    smokePrompts: [
      "Remind me tomorrow morning to review my priorities.",
      "Summarize what you should read at session startup.",
    ],
    successCriteria: ["replies in direct chat", "uses workspace identity and instructions"],
  },
} as const satisfies AgentBlueprintBundle;

export const dailyBriefingBlueprint = {
  manifest: {
    templateId: "daily-briefing",
    displayName: "Daily Briefing Agent",
    version: "0.1.0",
    summary:
      "Scheduled morning digest agent that gathers updates from selected sources and sends one briefing.",
    tags: ["starter", "scheduled", "digest"],
  },
  agent: {
    agentId: "daily-briefing",
    name: "Morning Brief",
    identity: {
      vibe: "crisp, useful, low-noise",
      emoji: "sunrise",
    },
  },
  workspace: {
    template: "starter/daily-briefing",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md", "HEARTBEAT.md"],
    memoryMode: "minimal",
    notes: ["Keep output scannable.", "Prefer grouped sections over long prose."],
  },
  runtime: {
    model: "user-selected",
    thinking: "low",
    skills: ["summarization"],
    tools: {
      profile: "messaging",
      alsoAllow: ["cron"],
    },
    subagents: {
      enabled: false,
    },
  },
  ingress: {
    interactionMode: "scheduled",
    sources: [
      { kind: "session", value: "owner-main" },
      { kind: "binding", value: "slack-work" },
      { kind: "binding", value: "telegram-personal" },
    ],
  },
  automation: {
    schedules: [
      {
        name: "weekday-morning-brief",
        schedule: "0 9 * * 1-5",
        purpose: "Send the morning digest.",
      },
    ],
  },
  delivery: {
    mode: "digest",
    target: {
      channel: "telegram",
      to: "{{owner_target}}",
    },
    format: "brief",
  },
  safety: {
    externalActionPolicy: "limited-auto",
    configWritePolicy: "never",
    responseScope: "narrow",
  },
  validation: {
    prerequisites: ["cron is available", "all selected source bindings exist"],
    readinessChecks: ["delivery target resolves", "schedule compiles cleanly"],
    smokePrompts: ["Produce today's morning briefing."],
    successCriteria: ["one digest is delivered to the target", "selected sources are included"],
  },
} as const satisfies AgentBlueprintBundle;

export const supportResponderBlueprint = {
  manifest: {
    templateId: "support-responder",
    displayName: "Support Responder",
    version: "0.1.0",
    summary: "Narrow inbound responder for customer or team support channels.",
    tags: ["starter", "support", "responder"],
  },
  agent: {
    agentId: "support",
    name: "Support",
    identity: {
      vibe: "clear, polite, bounded",
      emoji: "lifering",
    },
  },
  workspace: {
    template: "starter/support-responder",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md"],
    memoryMode: "shared",
    notes: ["Respect escalation rules.", "Avoid speculative answers."],
  },
  runtime: {
    model: "user-selected",
    thinking: "low",
    skills: ["product-faq"],
    tools: {
      profile: "messaging",
    },
    subagents: {
      enabled: false,
    },
  },
  ingress: {
    interactionMode: "bound-channel",
    bindings: [
      { channel: "slack", accountId: "support" },
      { channel: "discord", accountId: "community" },
    ],
  },
  delivery: {
    mode: "reply",
    format: "chat",
  },
  safety: {
    externalActionPolicy: "limited-auto",
    configWritePolicy: "never",
    responseScope: "narrow",
    escalationRules: [
      "Escalate billing or account-risk questions.",
      "Do not promise unsupported features.",
    ],
  },
  validation: {
    prerequisites: ["support channel bindings exist", "support knowledge assets are present"],
    readinessChecks: [
      "replies route back through the bound channel",
      "tool posture excludes operator-grade tools",
    ],
    smokePrompts: ["A user asks how to reset their setup.", "A user reports a billing issue."],
    successCriteria: [
      "normal questions get bounded replies",
      "escalation paths are followed for risky cases",
    ],
  },
} as const satisfies AgentBlueprintBundle;

export const researchAgentBlueprint = {
  manifest: {
    templateId: "research-agent",
    displayName: "Research Agent",
    version: "0.1.0",
    summary: "On-demand research agent that gathers material and returns a structured brief.",
    tags: ["starter", "research", "synthesis"],
  },
  agent: {
    agentId: "research",
    name: "Scout",
    identity: {
      vibe: "methodical, evidence-first",
      emoji: "search",
    },
  },
  workspace: {
    template: "starter/research-agent",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md"],
    memoryMode: "minimal",
    notes: ["Cite sources.", "Separate facts from inference."],
  },
  runtime: {
    model: "user-selected",
    thinking: "high",
    skills: ["research-brief"],
    tools: {
      profile: "coding",
    },
    subagents: {
      enabled: true,
      mode: "inherit",
    },
  },
  ingress: {
    interactionMode: "direct",
    bindings: [{ channel: "default" }],
  },
  delivery: {
    mode: "report",
    format: "report",
  },
  safety: {
    externalActionPolicy: "ask-first",
    configWritePolicy: "never",
    responseScope: "broad",
  },
  validation: {
    prerequisites: ["web tools are enabled for the selected runtime"],
    readinessChecks: ["research prompts can access search and fetch tools"],
    smokePrompts: ["Research local-first multi-agent assistants and produce a short brief."],
    successCriteria: ["output includes clear sections", "findings are attributable"],
  },
} as const satisfies AgentBlueprintBundle;

export const projectOperatorBlueprint = {
  manifest: {
    templateId: "project-operator",
    displayName: "Project Operator",
    version: "0.1.0",
    summary: "Coding and operator agent for repo work, checks, and applied changes.",
    tags: ["stretch", "coding", "operator"],
  },
  agent: {
    agentId: "operator",
    name: "Operator",
    identity: {
      vibe: "pragmatic, terse, reliable",
      emoji: "tools",
    },
  },
  workspace: {
    template: "stretch/project-operator",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md"],
    memoryMode: "minimal",
  },
  runtime: {
    model: "user-selected",
    thinking: "high",
    skills: ["repo-maintainer"],
    tools: {
      profile: "coding",
      alsoAllow: ["browser", "cron", "agents_list"],
    },
    subagents: {
      enabled: true,
      mode: "require",
    },
    sandbox: {
      enabled: true,
    },
  },
  ingress: {
    interactionMode: "hybrid",
    bindings: [{ channel: "default" }],
  },
  automation: {
    schedules: [
      {
        name: "nightly-checks",
        schedule: "0 2 * * *",
        purpose: "Run nightly health and drift checks.",
      },
    ],
  },
  delivery: {
    mode: "report",
    target: {
      session: "owner-main",
    },
    format: "report",
  },
  safety: {
    externalActionPolicy: "ask-first",
    configWritePolicy: "owner-only",
    responseScope: "broad",
    escalationRules: ["Ask before destructive actions.", "Ask before external publication."],
  },
  validation: {
    prerequisites: ["workspace path exists", "coding tools are available"],
    readinessChecks: ["sandbox resolves cleanly", "tool posture matches operator needs"],
    smokePrompts: ["Inspect the repo and summarize open maintenance issues."],
    successCriteria: ["file and exec tools are available", "safety boundaries remain explicit"],
  },
} as const satisfies AgentBlueprintBundle;

export const teamStandupReporterBlueprint = {
  manifest: {
    templateId: "team-standup-reporter",
    displayName: "Team Standup Reporter",
    version: "0.1.0",
    summary:
      "Scheduled standup reporter that gathers project signals and posts a team-facing summary.",
    tags: ["stretch", "scheduled", "reporting"],
  },
  agent: {
    agentId: "standup",
    name: "Standup",
    identity: {
      vibe: "concise, organized",
      emoji: "megaphone",
    },
  },
  workspace: {
    template: "stretch/team-standup-reporter",
    bootstrapFiles: ["AGENTS.md", "SOUL.md", "TOOLS.md"],
    memoryMode: "shared",
  },
  runtime: {
    model: "user-selected",
    thinking: "medium",
    skills: ["project-status"],
    tools: {
      profile: "messaging",
      alsoAllow: ["cron"],
    },
    subagents: {
      enabled: false,
    },
  },
  ingress: {
    interactionMode: "scheduled",
    sources: [
      { kind: "session", value: "project-ops" },
      { kind: "session", value: "support" },
      { kind: "binding", value: "slack-eng" },
    ],
  },
  automation: {
    schedules: [
      {
        name: "weekday-standup",
        schedule: "45 8 * * 1-5",
        purpose: "Publish the daily standup summary.",
      },
    ],
  },
  delivery: {
    mode: "report",
    target: {
      channel: "slack",
      to: "{{team_channel}}",
    },
    format: "brief",
  },
  safety: {
    externalActionPolicy: "limited-auto",
    configWritePolicy: "never",
    responseScope: "narrow",
  },
  validation: {
    prerequisites: ["standup destination channel resolves", "source sessions exist"],
    readinessChecks: ["scheduled delivery compiles", "report formatting is deterministic"],
    smokePrompts: ["Produce today's standup report from the configured sources."],
    successCriteria: ["team channel receives one concise summary", "source coverage is visible"],
  },
} as const satisfies AgentBlueprintBundle;

export const STARTER_BLUEPRINT_EXAMPLES = [
  personalAssistantBlueprint,
  dailyBriefingBlueprint,
  supportResponderBlueprint,
  researchAgentBlueprint,
] as const satisfies readonly AgentBlueprintBundle[];

export const STRETCH_BLUEPRINT_EXAMPLES = [
  projectOperatorBlueprint,
  teamStandupReporterBlueprint,
] as const satisfies readonly AgentBlueprintBundle[];

export const ALL_BLUEPRINT_EXAMPLES = [
  ...STARTER_BLUEPRINT_EXAMPLES,
  ...STRETCH_BLUEPRINT_EXAMPLES,
] as const satisfies readonly AgentBlueprintBundle[];
