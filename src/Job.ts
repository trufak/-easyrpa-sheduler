import { JobOptionsType, JobType } from "./types";
import path from "path";
import { type WorkerOptions } from "node:worker_threads";

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
    defaultScriptName?: string
  ) {
    this.name = jobOption._id;
    this.path = path.join(process.cwd(), "assets", "scriptFlow.js");
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
