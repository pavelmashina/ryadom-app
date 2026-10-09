import type { ReactNode } from "react";
export default function CommandGrid({ children }: { children: ReactNode[] }) {
  return (
    <div
      className="command-list"
      tabIndex={0}
      aria-label="Команды · прокрутка вправо"
    >
      {children}
    </div>
  );
}
