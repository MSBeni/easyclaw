---
summary: "Phase 0 plan for easyclaw agent blueprints: lock starter templates, map six concrete agents to current OpenClaw surfaces, and extract the common blueprint shape."
owner: "codex"
status: "draft"
last_updated: "2026-03-15"
title: "Easyclaw Agent Blueprints Phase 0"
---

# Easyclaw Agent Blueprints Phase 0

## Overview

This phase defines the portable unit that easyclaw should create, edit, validate, share, and eventually install.

The key decision is:

- the portable unit is an **agent blueprint bundle**, not a standalone skill directory
- the builder agent should compile user intent into a blueprint first
- runtime changes come later; phase 0 is about deriving the right shape from real agents we would actually want to run on the current platform

This plan assumes easyclaw is built on top of the existing OpenClaw surfaces for [multi-agent routing](/concepts/multi-agent), [wizard-driven setup](/start/wizard), [skills](/tools/skills), [cron jobs](/automation/cron-jobs), and the [gateway architecture](/concepts/architecture).

Companion artifact:

- [Easyclaw Agent Blueprints Examples](/experiments/plans/easyclaw-agent-blueprints-examples)
- [Easyclaw Agent Blueprints Phase 1](/experiments/plans/easyclaw-agent-blueprints-phase-1)

## Phase 0 goals

- lock the v1 starter templates
- work backward from 6 concrete agents
- describe how each would map onto current OpenClaw surfaces
- extract a common blueprint shape that can express all 4 starter templates cleanly
- identify edge cases that phase 1 compiler/materializer work must support

## Non-goals

- implementing the builder agent
- implementing hosted easyclaw
- shipping a public marketplace
- inventing a new runtime separate from current OpenClaw agent/workspace/config flows

## Decision summary

- v1 starts with 4 starter templates:
  - Personal Assistant
  - Daily Briefing Agent
  - Support Responder
  - Research Agent
- "Scheduled Summarizer" is treated as a variant of Daily Briefing Agent, not a separate flagship template
- the builder agent must not write arbitrary raw config as its primary output
- the builder agent must produce a reviewable blueprint bundle, then compile/apply it
- a skill directory by itself is not expressive enough to represent a shareable agent

## Why a blueprint bundle, not a skill

A real agent on current OpenClaw is more than a skill:

- agent identity and workspace behavior
- per-agent runtime settings
- tool profile and allowlist posture
- channel routing/bindings
- cron jobs or wake behavior
- delivery target and reply mode
- optional skill references
- optional plugin/channel prerequisites

That means the portable unit should be:

- blueprint manifest
- bootstrap workspace files
- skill references
- optional assets and template text
- optional installation prerequisites

## Locked starter templates

### 1. Personal Assistant

Use case:

- direct conversations with one user
- broad but still owner-centric utility
- best default first-run experience

Why it makes the cut:

- simplest mental model
- lowest routing complexity
- easiest day-1 value

### 2. Daily Briefing Agent

Use case:

- gather updates from selected sessions/channels
- deliver a scheduled morning digest to one destination

Why it makes the cut:

- highly visceral demo
- strong showcase for scheduled, multi-source, personal utility

### 3. Support Responder

Use case:

- respond to inbound messages on selected channels
- maintain fixed tone and narrow behavior

Why it makes the cut:

- strong business value
- forces clear decisions around routing, safety, and limited tool posture

### 4. Research Agent

Use case:

- accept a task or topic
- gather material
- produce a structured brief

Why it makes the cut:

- strong showcase for web tools, files, and optional subagent delegation

## Reference agents for schema extraction

Phase 0 derives the blueprint shape from these 6 reference agents:

| Agent                 | Starter template | Primary trigger            | Primary delivery                | Tool posture        | Key surfaces                                 |
| --------------------- | ---------------- | -------------------------- | ------------------------------- | ------------------- | -------------------------------------------- |
| Personal Assistant    | Yes              | direct chat                | reply in place                  | broad owner-centric | workspace, direct routing, skills            |
| Daily Briefing Agent  | Yes              | schedule                   | scheduled digest                | narrow + scheduled  | cron, selected sources, one delivery target  |
| Support Responder     | Yes              | inbound channel traffic    | reply in place                  | narrow responder    | bindings, tone, allowlists, fixed scope      |
| Research Agent        | Yes              | direct request             | structured brief                | research-heavy      | web tools, files, optional subagents         |
| Project Operator      | No               | direct request or schedule | status update or applied change | coding/operator     | exec/files/browser/subagents                 |
| Team Standup Reporter | No               | schedule                   | channel post                    | reporting-focused   | cron, shared destination, structured summary |

