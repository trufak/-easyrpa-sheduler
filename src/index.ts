import Bree from "bree";
import tsWorker from "@breejs/ts-worker";
Bree.extend(tsWorker);
import path from "path";
import fsPromises from "fs/promises";
import { WordArray } from "crypto-ts/src/lib/WordArray";
import { AES, enc } from "crypto-ts";
import { type WorkerOptions } from "node:worker_threads";
import { IScriptCreator, ScriptCreator, CollectionType, ExternalDataDefaultFlowType } from "@easyrpa/script-creator";

export interface ISheduler {
  //путь к скриптам задач
  pathJobs: string;
  //запустить список задач
  runJobs(jobsOptions: JobOptionsType[]): Promise<string[] | undefined>;
  //запустить одну задачу
  runJob(jobOptions: JobOptionsType): Promise<string | undefined>;
  //остановить одну задачу
  stopJob(id: string): Promise<string | undefined>;
  //выйти из процесса выполнения задачи
  postMessageCancelWorker(id: string): void;
  //создать файл скрипта задачи
  createPhytonScript(jobOptions: JobOptionsType): Promise<string | undefined>;
  //удалить файл скрипта задачи
  deletePhytonScript(id: string): Promise<string>;
  //создать файлы скриптов для списка задач
  createPhytonScripts(jobsOptions: JobOptionsType[]): Promise<string[]>;
}

export type ShedulerConfig = {
  logger: ShedulerLogger;
  encriptKey: string;
  pathJobs: string;
  pythonPath: string;
  scriptJobPath: string;
  errorHandler?: (error: any) => void | Promise<void>;
  workerMessageHandler?: (message: ShedulerMessageType) => void | Promise<void>;
  onWorkerCreated?: (id: string) => void | Promise<void>;
  onWorkerDeleted?: (id: string) => void | Promise<void>;
}

export class Sheduler implements ISheduler {
  pathJobs: string;
  _logger: ShedulerLogger;
  _sheduler: Bree;
  _encriptKey: string;
  _pythonPath: string;
  _scriptJobPath: string;
  _onWorkerCreated?: (id: string) => void | Promise<void>;
  _onWorkerDeleted?: (id: string) => void | Promise<void>;
  handleGetCollections: () => Promise<CollectionType[]>;

  constructor(
    config: ShedulerConfig,
    handleGetCollections: () => Promise<CollectionType[]>,
  ) {
    this._logger = config.logger;
    this._encriptKey = config.encriptKey;
    this._pythonPath = config.pythonPath;
    this._scriptJobPath = config.scriptJobPath;
    this._sheduler = new Bree({
      root: false,
      jobs: [],
      logger: this._logger,
      errorHandler: async (error) => {
        this._logger.error(`Sheduler job error: ${JSON.stringify(error)}`);
        if (config.errorHandler) await config.errorHandler(error);
      },
      workerMessageHandler: async (message: ShedulerMessageType) => {
        this._logger.info(`Sheduler job message: ${JSON.stringify(message)}`);
        if (config.workerMessageHandler) await config.workerMessageHandler(message);
      },
    });
    this.pathJobs = config.pathJobs;
    this._onWorkerCreated = config.onWorkerCreated;
    this._onWorkerDeleted = config.onWorkerDeleted;
    this.handleGetCollections = handleGetCollections;
    this.prepareJobsDirectory();
    this.addWorkerListeners();
  }

