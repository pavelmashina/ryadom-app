import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "./components";
export default function CommandGrid({ children }: { children: ReactNode[] }) {
  const [expanded, setExpanded] = useState(false);
  const [columns, setColumns] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 600px)").matches
      ? 4
      : 3,
  );
  const gridId = useId();
  useEffect(() => {
    const media = window.matchMedia("(min-width: 600px)");
    const update = () => setColumns(media.matches ? 4 : 3);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const limit = columns * 4;
  return (
    <>
      <div id={gridId} className="command-list">
        {expanded ? children : children.slice(0, limit)}
      </div>
      {children.length > limit && (
        <Button
          fullWidth
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={gridId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Свернуть" : "Показать все (" + children.length + ")"}
        </Button>
      )}
    </>
  );
}
