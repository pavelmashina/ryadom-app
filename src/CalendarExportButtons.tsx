import { CalendarPlus } from "lucide-react";
import { Button } from "./components";
import {
  googleCalendarUrl, downloadAppleCalendar, type CalendarExportItem,
} from "./calendar-export";

/** Explicit one-time copy of the selected calendar occurrence. */
export default function CalendarExportButtons({item}: {item: CalendarExportItem}) {
  return <div className="calendar-export">
    <p className="calendar-export-label"><CalendarPlus aria-hidden="true" />
      Добавить в календарь</p>
    <div className="calendar-export-buttons">
      <Button variant="secondary" onClick={() => {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        window.open(googleCalendarUrl(item,zone), "_blank", "noopener,noreferrer");
      }}>Google Календарь</Button>
      <Button variant="secondary" onClick={() => downloadAppleCalendar(item)}>
        Apple Календарь
      </Button>
    </div>
    <p className="calendar-export-hint">Добавляется выбранная дата. Изменения не синхронизируются автоматически.</p>
  </div>;
}
