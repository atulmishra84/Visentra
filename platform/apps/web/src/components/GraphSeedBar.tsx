import { FormEvent, type ReactNode } from "react";
import { valueAt } from "../lib/api";

export type GraphSeedOption = {
  id: string;
  name?: string;
  category?: string;
  framework?: string;
  fingerprint?: string;
  edge_count?: number;
};

type GraphSeedBarProps = {
  idPrefix: string;
  seed: string;
  depth: number;
  seeds: GraphSeedOption[];
  submitLabel?: string;
  clearLabel?: string;
  onSeedChange: (value: string) => void;
  onDepthChange: (depth: number) => void;
  onSubmit: (event: FormEvent) => void;
  onClear: () => void;
  onPickSeed: (option: GraphSeedOption) => void;
  onSearchSeeds?: (q: string) => void;
  extraActions?: ReactNode;
  showChips?: boolean;
};

export function GraphSeedBar({
  idPrefix,
  seed,
  depth,
  seeds,
  submitLabel = "Apply",
  clearLabel = "Overview",
  onSeedChange,
  onDepthChange,
  onSubmit,
  onClear,
  onPickSeed,
  onSearchSeeds,
  extraActions,
  showChips = true
}: GraphSeedBarProps) {
  return (
    <>
      <form className="facet-bar" onSubmit={onSubmit}>
        <div className="field" style={{ minWidth: 320, flex: 1 }}>
          <label htmlFor={`${idPrefix}-seed`}>Focus agent</label>
          <input
            className="input"
            id={`${idPrefix}-seed`}
            list={`${idPrefix}-seeds`}
            placeholder="Search by agent name"
            value={seeds.find((option) => option.id === seed)?.name || seed}
            onChange={(event) => {
              const typed = event.target.value;
              const match = seeds.find(
                (option) => option.name === typed || option.id === typed
              );
              onSeedChange(match?.id || typed);
              onSearchSeeds?.(typed);
            }}
          />
          <datalist id={`${idPrefix}-seeds`}>
            {seeds.map((option) => (
              <option key={option.id} value={option.name || option.id}>
                {option.category || "asset"}
                {option.edge_count ? ` · ${option.edge_count}` : ""}
              </option>
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-depth`}>Depth</label>
          <select
            className="select"
            id={`${idPrefix}-depth`}
            value={depth}
            onChange={(event) => onDepthChange(Number(event.target.value))}
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
        </div>
        <button className="button primary" type="submit">
          {submitLabel}
        </button>
        <button className="button ghost" type="button" onClick={onClear}>
          {clearLabel}
        </button>
        {extraActions}
      </form>

      {showChips && seeds.length ? (
        <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {seeds.slice(0, 8).map((option) => (
            <button key={option.id} className="button ghost" type="button" onClick={() => onPickSeed(option)}>
              {valueAt(option as Record<string, unknown>, ["name"], option.id).slice(0, 36)}
              {option.category ? ` · ${option.category}` : ""}
              {option.edge_count ? ` · ${option.edge_count}` : ""}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
