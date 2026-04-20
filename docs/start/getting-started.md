---
summary: "Get EasyClaw installed and build your first agent in minutes."
read_when:
  - First time setup from zero
  - You want the fastest path to a working chat
title: "Getting Started"
---

# Getting Started

Goal: go from zero to a working Builder-first agent flow with minimal setup.

<Info>
Fastest path: open the Control UI, land on Builder, describe the agent you want, and let Setup handle blockers only when needed. Run `easyclaw dashboard` or open `http://127.0.0.1:18789/` on the
<Tooltip headline="Gateway host" tip="The machine running the EasyClaw gateway service.">gateway host</Tooltip>.
Docs: [Dashboard](/web/dashboard) and [Control UI](/web/control-ui).
</Info>

## Prereqs

- Node 24 recommended (Node 22 LTS, currently `22.16+`, still supported for compatibility)

<Tip>
Check your Node version with `node --version` if you are unsure.
</Tip>

## Quick setup (CLI)

<Steps>
  <Step title="Install EasyClaw (recommended)">
    <Tabs>
      <Tab title="macOS/Linux">
        ```bash
        curl -fsSL https://easyclaw.ai/install.sh | bash
        ```
        <img
  src="/assets/install-script.svg"
  alt="Install Script Process"
  className="rounded-lg"
/>
      </Tab>
      <Tab title="Windows (PowerShell)">
        ```powershell
        iwr -useb https://easyclaw.ai/install.ps1 | iex
        ```
      </Tab>
    </Tabs>

    <Note>
    Other install methods and requirements: [Install](/install).
    </Note>

  </Step>
  <Step title="Run the onboarding wizard">
    ```bash
    easyclaw onboard --install-daemon
    ```

    The wizard configures auth, gateway settings, and the Builder-first flow.
    See [Onboarding Wizard](/start/wizard) for details.

  </Step>
  <Step title="Check the Gateway">
    If you installed the service, it should already be running:

    ```bash
    easyclaw gateway status
    ```

  </Step>
  <Step title="Open the Control UI">
    ```bash
    easyclaw dashboard
    ```
  </Step>
</Steps>

<Check>
If the Control UI loads, start in Builder: write a brief, complete any guided Setup blockers, then plan, apply, verify, and chat.
</Check>

## Optional checks and extras

<AccordionGroup>
  <Accordion title="Run the Gateway in the foreground">
    Useful for quick tests or troubleshooting.

    ```bash
    easyclaw gateway --port 18789
    ```

  </Accordion>
  <Accordion title="Send a test message">
    Requires a configured channel.

    ```bash
    easyclaw message send --target +15555550123 --message "Hello from EasyClaw"
    ```

  </Accordion>
</AccordionGroup>

## Useful environment variables

If you run EasyClaw as a service account or want custom config/state locations:

- `EASYCLAW_HOME` sets the home directory used for internal path resolution.
- `EASYCLAW_STATE_DIR` overrides the state directory.
- `EASYCLAW_CONFIG_PATH` overrides the config file path.
- `OPENCLAW_*` names are still accepted as compatibility fallbacks.

Full environment variable reference: [Environment vars](/help/environment).

## Go deeper

<Columns>
  <Card title="Onboarding Wizard (details)" href="/start/wizard">
    Full CLI wizard reference and advanced options.
  </Card>
  <Card title="macOS app onboarding" href="/start/onboarding">
    First run flow for the macOS app.
  </Card>
</Columns>

## What you will have

- A running Gateway
- Auth configured
- Builder access with a working plan/apply/verify path

## Next steps

- Build your first agent brief in Builder: [Dashboard](/web/dashboard)
- DM safety and approvals: [Pairing](/channels/pairing)
- Connect more channels: [Channels](/channels)
- Advanced workflows and from source: [Setup](/start/setup)
