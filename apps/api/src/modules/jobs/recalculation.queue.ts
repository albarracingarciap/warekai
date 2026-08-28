import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { RecalculationJobDto } from '@warekai/contracts';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { loadEnv } from '../../config/env';
import { RecalculationService, type RecalculationJobData } from './recalculation.service';

export const RECALCULATION_QUEUE = 'warekai:recalculation';

const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/**
 * Cola de recalculo de escandallos.
 *
 * Va en cola y no en linea porque cambiar el precio de un item puede disparar
 * el recalculo de decenas de recetas anidadas, y quien esta corrigiendo un
 * albaran no tiene por que esperar a que termine.
 *
 * **Si Redis no esta disponible, el recalculo se ejecuta en el momento.** Es
 * una decision deliberada: preferimos una peticion lenta a un escandallo que
 * miente. La alternativa -- perder el trabajo en silencio -- deja la base de
 * datos diciendo que un plato cuesta lo que costaba antes de subir la harina, y
 * eso no se detecta mirando la pantalla.
 */
@Injectable()
export class RecalculationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecalculationQueue.name);
  private readonly env = loadEnv();
  private queue?: Queue<RecalculationJobData>;
  private worker?: Worker<RecalculationJobData>;

  constructor(private readonly recalculation: RecalculationService) {}

  onModuleInit(): void {
    const connection = { host: this.env.REDIS_HOST, port: this.env.REDIS_PORT };
    try {
      this.queue = new Queue<RecalculationJobData>(RECALCULATION_QUEUE, { connection });
      this.queue.on('error', (error) => {
        this.logger.warn(`Cola de recalculo sin conexion: ${error.message}`);
      });

      this.worker = new Worker<RecalculationJobData>(
        RECALCULATION_QUEUE,
        async (job) => this.recalculation.run(job.data),
        { connection, concurrency: 1 },
      );
      this.worker.on('failed', (job, error) => {
        this.logger.error(`Recalculo fallido (${job?.id ?? 'sin id'}): ${error.message}`);
      });
      this.worker.on('error', (error) => {
        this.logger.warn(`Worker de recalculo sin conexion: ${error.message}`);
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo iniciar la cola de recalculo: ${(error as Error).message}. ` +
          'Los recalculos se ejecutaran en linea.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueueForItem(tenantId: string, itemId: string): Promise<RecalculationJobDto> {
    return this.enqueue({ tenantId, itemId });
  }

  async enqueueForTenant(tenantId: string): Promise<RecalculationJobDto> {
    return this.enqueue({ tenantId });
  }

  private async enqueue(data: RecalculationJobData): Promise<RecalculationJobDto> {
    const affected = await this.recalculation.affectedRecipeItemIds(data.tenantId, data.itemId);
    if (affected.length === 0) {
      return { jobId: 'noop', affectedRecipeIds: [], status: 'DONE' };
    }

    try {
      const job = await this.queue?.add('recalculate', data, JOB_OPTIONS);
      if (job) {
        return { jobId: String(job.id), affectedRecipeIds: affected, status: 'QUEUED' };
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar el recalculo (${(error as Error).message}). Se ejecuta en linea.`,
      );
    }

    await this.recalculation.run(data);
    return { jobId: 'inline', affectedRecipeIds: affected, status: 'DONE' };
  }
}
