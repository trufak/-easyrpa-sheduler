import { IntervalsJob, JobOptionsType } from "./types";

export const months: string[] = [
  'January' ,
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const weekDays: string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const getInterval = (jobOption: Partial<JobOptionsType>): string | undefined => {
  if ((jobOption.intervalMeasur && jobOption.intervalValue) || jobOption.weekDays || jobOption.yearMonths) {
    let builder: string = '';
    if (jobOption.intervalMeasur && jobOption.intervalValue) {
      builder = 'every'
      switch (jobOption.intervalMeasur) {
        case IntervalsJob.SECONDS:
          builder = `${builder} ${jobOption.intervalValue} seconds`;
          break;
        case IntervalsJob.MINUTES:
          builder = `${builder} ${jobOption.intervalValue} minutes`;
          break;
        case IntervalsJob.HOURS:
          builder = `${builder} ${jobOption.intervalValue} hours`;
          break;
        case IntervalsJob.DAYS:
          builder = `${builder} ${jobOption.intervalValue} day`;
          break;
        case IntervalsJob.MONTHS:
          builder = `${builder} ${jobOption.intervalValue} month`;
          break;
      }
    }
    if (jobOption.weekDays && jobOption.weekDays.length > 0) {
      builder = `${builder} on ${jobOption.weekDays.map(wd => weekDays[wd - 1]).join(',')}`
    }
    if (jobOption.yearMonths && jobOption.yearMonths.length > 0) {
      builder = `${builder} of ${jobOption.yearMonths.map(ym => months[ym - 1]).join(',')} month`
    }
    return builder
  }
  return;
}