  //Подготовка директории со скриптами задач
  async prepareJobsDirectory(): Promise<void> {
    //Проверка наличия директории с задачами
    try {
      await fsPromises.access(this.pathJobs);
      this.clearJobsDirectory();
    } catch (err) {
      this.createJobsDirectory();
    }
  }
  //Создание директории со скриптами задач
  async createJobsDirectory(): Promise<void> {
    await fsPromises.mkdir(this.pathJobs, { recursive: true });
  }
  //Очистка директории со скриптами задач
  async clearJobsDirectory(): Promise<void> {
    await fsPromises.rm(this.pathJobs, { recursive: true });
    await fsPromises.mkdir(this.pathJobs, { recursive: true });
  }
  //Создание директории одного скрипта
  async createPhytonScript(jobOptions: JobOptionsType): Promise<string> {
    // создаем директорию phyton скрипта
    await fsPromises.mkdir(path.join(this.pathJobs, jobOptions._id), {
      recursive: true,
    });
    // чтение данных схемы
    const decryptedData: WordArray = AES.decrypt(jobOptions.flow.content, this._encriptKey);
    const dataFlow: ExternalDataDefaultFlowType = JSON.parse(
      decryptedData.toString(enc.Utf8)
    );
    // создаем python скрипт для схемы
    const scriptCreator: IScriptCreator = new ScriptCreator(this.handleGetCollections);
    const scriptPath: string | undefined = await scriptCreator.createScript(
      path.join(this.pathJobs, jobOptions._id),
      dataFlow.nodes,
      dataFlow.edges
    );
    return scriptPath;
  }
  //Создание директорий скриптов
  async createPhytonScripts(jobsOptions: JobOptionsType[]): Promise<string[]> {
    const pathesScripts: string[] = [];
    for (const jobOptions of jobsOptions) {
      const pathScript = await this.createPhytonScript(jobOptions);
      if (pathScript) {
        pathesScripts.push(pathScript);
      } else {
        throw new Error("Error create python script");
      }
    }
    return pathesScripts;
  }
  //Удаление директории одного скрипта
  async deletePhytonScript(id: string): Promise<string> {
    const pathScript: string = path.join(this.pathJobs, id);
    await fsPromises.rm(pathScript, { recursive: true });
    return pathScript;
  }
  //Запуск задачи
  async runJob(jobOptions: JobOptionsType): Promise<string | undefined> {
    //выход если дата окончания менее текущей
    if (jobOptions.endDateTime) {
      const initialEndDateTime = new Date(jobOptions.endDateTime);
      const now: Date = new Date();
      if (initialEndDateTime < now) return;
    }
    const job: IJob = new Job(jobOptions, this.pathJobs, this._pythonPath, this._scriptJobPath);
    await this._sheduler.add(job.externalData);
    await this._sheduler.start(jobOptions._id);
    return job.name;
  }
  //Запуск задач
  async runJobs(jobsOptions: JobOptionsType[]): Promise<string[] | undefined> {
    const jobs: IJob[] = jobsOptions
      .filter((jobOption: JobOptionsType) => {
        if (jobOption.endDateTime) {
          const initialEndDateTime = new Date(jobOption.endDateTime);
          const now: Date = new Date();
          if (initialEndDateTime < now) {
            return false;
          } else {
            return true;
          }
        }
        return true;
      })
      .map(
        (jobOptions: JobOptionsType) =>
          new Job(jobOptions, this.pathJobs, this._pythonPath, this._scriptJobPath)
      );
    if (jobs.length == 0) {
      return;
    }
    await this._sheduler.add(jobs.map((job) => job.externalData));
    await this._sheduler.start();
    return jobs.map((job: IJob) => job.name);
  }
  //Останов задачи
  async stopJob(id: string): Promise<string | undefined> {
    await this._sheduler.stop(id);
    await this._sheduler.remove(id);
    //проверка удаления
    if (this._sheduler.workers.has(id)) {
      return;
    }
    return id;
  }
  //Принудительный останов запущенного процесса
  postMessageCancelWorker(id: string): void {
    const worker = this._sheduler.workers.get(id);
    worker?.postMessage({ cancel: true });
  }
  //Подключение слушателей worker
  private addWorkerListeners() {
    this._sheduler.on("worker created", async (name) => {
      this._onWorkerCreated && this._onWorkerCreated(name);
    });
    this._sheduler.on("worker deleted", (name) => {
      this._onWorkerDeleted && this._onWorkerDeleted(name);
    });
  }
}

//Job
export interface IJob {
  name: string;
  path: string;
  interval: number | string;
  date?: Date;
  cron?: string;
  worker?: Partial<WorkerOptions>;
  externalData: JobType;
}

export class Job implements IJob {
  name: string;
  path: string;
  interval: number | string;
  date?: Date;
  cron?: string;
  worker?: Partial<WorkerOptions>;
  _pythonPath: string;
  _defaultScriptName: string;

  constructor(
    jobOption: JobOptionsType,
    pathJobs: string,
    pythonPath: string,
    scriptJobPath: string,
    defaultScriptName?: string
  ) {
    this.name = jobOption._id;
    this.path = scriptJobPath;
    this.interval = jobOption.interval || 0;
    this._pythonPath = pythonPath;
    this._defaultScriptName = defaultScriptName || 'script.py';
    this.init(jobOption, pathJobs);
  }

  get externalData(): JobType {
    return {
      name: this.name,
      path: this.path,
      interval: this.interval,
      date: this.date,
      cron: this.cron,
      worker: this.worker,
    };
  }

  private init(jobOption: JobOptionsType, pathJobs: string): void {
    //определение даты начала
    const initialStartDateTime: Date = new Date(jobOption.startDateTime);
    const now: Date = new Date();
    const reserveSeconds: number = 10;
    let dateStart: Date | undefined =
      initialStartDateTime >
        new Date(now.setSeconds(now.getSeconds() + reserveSeconds))
        ? initialStartDateTime
        : undefined;
    if (dateStart) {
      this.date = dateStart;
    }
    this.worker = {
      workerData: {
        scriptPythonPath: path.join(
          pathJobs,
          jobOption._id,
          this._defaultScriptName
        ),
        pythonPath: this._pythonPath,
      },
    };
  }
}

//types
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
  STOPPED = 'stopped',
  RUNNING = 'running',
  WORKING = 'working',
  ERROR = 'error',
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

//utils
export const months: string[] = [
  'January',
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