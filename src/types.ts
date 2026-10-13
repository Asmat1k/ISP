export interface LessonOccurrence {
  date: Date;
  name: string;
  startTime: string;
}

export interface Series {
  name: string;
  startTime: string;
  dates: Date[];
}

export interface ScanResult {
  occurrences: LessonOccurrence[];
  startDate: string;
  endDate: string;
}

export interface PreviewSummary {
  lessonCount: number;
  startDate: string;
  endDate: string;
  subjects: { name: string; count: number }[];
}
