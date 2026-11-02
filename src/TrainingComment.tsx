import { useLayoutEffect, useRef, useState } from "react";

/**
 * Workout-card comment with an actual three-line preview.
 * A hidden copy measures the text and inline "еще" control together. Measuring
 * both avoids a fourth line or an overlay hiding the final words on mobile.
 */
export default function TrainingComment({ comment }: { comment: string }) {
  const text = comment.trim();
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [overflows, setOverflows] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLParagraphElement>(null);
  const measureTextRef = useRef<HTMLSpanElement>(null);
  const measureSuffixRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const measure = measureRef.current;
    const textSpan = measureTextRef.current;
    const suffix = measureSuffixRef.current;
    if (!host || !measure || !textSpan || !suffix) return;

    const characters = Array.from(text);
    const recalculate = () => {
      if (!host.isConnected || host.getBoundingClientRect().width === 0) return;

      const style = window.getComputedStyle(measure);
      const fontSize = Number.parseFloat(style.fontSize) || 14;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;
      const maxHeight = lineHeight * 3 + 0.75;
      suffix.hidden = true;
      textSpan.textContent = text;
      const tooLong = measure.getBoundingClientRect().height > maxHeight;
      if (!tooLong) {
        setOverflows(false);
        setPreview(null);
        return;
      }

      suffix.hidden = false;
      let lower = 0;
      let upper = characters.length;
      while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2);
        const candidate = characters.slice(0, middle).join("").trimEnd();
        textSpan.textContent = candidate;
        if (measure.getBoundingClientRect().height <= maxHeight) lower = middle;
        else upper = middle - 1;
      }
      setPreview(characters.slice(0, lower).join("").trimEnd());
      setOverflows(true);
    };

    recalculate();
    const observer = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(recalculate);
    observer?.observe(host);
    window.addEventListener("resize", recalculate);
    // Installed fonts may change the line breaks after first paint.
    let active = true;
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (active) recalculate();
      });
    }
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", recalculate);
    };
  }, [text]);

  return (
    <div className="training-comment" ref={hostRef}>
      <p className={"training-comment-text" +
        (!expanded && preview === null ? " training-comment-pending" : "")}>
        {expanded ? text : preview ?? text}
        {overflows && (expanded ? (
          <>
            {" "}
            <button type="button" className="training-comment-toggle"
              aria-expanded="true" onClick={() => setExpanded(false)}>скрыть</button>
          </>
        ) : (
          <>
            {"… "}
            <button type="button" className="training-comment-toggle"
              aria-expanded="false" onClick={() => setExpanded(true)}>еще</button>
          </>
        ))}
      </p>
      <p className="training-comment-measure" ref={measureRef} aria-hidden="true">
        <span ref={measureTextRef} />
        <span ref={measureSuffixRef}>
          {"… "}
          <button type="button" className="training-comment-toggle" tabIndex={-1}>
            еще
          </button>
        </span>
      </p>
    </div>
  );
}
