import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Shared horizontal scrolling pattern: touch/trackpad scroll + unobtrusive
 * native green scrollbar below the content. No arrow buttons. */
export default function CommandGrid({
  children,
  title,
  scrollControls = "native",
}: {
  children: ReactNode[];
  title?: string;
  scrollControls?: "native" | "arrows";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const [scroll,setScroll] = useState({overflow:false});
  useEffect(() => {
    const el=ref.current;
    if(!el) return;
    const measure=()=>setScroll({overflow:el.scrollWidth>el.clientWidth+2});
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(el);
    return ()=>observer.disconnect();
  },[children.length]);
  return (
    <div className="command-scroller">
      {title && <div className="command-scroll-guide"><h2>{title}</h2></div>}
      <div
        ref={ref}
        id={gridId}
        className="command-list"
        tabIndex={scroll.overflow ? 0 : undefined}
        aria-label={title || "Команды"}
        data-scroll-controls={scrollControls === "arrows" ? "native" : scrollControls}
      >
        {children}
      </div>
    </div>
  );
}
