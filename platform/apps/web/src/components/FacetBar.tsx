export type Facets = {
  q?: string;
  owner?: string;
  model?: string;
  framework?: string;
  cloud?: string;
  category?: string;
  department?: string;
};

type FacetBarProps = {
  facets: Facets;
  options?: Partial<Record<keyof Facets, string[]>>;
  onChange: (facets: Facets) => void;
};

const facetFields: Array<keyof Facets> = [
  "category",
  "cloud",
  "owner",
  "framework",
  "model",
  "department"
];

function labelFor(key: keyof Facets): string {
  if (key === "q") return "Search";
  if (key === "cloud") return "Provider";
  if (key === "category") return "Category";
  if (key === "framework") return "Type / framework";
  return key[0].toUpperCase() + key.slice(1);
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
            {(options[field] ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ))}

      <button className="button ghost" type="button" onClick={() => onChange({})}>
        Reset filters
      </button>
    </div>
  );
}
