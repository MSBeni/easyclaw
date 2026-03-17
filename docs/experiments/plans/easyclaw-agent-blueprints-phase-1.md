---
summary: "Phase 1 implementation notes for easyclaw agent blueprints: bundled templates, file I/O, and dry-run planning."
owner: "codex"
status: "implemented"
last_updated: "2026-03-15"
title: "Easyclaw Agent Blueprints Phase 1"
---

# Easyclaw Agent Blueprints Phase 1

Phase 1 turns the phase-0 blueprint shape into a usable dry-run system.

This phase does **not** apply changes to config, workspaces, or cron state yet. It defines the reviewable planning surface that phase 2 will materialize.

## What phase 1 ships

- a bundled starter-template catalog
- blueprint file loading from local `yaml`, `yml`, and `json`
- blueprint bundle serialization for export and editing
- a dry-run compiler that produces a reviewable plan
- a CLI entrypoint for listing templates, showing starter bundles, and planning bundled or file-based blueprints

## CLI workflow

Use the built-in templates:

```bash
openclaw agents templates list
openclaw agents templates show daily-briefing
openclaw agents templates plan daily-briefing
```

Or edit a bundle locally and plan that file:

```bash
openclaw agents templates show daily-briefing > briefing.yaml
openclaw agents templates plan briefing.yaml
```

## Dry-run plan output

The planner emits a structured view of:

- agent identity, workspace path, and agent dir
- model-selection posture
- tool profile and effective allowlists
- routing intent and current route-config mapping
- schedules and delivery target
- workspace bootstrap files and prefill hints
- prerequisites, readiness checks, smoke prompts, and success criteria
- warnings and blocking errors

The output status is:

- `ready` when the bundle is semantically valid for dry-run review
- `invalid` when the bundle needs fixes before it can move to materialization

## Current deliberate limits

Phase 1 keeps a few surfaces in planning form only:

- schedules are reviewed, not created
- workspace files are planned, not written
- thread-aware bindings are preserved in the plan but do not yet map to route config
- subagent and sandbox policy are described, but phase 2 still needs to materialize them against current config/runtime surfaces

## Phase 2 handoff

Phase 2 should consume the dry-run plan and apply it safely:

- write agent config entries
- scaffold workspaces and seed files
- apply bindings
- create cron jobs
- run readiness checks
- stop or roll back on partial failure
