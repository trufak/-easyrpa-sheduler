import Bree from "bree";
import tsWorker from "@breejs/ts-worker";
Bree.extend(tsWorker);
import path from "path";
import fsPromises from "fs/promises";
import { WordArray } from "crypto-ts/src/lib/WordArray";
import { AES, enc } from "crypto-ts";
import { IScriptCreator, ScriptCreator } from "@easyrpa/script-creator";
import { CollectionType, ExternalDataDefaultFlowType } from "@easyrpa/script-creator/dist/types";

import { ShedulerMessageType, ShedulerLogger, JobOptionsType, IntervalsJob } from "./types";
import { IJob, Job } from "./Job";

export interface ISheduler {
  //путь к скриптам задач
  pathJobs: string;
  //коллекции
  collections: CollectionType[];
  //запустить список задач
  runJobs(jobsOptions: JobOptionsType[]): Promise<string[] | undefined>;
  //запустить одну задачу
  runJob(jobOptions: JobOptionsType): Promise<string | undefined>;
  //остановить одну задачу
  stopJob(jobOptions: JobOptionsType): Promise<string | undefined>;
  //выйти из процесса выполнения задачи
  postMessageCancelWorker(jobOptions: JobOptionsType): void;
  //создать файл скрипта задачи
  createPhytonScript(jobOptions: JobOptionsType): Promise<string | undefined>;
  //удалить файл скрипта задачи
  deletePhytonScript(jobOptions: JobOptionsType): Promise<string>;
  //создать файлы скриптов для списка задач
  createPhytonScripts(jobsOptions: JobOptionsType[]): Promise<string[]>;
}

export type ShedulerConfig = {
  logger: ShedulerLogger;
  encriptKey: string;
  pathJobs: string;
  pythonPath: string;
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
  _collections: CollectionType[];
  _onWorkerCreated?: (id: string) => void | Promise<void>;
  _onWorkerDeleted?: (id: string) => void | Promise<void>;

  constructor(
    config: ShedulerConfig,
    collections?: CollectionType[],
  ) {
    this._logger = config.logger;
    this._encriptKey = config.encriptKey;
    this._pythonPath = config.pythonPath;
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
    this._collections = collections || [];
    this.prepareJobsDirectory();
    this.addWorkerListeners();
  }

  get collections(): CollectionType[] {
    return this._collections;
  }

  set collections(cols: CollectionType[]) {
    this._collections = cols;
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
    const scriptCreator: IScriptCreator = new ScriptCreator(this._collections);
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
  async deletePhytonScript(jobOptions: JobOptionsType): Promise<string> {
    const pathScript: string = path.join(this.pathJobs, jobOptions._id);
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
    const job: IJob = new Job(jobOptions, this.pathJobs, this._pythonPath);
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
          new Job(jobOptions, this.pathJobs, this._pythonPath)
      );
    if (jobs.length == 0) {
      return;
    }
    await this._sheduler.add(jobs.map((job) => job.externalData));
    await this._sheduler.start();
    return jobs.map((job: IJob) => job.name);
  }
  //Останов задачи
  async stopJob(jobOptions: JobOptionsType): Promise<string | undefined> {
    if (jobOptions._id) {
      await this._sheduler.stop(jobOptions._id);
      await this._sheduler.remove(jobOptions._id);
      //проверка удаления
      if (this._sheduler.workers.has(jobOptions._id)) {
        return;
      }
      return jobOptions._id;
    }
    return;
  }
  //Принудительный останов запущенного процесса
  postMessageCancelWorker(jobOptions: JobOptionsType): void {
    const worker = this._sheduler.workers.get(jobOptions._id);
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


//utils
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
