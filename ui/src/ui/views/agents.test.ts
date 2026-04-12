import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAgents, type AgentsProps } from "./agents.ts";

function createSkill() {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
  };
}

function createProps(overrides: Partial<AgentsProps> = {}): AgentsProps {
  return {
    basePath: "",
    loading: false,
    error: null,
    agentsList: {
      defaultId: "alpha",
      mainKey: "main",
      scope: "workspace",
      agents: [{ id: "alpha", name: "Alpha" } as never, { id: "beta", name: "Beta" } as never],
    },
    selectedAgentId: "beta",
    activePanel: "overview",
    modelSuggestions: [],
    config: {
      form: null,
      loading: false,
      saving: false,
      dirty: false,
    },
    channels: {
      snapshot: null,
      loading: false,
      error: null,
      lastSuccess: null,
    },
    cron: {
      status: null,
      jobs: [],
      loading: false,
      error: null,
      notice: null,
    },
    agentFiles: {
      list: null,
      loading: false,
      error: null,
      active: null,
      contents: {},
      drafts: {},
      saving: false,
    },
    agentIdentityLoading: false,
    agentIdentityError: null,
    agentIdentityById: {},
    agentSkills: {
      report: null,
      loading: false,
      error: null,
      agentId: null,
      filter: "",
    },
    toolsCatalog: {
      loading: false,
      error: null,
      result: null,
    },
    onRefresh: () => undefined,
    onSelectAgent: () => undefined,
    onSelectPanel: () => undefined,
    onLoadFiles: () => undefined,
    onSelectFile: () => undefined,
    onFileDraftChange: () => undefined,
    onFileReset: () => undefined,
    onFileSave: () => undefined,
    onToolsProfileChange: () => undefined,
    onToolsOverridesChange: () => undefined,
    onConfigReload: () => undefined,
    onConfigSave: () => undefined,
    onModelChange: () => undefined,
    onModelFallbacksChange: () => undefined,
    onChannelsRefresh: () => undefined,
    onCronRefresh: () => undefined,
    onCronRunNow: () => undefined,
    onOpenCronTab: () => undefined,
    onSkillsFilterChange: () => undefined,
    onSkillsRefresh: () => undefined,
    onAgentSkillToggle: () => undefined,
    onAgentSkillsClear: () => undefined,
    onAgentSkillsDisableAll: () => undefined,
    onSetDefault: () => undefined,
    onDeleteAgent: () => undefined,
    ...overrides,
  };
}

describe("renderAgents", () => {
  it("shows the skills count only for the selected agent's report", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "alpha",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toBe("Skills");
  });

  it("shows the selected agent's skills count when the report matches", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "beta",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toContain("1");
  });

  it("shows cron empty-state actions when selected agent has no jobs", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          activePanel: "cron",
          selectedAgentId: "beta",
          cron: {
            status: {
              enabled: true,
              jobs: 0,
              nextWakeAtMs: null,
            },
            jobs: [],
            loading: false,
            error: null,
            notice: null,
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain(
      "No scheduled tasks yet. Create one in Scheduled Tasks to automate this agent.",
    );

    const openCronButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Open Scheduled Tasks",
    );
    expect(openCronButton).toBeTruthy();

    const runNowButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Run Now",
    );
    expect(runNowButton?.disabled).toBe(true);
  });
});
