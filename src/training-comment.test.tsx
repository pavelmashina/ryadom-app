import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import TrainingComment from "./TrainingComment";
import TrainingHistory from "./TrainingHistory";
import type { TrainingSession } from "./training-domain";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const fixture = (comment: string): TrainingSession => ({
  id: "session-1",
  date: "2026-10-22",
  status: "completed",
  name: "Завершённая тренировка",
  time: "",
  schedule_id: null,
  scheduled_at: null,
  completed_at: "2026-10-22T15:00:00Z",
  duration_minutes: 30,
  comment,
  created_at: "2026-10-22T14:30:00Z",
  updated_at: "2026-10-22T15:00:00Z",
  results: [],
});

describe("Completed training comments", () => {
  it("renders comment text as an ordinary paragraph and uses a hidden measurement", () => {
    const html = renderToStaticMarkup(<TrainingComment comment="Первая строка и важные детали." />);
    expect(html).toContain("Первая строка и важные детали.");
    expect(html).toContain('class="training-comment-text training-comment-pending"');
    expect(html).toContain('class="training-comment-measure"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain("Комментарий целиком");
  });

  it("uses an inline toggle and measures the text and toggle within three lines", () => {
    const component = source("./TrainingComment.tsx");
    const css = source("./training.css");
    expect(component).toContain("lineHeight * 3");
    expect(component).toContain("ResizeObserver");
    expect(component).toContain("measure.getBoundingClientRect().height");
    expect(component).toContain("textSpan.textContent = candidate");
    expect(component).toContain("suffix.hidden = false");
    expect(component).toContain('aria-expanded="false"');
    expect(component).toContain('aria-expanded="true"');
    expect(component).toContain(">еще</button>");
    expect(component).toContain(">скрыть</button>");
    expect(css).toContain("-webkit-line-clamp: 3;");
    expect(css).toContain(".training-screen .training-comment-toggle {");
    expect(css).toContain("display: inline;");
    expect(css).toContain("white-space: pre-wrap;");
    expect(css).toContain("white-space: nowrap;");
    expect(css).toContain(".training-screen .training-comment-measure [hidden]");
  });

  it("uses the compact inline comment in completed workout cards", () => {
    const html = renderToStaticMarkup(<TrainingHistory
      sessions={[fixture("Проверили стойку и повторили команды.")]}
      commands={[]}
      initialDate="2026-10-22"
      onOpen={() => {}}
      onEdit={() => {}}
    />);
    expect(html).toContain('class="training-comment"');
    expect(html).toContain("Проверили стойку и повторили команды.");
    expect(html).not.toContain("Комментарий целиком");
    const history = source("./TrainingHistory.tsx");
    expect(history).toContain("<TrainingComment comment={s.comment} />");
  });
});