The last 2 are deliberate stretch cases. They are not v1 starter templates, but they pressure-test whether the blueprint shape is strong enough for later phases.

## Current-system mapping by reference agent

This section describes how each agent would materialize using current OpenClaw concepts. These are target mappings, not implementation syntax.

### Personal Assistant

Would materialize into:

- one `agents.list[]` entry
- one dedicated workspace seeded with `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, and memory files
- direct/default routing to the owner's preferred surface
- a broad tool profile with owner-centric guardrails
- optional skills for common personal workflows

Schema pressure:

- identity and persona matter
- workspace defaults matter
- "owner-only" should be an explicit concept, not an emergent one

### Daily Briefing Agent

Would materialize into:

- one `agents.list[]` entry with a narrow delivery role
- one workspace focused on digest instructions and output style
- one or more selected source routes or session targets
- one cron job that wakes or runs the agent on a schedule
- one delivery target for the final digest

Schema pressure:

- sources and delivery target must be first-class
- schedule should be first-class
- "digest" is a distinct interaction mode from normal chat reply

### Support Responder

Would materialize into:

- one `agents.list[]` entry
- one or more channel/account bindings
- a narrow tool profile with clear response scope
- workspace files that define tone, escalation rules, and red lines
- possibly channel-specific routing limits

Schema pressure:

- ingress routing matters more than schedule
- safety rules must be explicit
- responder behavior needs a narrower contract than a general assistant

### Research Agent

Would materialize into:

- one `agents.list[]` entry
- a research-oriented workspace
- web/file-heavy tool posture
- optional subagent allowance for multi-step investigations
- structured output expectations in workspace/bootstrap files

Schema pressure:

- output contract should be explicit
- subagent policy should be configurable but not implied
- research intent is not the same as messaging intent

### Project Operator

Would materialize into:

- one `agents.list[]` entry
- coding/operator workspace
- strong file/exec/browser tool posture
- optional scheduled checks or heartbeat work
- optional subagent orchestration for decomposition

Schema pressure:

- tool posture must support "operator" without becoming default for everything
- external action policy must be representable
- approval boundaries need a place in the manifest

### Team Standup Reporter

Would materialize into:

- one `agents.list[]` entry
- schedule-driven reporting workspace
- multiple input sources
- one shared output destination
- recurring cron job with predictable output format

Schema pressure:

- one blueprint may read from many sources but write to one destination
- recurring delivery formatting is part of the agent contract
- internal reporting and personal briefing are related but not identical

## Extracted common blueprint shape

From the 6 reference agents above, the shared shape should be organized into these sections.

### 1. Manifest identity

Purpose:

- stable portable identifier for the blueprint itself

Fields:

- `templateId`
- `displayName`
- `version`
- `summary`
- `tags`

### 2. Agent identity

Purpose:

- shape the persona and presentation of the generated agent

Fields:

- `agentId`
- `name`
- `identity`
- `voice`
- `emoji`
- `avatar`

Compiles into:

- per-agent config metadata
- `IDENTITY.md`
- portions of `SOUL.md`

### 3. Workspace seed

Purpose:

- define the bootstrap text and behavioral files that ground the agent

Fields:

- `workspaceTemplate`
- `bootstrapFiles`
- `memoryMode`
- `heartbeatInstructions`
- `notes`

Compiles into:

- workspace files such as `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`, `USER.md`

### 4. Runtime profile

Purpose:

- define how the agent runs

Fields:

- `model`
- `thinking`
- `skills`
- `tools`
- `subagents`
- `sandbox`

Compiles into:

- `agents.list[]`
- global/per-agent tool posture
- skill references

### 5. Ingress

Purpose:

- describe how work reaches the agent

Fields:

- `interactionMode`
- `bindings`
- `sources`
- `allowedInitiators`

Compiles into:

- route bindings
- channel/account/peer targeting
- default or explicit session entry behavior

### 6. Automation

Purpose:

- represent time-based triggering separately from chat routing

Fields:

- `schedules`
- `wakeMode`
- `runMode`

Compiles into:

- cron jobs
- wake flows

### 7. Delivery

Purpose:

- define where output goes and how it should appear

Fields:

- `deliveryMode`
- `target`
- `format`
- `replyBehavior`

Compiles into:

- cron delivery target
- reply-in-place vs announce-like behavior
- digest/report formatting expectations

### 8. Safety

Purpose:

- make behavior boundaries explicit and reviewable

Fields:

- `externalActionPolicy`
- `configWritePolicy`
- `toolRestrictions`
- `escalationRules`
- `responseScope`

Compiles into:

- tool profile choices
- workspace red lines
- apply-time validation guards

### 9. Validation

Purpose:

- make generated agents testable before activation

Fields:

- `prerequisites`
- `readinessChecks`
- `smokePrompts`
- `successCriteria`

Compiles into:

- preflight validation
- builder review output
- future automated tests

## Draft blueprint model

This is the draft phase-0 target shape for the future compiler. It is intentionally high-level and should not yet be treated as the final implementation schema.

```ts
type AgentBlueprintBundle = {
  manifest: {
    templateId: string;
    displayName: string;
    version: string;
    summary: string;
    tags?: string[];
  };
  agent: {
    agentId: string;
    name: string;
    identity?: {
      vibe?: string;
      emoji?: string;
      avatar?: string;
    };
  };
  workspace: {
    template?: string;
    bootstrapFiles?: string[];
    memoryMode?: "personal" | "shared" | "minimal";
    heartbeatInstructions?: string;
    notes?: string[];
  };
  runtime: {
    model?: string;
    thinking?: "low" | "medium" | "high";
    skills?: string[];
    tools: {
      profile: "minimal" | "messaging" | "coding" | "full";
      alsoAllow?: string[];
      byProvider?: Record<
        string,
        {
          profile?: "minimal" | "messaging" | "coding" | "full";
          alsoAllow?: string[];
          deny?: string[];
        }
      >;
    };
    subagents?: {
      enabled: boolean;
      mode?: "inherit" | "require";
    };
    sandbox?: {
      enabled?: boolean;
    };
  };
  ingress?: {
    interactionMode: "direct" | "scheduled" | "bound-channel" | "hybrid";
    bindings?: Array<{
      channel: string;
      accountId?: string;
      peer?: string;
      thread?: boolean;
    }>;
    sources?: Array<{
      kind: "session" | "binding" | "channel";
      value: string;
    }>;
  };
  automation?: {
    schedules?: Array<{
      name: string;
      schedule: string;
      purpose: string;
    }>;
  };
  delivery?: {
    mode?: "reply" | "announce" | "digest" | "report";
    target?: {
      channel?: string;
      to?: string;
      session?: string;
    };
    format?: "chat" | "brief" | "report";
  };
  safety?: {
    externalActionPolicy?: "ask-first" | "limited-auto" | "allowed";
    configWritePolicy?: "never" | "approval-required" | "owner-only";
    responseScope?: "broad" | "narrow";
    escalationRules?: string[];
  };
  validation?: {
    prerequisites?: string[];
    readinessChecks?: string[];
    smokePrompts?: string[];
    successCriteria?: string[];
  };
};
```

## Phase 0 exit criteria

Phase 0 is complete when:

- all 4 starter templates fit this blueprint shape with no special-case fields
- the 2 non-starter reference agents can also be represented without breaking the model
- we can point to each blueprint field and say which current OpenClaw surface it compiles into
- the team agrees that the builder agent should emit blueprint bundles, not raw config patches as its public contract

## Phase 1 handoff

If this phase is accepted, phase 1 should build:

- a concrete schema/type implementation
- 4 starter blueprint examples
- a dry-run compiler that renders:
  - agent config plan
  - workspace file plan
  - bindings plan
  - cron plan
  - readiness checks

The dry-run compiler is the right first executable artifact because it makes the eventual builder agent reviewable before any write/apply step exists.
