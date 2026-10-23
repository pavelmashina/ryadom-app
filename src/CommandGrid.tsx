import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./components";
export default function CommandGrid({
  children,
  title,
  scrollControls = "arrows",
}: {
  children: ReactNode[];
  title?: string;
  scrollControls?: "arrows" | "slider";
}) {
  const ref = useRef<HTMLDivElement>(null),
    gridId = useId();
  const [scroll, setScroll] = useState({
    overflow: false,
    left: false,
    right: false,
    position: 0,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setScroll({
        overflow: el.scrollWidth > el.clientWidth + 2,
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
        position: el.scrollWidth > el.clientWidth
          ? Math.round(100 * el.scrollLeft / (el.scrollWidth - el.clientWidth))
          : 0,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [children.length]);
  const move = (direction: number) => {
    const el = ref.current;
    if (el)
      el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "auto" });
  };
  return (
    <div className="command-scroller">
      {(title || (scroll.overflow && scrollControls === "arrows")) && (
        <div className="command-scroll-guide">
          {title && <h2>{title}</h2>}
          {scroll.overflow && scrollControls === "arrows" && (
            <div className="command-scroll-buttons">
              <IconButton
                label="Предыдущие команды"
                aria-controls={gridId}
                disabled={!scroll.left}
                onClick={() => move(-1)}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Следующие команды"
                aria-controls={gridId}
                disabled={!scroll.right}
                onClick={() => move(1)}
              >
                <ChevronRight />
              </IconButton>
            </div>
          )}
        </div>
      )}
      <div
        ref={ref}
        id={gridId}
        className="command-list"
        tabIndex={scroll.overflow ? 0 : undefined}
        aria-label="Команды"
      >
        {children}
      </div>
      {scrollControls === "slider" && scroll.overflow && (
        <input
          className="command-scroll-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={scroll.position}
          aria-label="Прокрутить список команд"
          aria-controls={gridId}
          onChange={(event) => {
            const el = ref.current;
            if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) * Number(event.target.value) / 100;
          }}
        />
      )}
    </div>
  );
}
