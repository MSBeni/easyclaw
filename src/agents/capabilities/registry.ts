import type { CapabilityContract, CapabilityRegistry, ConnectorDefinition } from "./schema.js";

type BuildCapabilityRegistryParams = {
  contracts: CapabilityContract[];
  connectors: ConnectorDefinition[];
};

function dedupeById<T extends { id: string }>(entries: T[], kind: "contract" | "connector"): T[] {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    const id = entry.id.trim();
    if (!id) {
      throw new Error(`Capability registry ${kind} ids must be non-empty.`);
    }
    if (byId.has(id)) {
      throw new Error(`Duplicate ${kind} id "${id}" in capability registry.`);
    }
    byId.set(id, { ...entry, id } as T);
  }
  return Array.from(byId.values());
}

export function buildCapabilityRegistry(params: BuildCapabilityRegistryParams): CapabilityRegistry {
  const contracts = dedupeById(params.contracts, "contract").toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  const connectors = dedupeById(params.connectors, "connector").toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );

  const contractsById = new Map<string, CapabilityContract>(
    contracts.map((entry) => [entry.id, entry]),
  );
  const connectorsById = new Map<string, ConnectorDefinition>(
    connectors.map((entry) => [entry.id, entry]),
  );
  const connectorsByContractId = new Map<string, ConnectorDefinition[]>();

  for (const connector of connectors) {
    for (const contractId of connector.contracts) {
      if (!contractsById.has(contractId)) {
        throw new Error(
          `Connector "${connector.id}" references unknown capability contract "${contractId}".`,
        );
      }
      const list = connectorsByContractId.get(contractId) ?? [];
      list.push(connector);
      connectorsByContractId.set(contractId, list);
    }
  }

  for (const [contractId, list] of connectorsByContractId.entries()) {
    connectorsByContractId.set(
      contractId,
      list.toSorted((a, b) => a.label.localeCompare(b.label)),
    );
  }

  return {
    contracts,
    connectors,
    contractsById,
    connectorsById,
    connectorsByContractId,
  };
}

export function getCapabilityContract(
  registry: CapabilityRegistry,
  contractId: string,
): CapabilityContract | undefined {
  return registry.contractsById.get(contractId.trim());
}

export function getConnectorDefinition(
  registry: CapabilityRegistry,
  connectorId: string,
): ConnectorDefinition | undefined {
  return registry.connectorsById.get(connectorId.trim());
}

export function listConnectorsForContract(
  registry: CapabilityRegistry,
  contractId: string,
): ConnectorDefinition[] {
  return registry.connectorsByContractId.get(contractId.trim()) ?? [];
}
