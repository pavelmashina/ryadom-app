import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./components";
export default function CommandGrid({ children }: { children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null),
    hintId = useId(),
    gridId = useId();
  const [scroll, setScroll] = useState({
    overflow: false,
    left: false,
    right: false,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setScroll({
        overflow: el.scrollWidth > el.clientWidth + 2,
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
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
      <div
        ref={ref}
        id={gridId}
        className="command-list"
        tabIndex={0}
        aria-label="Команды"
        aria-describedby={scroll.overflow ? hintId : undefined}
      >
        {children}
      </div>
      {scroll.overflow && (
        <div className="command-scroll-guide">
          <span id={hintId}>Листайте команды влево и вправо</span>
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
        </div>
      )}
    </div>
  );
}
