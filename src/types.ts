export type JobOptionsType = {
  _id: string,
  name: string,
  status: JobStatus,
  logs: JobLogType[];
  flow: JobFlowType,
  startDateTime: string,
  interval?: string;
  intervalMeasur?: IntervalsJob;
  intervalValue?: number;
  weekDays?: number[];
  yearMonths?: number[];
  endDateTime?: string,
}

export type JobType = {
  //имя задачи
  name: string;
  //путь до скрипта задачи
  path: string;
  //интервал запуска задачи
  interval: number | string;
  //дата запуска задачи
  date?: Date;
  //строка с параметрами запуска задачи в формате Cron
  cron?: string;
  //настройки потока
  worker?: Partial<WorkerOptions>;
};

export enum JobStatus {
  STOPPED='stopped',
  RUNNING='running',
  WORKING='working',
  ERROR='error',
}

export type JobLogType = {
  category: 'run' | 'stop' | 'message' | 'workerCreated' | 'workerDeleted';
  date: string;
  message?: string;
}

export type JobFlowType = {
  name: string;
  content: string;
}

export enum IntervalsJob {
  SECONDS = 'seconds',
  MINUTES = 'minutes',
  HOURS = 'hours',
  DAYS = 'days',
  MONTHS = 'months'
}

export type ShedulerLogger = {
  //логирование информационного сообщения
  info(...args: string[]): void;
  //дополнительная реализация логирования информационного сообщения
  log(...args: string[]): void;
  //логирование сообщения об ошибке
  error(...args: string[]): void;
  //логирование сообщения о предупреждении
  warn(...args: string[]): void;
}

export type ShedulerMessageType = {
  name: string,
  message: unknown
}