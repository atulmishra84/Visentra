import { type ReactNode } from "react";

type DetailDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  data?: unknown;
  className?: string;
  onClose: () => void;
};

export function DetailDrawer({ open, title, subtitle, children, data, className, onClose }: DetailDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        aria-modal="true"
        className={["drawer", className].filter(Boolean).join(" ")}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Inspector</p>
            <h2>{title}</h2>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
        {data ? (
          <>
            <h3>Raw payload</h3>
            <pre className="json-block">{JSON.stringify(data, null, 2)}</pre>
          </>
        ) : null}
      </aside>
    </div>
  );
}
