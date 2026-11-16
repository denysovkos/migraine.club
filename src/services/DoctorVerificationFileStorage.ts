import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { doctorVerificationFileSchema } from '@/models/Schema';
import { safeFilename, validateDoctorVerificationUpload } from '@/services/doctorVerificationUploadValidation';

export class DoctorVerificationFileStorage {
  private getBasePath(): string {
    const base = Env.FILES_STORAGE_PATH;
    if (!base) {
      throw new Error('FILES_STORAGE_PATH_NOT_CONFIGURED');
    }
    return base;
  }

  async replaceSingleFile(params: {
    applicationId: string;
    file: File;
  }) {
    const { ext } = validateDoctorVerificationUpload(params.file);

    const basePath = this.getBasePath();
    const dir = path.join(basePath, 'doctor-verification', params.applicationId);
    await fs.mkdir(dir, { recursive: true });

    const storedName = `${crypto.randomUUID()}.${ext}`;
    const relativePath = path.join('doctor-verification', params.applicationId, storedName);
    const absolutePath = path.join(basePath, relativePath);

    const buf = Buffer.from(await params.file.arrayBuffer());
    await fs.writeFile(absolutePath, buf);

    // Replace DB row (and delete old file on disk if present)
    const [existing] = await db
      .select()
      .from(doctorVerificationFileSchema)
      .where(eq(doctorVerificationFileSchema.applicationId, params.applicationId))
      .limit(1);

    if (existing) {
      try {
        await fs.unlink(path.join(basePath, existing.relativePath));
      } catch (error) {
        // Don't fail replace on delete issues; log for ops.
        logger.warn({ error, fileId: existing.id }, 'Failed to delete old doctor verification file');
      }

      await db.delete(doctorVerificationFileSchema).where(eq(doctorVerificationFileSchema.id, existing.id));
    }

    const [created] = await db
      .insert(doctorVerificationFileSchema)
      .values({
        applicationId: params.applicationId,
        originalName: safeFilename(params.file.name),
        storedName,
        relativePath,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
      })
      .returning();

    if (!created) {
      throw new Error('FAILED_TO_SAVE_FILE_METADATA');
    }

    return created;
  }
}

export const doctorVerificationFileStorage = new DoctorVerificationFileStorage();
