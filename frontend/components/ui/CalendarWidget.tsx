'use client';

import { useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function CalendarWidget() {
  const today = dayjs();
  const [cursor, setCursor] = useState<Dayjs>(today);

  const startOfMonth = cursor.startOf('month');
  const daysInMonth = cursor.daysInMonth();
  const leadingBlanks = startOfMonth.day();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">{cursor.format('MMMM YYYY')}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !p-1.5 rounded-full" onClick={() => setCursor(cursor.subtract(1, 'month'))}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="btn-ghost !p-1.5 rounded-full" onClick={() => setCursor(cursor.add(1, 'month'))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1.5 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-[11px] font-semibold text-ink-faint">{d}</span>
        ))}
        {cells.map((day, i) => {
          const isToday = day !== null && cursor.year() === today.year() && cursor.month() === today.month() && day === today.date();
          return (
            <span
              key={i}
              className={`text-xs h-7 w-7 mx-auto flex items-center justify-center rounded-full ${
                day === null ? '' : isToday ? 'bg-brand-600 text-white font-semibold' : 'text-ink hover:bg-brand-50'
              }`}
            >
              {day ?? ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
