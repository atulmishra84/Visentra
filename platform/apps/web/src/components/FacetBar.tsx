import { meshOptionLabel } from "../lib/mesh";

export type Facets = {
  q?: string;
  owner?: string;
  model?: string;
  framework?: string;
  cloud?: string;
  ide?: string;
  category?: string;
  department?: string;
  evidenceClass?: string;
  agentStatus?: string;
  access?: string;
  accessSensitivity?: string;
  overPermissioned?: string;
  hasInstructions?: string;
  dataClass?: string;
  primaryDataClass?: string;
  agentPlane?: string;
  environmentLane?: string;
  assistedBy?: string;
  endpointPresence?: string;
  projectKind?: string;
};

type FacetBarProps = {
  facets: Facets;
  options?: Partial<Record<keyof Facets, string[]>>;
  onChange: (facets: Facets) => void;
};

const facetFields: Array<keyof Facets> = [
  "category",
  "agentPlane",
  "environmentLane",
  "evidenceClass",
  "agentStatus",
  "dataClass",
  "accessSensitivity",
  "access",
  "overPermissioned",
  "hasInstructions",
  "cloud",
  "ide",
  "assistedBy",
  "endpointPresence",
  "projectKind",
  "owner",
  "framework",
  "model",
  "department"
];

const BOOL_FACETS = new Set<keyof Facets>(["overPermissioned", "hasInstructions"]);

function labelFor(key: keyof Facets): string {
  if (key === "q") return "Search";
  if (key === "cloud") return "Provider";
  if (key === "ide") return "IDE";
  if (key === "category") return "Category";
  if (key === "framework") return "Type / framework";
  if (key === "evidenceClass") return "Evidence";
  if (key === "agentStatus") return "Status";
  if (key === "access") return "Can access";
  if (key === "accessSensitivity") return "Access sensitivity";
  if (key === "overPermissioned") return "Over-permissioned";
  if (key === "hasInstructions") return "Has instructions";
  if (key === "dataClass" || key === "primaryDataClass") return "Data class";
  if (key === "agentPlane") return "Agent plane";
  if (key === "environmentLane") return "Environment";
  if (key === "assistedBy") return "Assisted by";
  if (key === "endpointPresence") return "Endpoint presence";
  if (key === "projectKind") return "Project kind";
  return key[0].toUpperCase() + key.slice(1);
}

function optionLabel(field: keyof Facets, option: string): string {
  if (field === "agentPlane" || field === "environmentLane") {
    return meshOptionLabel(option);
  }
  return option;
}

export function FacetBar({ facets, options = {}, onChange }: FacetBarProps) {
  const update = (key: keyof Facets, value: string) => {
    onChange({
      ...facets,
      [key]: value || undefined
    });
  };

  return (
    <div className="facet-bar" aria-label="Facet filters">
      <div className="field" style={{ minWidth: 240 }}>
        <label htmlFor="facet-q">Search</label>
        <input
          id="facet-q"
          className="input"
          placeholder="Name, owner, type, hostname..."
          value={facets.q ?? ""}
          onChange={(event) => update("q", event.target.value)}
        />
      </div>

      {facetFields.map((field) => (
        <div className="field" key={field}>
          <label htmlFor={`facet-${field}`}>{labelFor(field)}</label>
          <select
            id={`facet-${field}`}
            className="select"
            value={facets[field] ?? ""}
            onChange={(event) => update(field, event.target.value)}
          >
            <option value="">All</option>
            {BOOL_FACETS.has(field) ? (
              <>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </>
            ) : (
              (options[field] ?? []).map((option) => (
                <option key={option} value={option}>
                  {optionLabel(field, option)}
                </option>
              ))
            )}
          </select>
        </div>
      ))}

      <button className="button ghost" type="button" onClick={() => onChange({})}>
        Reset filters
      </button>
    </div>
  );
}
